import fs from 'node:fs';
import {createOwnedMonitorClient} from './owned-monitor-client.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import {sendWebWatchNotification} from './web-watch-notification-client.mjs';
import {resolveConsoleToken} from '../plugins/qq-components/obs-bridge-health/health.mjs';
import { parseWatchUrls } from '../plugins/qq-components/life-web-watch/monitor-config.mjs';
import { reportScriptHeartbeat } from './script-heartbeat.mjs';
import { extractPageSnapshot, buildWebChange, stageWebChanges, prepareWebNotifications } from '../plugins/qq-components/life-web-watch/web-changes.mjs';
import { generateWebSummary } from '../plugins/qq-components/life-web-watch/summarizer.mjs';
import { acquireLease, leaseActive, classifyNavigation } from './web-watch-browser-session.mjs';
import {createLoginRecovery,loginOrigin} from '../plugins/qq-components/life-web-watch/login-recovery.mjs';
import {createSiteSessions} from './web-watch-site-sessions.mjs';
import {flushLoginNotices} from './web-watch-login-notifications.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let ownedCleanup=async()=>{};
const ownedMonitor=createOwnedMonitorClient({root:ROOT,kind:'web-watch',onShutdown:()=>ownedCleanup()});
const WATCH_PLUGIN_CONFIG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'plugins', 'config', 'life-web-watch.json'), 'utf8')); } catch { return {}; } })();
const WATCH_SITES = WATCH_PLUGIN_CONFIG.webWatchEnabled === false ? [] : parseWatchUrls(WATCH_PLUGIN_CONFIG.watchUrls);
const STATE_FILE = path.join(ROOT, 'state', 'web-watch-state.json');
const LOG_FILE = path.join(ROOT, 'state', 'web-watch.log');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
let siteSessions;
const loginRecovery=createLoginRecovery(ROOT,{config:WATCH_PLUGIN_CONFIG});
async function requestLoginWindow(targets){
  const active=targets.filter(target=>loginRecovery.get(target.url).phase==='waiting');
  if(!active.length||leaseActive(path.join(ROOT,'state','login-window.lock'))||!loginRecovery.claimWindow())return false;
  fs.writeFileSync(path.join(ROOT,'state','web-watch-login-request.json'),JSON.stringify({at:Date.now(),targets:active},null,2));
  if(ownedMonitor)return (await ownedMonitor.spawn('login-window')).accepted===true;
  const child=spawn(process.execPath,[path.join(ROOT,'scripts','login-window.mjs')],{cwd:ROOT,detached:true,stdio:'ignore',windowsHide:true});child.unref();return true;
}
async function loginFailed(target,health={}){
  const recovery=loginRecovery.fail(target);
  Object.assign(health,{auth:'red',hint:recovery.phase==='paused'?'已达到登录尝试上限，等待手动重新监管':'需要登录，已请求QQ提醒'});
  await flushLoginNotices({root:ROOT,recovery:loginRecovery,log:logLine});
  if(recovery.phase==='waiting')await requestLoginWindow([target]);
}
function skipLoginSite(url,health){
  if(loginRecovery.canCheck(url))return false;
  const recovery=loginRecovery.get(url);Object.assign(health,{auth:'red',hint:recovery.phase==='paused'?'已暂停此网站监管，点击重新监管恢复':'等待登录，下次尝试前不重复访问'});return true;
}
async function loginReady(url){
  const checked=loginRecovery.checkRecovered(url),entry=loginRecovery.get(url);
  const loginReady=['waiting','needed'].includes(entry.phase)||entry.phase==='error'&&new URL(entry.url).href===new URL(url).href;
  if(loginReady)loginRecovery.recovered(url,entry.generation);
  if(checked.ok||loginReady)await flushLoginNotices({root:ROOT,recovery:loginRecovery,log:logLine});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Navigation has a per-page timeout; stages are awaited to completion. Racing a
// still-running stage against a timer used to navigate the same tab concurrently.
function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    if (lines.length > 2000) fs.writeFileSync(LOG_FILE, lines.slice(-1500).join('\n') + '\n', 'utf8');
  } catch {}
  console.log(line);
}
function sha(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function saveState(state) { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); }

async function ensureBrowser() {
  if (ownedMonitor) return ownedMonitor.connect(true);
  return puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-proxy-server'] });
}
async function closeBrowser(browser) {
  if (!browser) return;
  if (ownedMonitor) await browser.disconnect();
  else await browser.close();
}

// 页面加载失败（站点挂了/网络断/风控）不是内容变更，别把浏览器报错页当成更新报出去。
function looksLoadFailed(text) {
  return /无法访问此页面|ERR_CONNECTION_|关闭了连接|检查代理和防火墙|This site can'?t be reached|net::ERR_/i.test(String(text || ''));
}

async function fetchPage(page, url, { waitMs = 2500 } = {}) {
  let navigationSucceeded=true,response;
  try{response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});}catch{navigationSucceeded=false;}
  await sleep(waitMs);
  const r = await page.evaluate(extractPageSnapshot).catch(() => ({ url, title: '', text: '', lines: [], links: [] }));
  // goto 失败/被重定向到别的站点时 location.href 会落到别的 host：此刻抓的是上一页旧内容，
  // 绝不能当成本页结果去比对基线（否则会把收藏夹/门户页误判成「内容更新」重复通知）。
  let hostOk = false;
  try { hostOk = new URL(String(r.url || '')).host === new URL(String(url || '')).host; } catch {}
  const status = classifyNavigation(r,url,{navigationSucceeded,httpStatus:response?.status()||200});
  if (!hostOk || status !== 'ready') return { url: r.url, title: r.title, text: '', lines: [], links: [], status };
  return { ...r, status };
}

async function checkWebsites(state, changes) {
  state.monitorHealth ||= {};
  for (const site of WATCH_SITES) {
    if(RETRY_URL&&site.url!==RETRY_URL)continue;
    const health = state.monitorHealth[site.url] ||= {};
    if(skipLoginSite(site.url,health))continue;
    health.checkedAt = Date.now();
    const r = await siteSessions.page(site.url).then(page => fetchPage(page, site.url)).catch(() => null);
    if (r?.status === 'login') {
      Object.assign(health, { fetch: 'green', auth: 'red', diff: 'unknown', delivery: 'unknown', hint: '需要登录，请协助在可见窗口完成登录' });
      // Always retain the login target; delivery cooldown is enforced separately.
      changes.push({ kind: 'login', url: site.url, name: site.name, msg: `【${site.name}】网页监控需要重新登录，请协助完成后继续监视。` });
      await loginFailed(site,health);
      continue;
    }
    if (!r || looksLoadFailed(r.text) || !String(r.text || '').trim()) {
      Object.assign(health, { fetch: 'red', auth: 'unknown', diff: 'unknown', delivery: 'unknown', hint: '页面无法读取，请检查网址、网络或登录状态' });
      loginRecovery.checkFailed(site,health.hint);await flushLoginNotices({root:ROOT,recovery:loginRecovery,log:logLine});
      logLine(`【${site.name}】页面加载失败/为空，跳过本轮（不改基线）`);
      continue;
    }
    Object.assign(health, { fetch: 'green', auth: 'green', hint: '页面可读取' });
    await loginReady(site.url);
    const key = 'bookmark/' + site.url;
    const hash = sha(r.text.slice(0, 20000));
    const links = r.links.filter(l => l.h && !l.h.startsWith('javascript')).map(l => l.t).filter(Boolean);
    const prev = state[key];
    state[key] = { hash, links: links.slice(0, 300), lines: r.lines || [], linkDetails: r.links || [], contentVersion: 2 };
    if (!prev || !Array.isArray(prev.lines)) { health.diff = 'baseline'; health.delivery = 'none'; continue; }
    const change = buildWebChange({ site, previous: prev, current: r });
    if (change) changes.push(change);
    health.diff = change ? 'changed' : 'stable'; health.delivery = change ? 'pending' : 'none';
    if (change) health.lastChangedAt = Date.now();
  }
}

async function notifyConv(key,text,meta={}) {
  const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));
  return sendWebWatchNotification({ endpoint:'http://127.0.0.1:'+(cfg.consolePort||3100), consoleToken:resolveConsoleToken(ROOT,cfg),
    key,text,items:meta.items,log:logLine });
}

async function notifyOwner(text,meta={}) {
  try {
    const key = 'private:' + (JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'))?.ownerQQ || '');
    return await notifyConv(key, text,meta);
  } catch (error) {
    logLine('通知异常：' + (error?.message ?? error));
    return false;
  }
}

const RETRY_URL = process.argv.includes('--retry-url')?process.argv[process.argv.indexOf('--retry-url')+1]:'';
if(RETRY_URL)loginOrigin(RETRY_URL);
async function main() {
  await flushLoginNotices({root:ROOT,recovery:loginRecovery,log:logLine});
  // Interactive login owns the entire profile, including cookies and navigation.
  // Never refresh pages or replay an old jar while the owner is signing in.
  const loginLock = path.join(ROOT, 'state', 'login-window.lock');
  if (leaseActive(loginLock)) { console.log('登录正在进行，暂停后台页面检查'); return; }
  if (!WATCH_SITES.some(site => !RETRY_URL || site.url === RETRY_URL)) return;
  // The PID lease prevents concurrent checks from changing the same baseline.
  const lockFile = path.join(ROOT, 'state', 'web-watch.lock');
  const release = acquireLease(lockFile);
  if (!release) { console.log('已有检查在运行，跳过本次'); return; }
  const releaseAtExit = () => release();
  process.once('exit', releaseAtExit);
  if (leaseActive(loginLock)) { release(); return; }
  const state = readState();
  const changes = [];
  let browser;
  ownedCleanup=async()=>{await siteSessions?.close();siteSessions=null;await closeBrowser(browser);saveState(state);release();};
  try {
    browser = await ensureBrowser();
    siteSessions=createSiteSessions(ROOT,browser,{strictClose:!!ownedMonitor});
    await checkWebsites(state, changes);
    // Keep the most recent session snapshot; do not move any visible window.
    if(ownedMonitor)await ownedMonitor.cleanup(()=>siteSessions.close());else await siteSessions.close();siteSessions=null;
    if(ownedMonitor)await ownedMonitor.cleanup(()=>browser.disconnect());else await closeBrowser(browser);
  } catch (error) {
    logLine('检查失败：' + (error?.message ?? error));
    if(RETRY_URL){const health=state.monitorHealth?.[RETRY_URL]||{};loginRecovery.checkFailed({url:RETRY_URL,name:loginRecovery.get(RETRY_URL).name},error.message);Object.assign(health,{checkedAt:Date.now(),fetch:'red',hint:error.message});(state.monitorHealth||={})[RETRY_URL]=health;await flushLoginNotices({root:ROOT,recovery:loginRecovery,log:logLine}).catch(()=>{});}
    reportScriptHeartbeat(ROOT, 'scripts/web-watch.mjs', false, error?.message ?? String(error));
    stageWebChanges(state, changes);
    saveState(state);
    try { await siteSessions?.close();siteSessions=null; } catch (error) { ownedMonitor?.noteCleanupFailure(error); }
    try { await closeBrowser(browser); } catch (error) { ownedMonitor?.noteCleanupFailure(error); }
    release();
    process.exitCode = 1;
    return;
  }
  // Store raw diffs before calling AI: a crash or failed send must not lose changes.
  const notificationChanges = stageWebChanges(state, changes);
  saveState(state);
  // 登录失效 → 临时弹出登录窗口；登录后关闭它并恢复同一 profile 的无头浏览器。
  if (changes.some(c => c.kind === 'login')) {
    try {
      const targets=changes.filter(c=>c.kind==='login'&&c.url).map(c=>({name:c.name||'监控网页',url:c.url}));
      await requestLoginWindow(targets);
      if(targets.some(target=>loginRecovery.get(target.url).phase==='waiting')){
        // Raw changes are durable. Hand the profile to login immediately rather
        // than keeping it locked while unrelated AI summaries are generated.
        reportScriptHeartbeat(ROOT,'scripts/web-watch.mjs',true,'等待登录协助，内容变化已保留');release();return;
      }
    } catch (error) { logLine('弹出登录窗口失败：' + (error?.message ?? error)); }
  }
  state.webSummaryCache ||= {};
  const prepared = await prepareWebNotifications(notificationChanges.filter(change => WATCH_SITES.some(site => site.url === change.webDiff?.url)), {
    cache: state.webSummaryCache,
    generate: WATCH_PLUGIN_CONFIG.aiWebSummary === false ? undefined : payload => generateWebSummary(payload, {
      root: ROOT, timeoutMs: WATCH_PLUGIN_CONFIG.summaryTimeoutMs || 35000, recordCreatedSession: ownedMonitor?.recordCreatedSession
    }),
    onError: error => logLine('网页 AI 整理不可用，改用简短摘要：' + error.message)
  });
  for (const id of prepared.suppressedIds) {
    const url = state.pendingWebChanges[id]?.webDiff.url;
    const health = state.monitorHealth?.[url];
    if (health) { health.diff = 'noise'; health.delivery = 'none'; }
    delete state.pendingWebChanges[id];
  }
  for (const change of prepared.changes) if (change.webDiff) {
    const health = state.monitorHealth?.[change.webDiff.url];
    if (health) health.delivery = 'pending';
  }
  const cacheIds = Object.keys(state.webSummaryCache);
  for (const id of cacheIds.slice(0, Math.max(0, cacheIds.length - 80))) delete state.webSummaryCache[id];
  saveState(state);
  const outbound = prepared.changes;
  const items = outbound.map(change => ({
    id: change.deliveryId,
    text: change.msg,
    sourceAt: change.sourceAt,
    expiresAt: change.sourceAt + 24 * 3600000,
  }));
  const delivery = {
    count: items.length,
    sent: items.length > 0 && await notifyOwner('🔎 网站监督\n' + outbound.map(change => change.msg).join('\n'), { items }),
  };
  for (const change of outbound) {
    const health = state.monitorHealth?.[change.webDiff.url];
    if (health) health.delivery = delivery.sent ? 'green' : 'red';
  }
  if (state.monitorHealth) saveState(state);
  if (delivery.sent) {
    for (const change of prepared.changes) if (change.webDiff) delete state.pendingWebChanges[change.webDiff.id];
    saveState(state);
    logLine('QQ 通知确认成功：' + delivery.count + ' 条');
  } else if (delivery.count) logLine('QQ 通知未确认成功，保留待重试内容');
  else if (Object.values(state.monitorHealth||{}).some(health=>health.fetch==='red'||health.auth==='red')) logLine('检查完成：部分网站检查失败或需要登录，请查看监控状态');
  else if (!changes.length) logLine('检查完成：无变化');
  else logLine('检查完成：' + new Set(changes.map(c => c.msg)).size + ' 处变化');
  reportScriptHeartbeat(ROOT, 'scripts/web-watch.mjs', true, '最近一次检查完成');
  release();
}

main().finally(()=>ownedMonitor?.dispose());
