#!/usr/bin/env node
/**
 * campus-watch.mjs — 每 30 分钟检查一次：
 *   1) Blackboard 两门课的 课程资源 / 作业区 是否出现新条目；
 *   2) 研究生平台「学术报告选课」里**高新校区**的新讲座；
 *   3) 收藏夹里三门课程主页是否更新（正文哈希 / 新链接）。
 *
 * 有变化时通过桥接 API 发 QQ 私聊给 owner；无变化只写日志，不发消息。
 *
 * 浏览器：独立配置 state/campus-profile + 调试端口 9222（与本机日常 Edge、AI 的
 * Playwright MCP 浏览器互不干扰）。登录失效时为对应监控网址打开可见窗口；
 * 登录期间暂停后台访问，完成后保存 session cookie 并恢复同 profile 的无头模式。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import {sendCampusNotification} from './campus-notification-client.mjs';
import {resolveConsoleToken} from '../plugins/qq-components/obs-bridge-health/health.mjs';
import { loadCoursePolicy, recordEnrollment, migrateLegacyEnrollments, eligibleReports, processDOMRows, normalizeCourse } from './ustc-course-policy.mjs';
import { openReportTableDOM, selectReportDOM } from './ustc-dom.mjs';
import { prepareReportSession } from './ustc-session.mjs';
import { parseEnabledScripts, parseWatchUrls, parseBbCourses, parseLectures } from '../plugins/qq-components/life-campus-watch/monitor-config.mjs';
import { enrollmentChange, dispatchOwnerChanges } from './ustc-notifications.mjs';
import { reportScriptHeartbeat } from './script-heartbeat.mjs';
import { extractPageSnapshot, buildWebChange, stageWebChanges, prepareWebNotifications } from '../plugins/qq-components/life-campus-watch/web-changes.mjs';
import { generateWebSummary } from '../plugins/qq-components/life-campus-watch/summarizer.mjs';
import { acquireLease, leaseActive, classifySnapshot, ensureSessionBrowser, restoreCookies, saveCookies } from './campus-browser-session.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'campus-watch.json'), 'utf8'));
const WATCH_PLUGIN_CONFIG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'plugins', 'config', 'life-campus-watch.json'), 'utf8')); } catch { return {}; } })();
// 单一数据源：BB 课程与讲座配置优先从组件 config 读（控制台可编辑）；组件没写时才回退 campus-watch.json。
if (WATCH_PLUGIN_CONFIG.bbCoursesConfigured === true || (Array.isArray(WATCH_PLUGIN_CONFIG.bbCourses) && WATCH_PLUGIN_CONFIG.bbCourses.length)) {
  CONFIG.bbCourses = parseBbCourses(WATCH_PLUGIN_CONFIG.bbCourses);
}
if (Object.prototype.hasOwnProperty.call(WATCH_PLUGIN_CONFIG, 'lecturesEnabled') || Object.prototype.hasOwnProperty.call(WATCH_PLUGIN_CONFIG, 'lecturesLocation')) {
  CONFIG.lectures = parseLectures(WATCH_PLUGIN_CONFIG);
}
const MONITOR_SCRIPTS = parseEnabledScripts(WATCH_PLUGIN_CONFIG.enabledScripts);
const WATCH_SITES = parseWatchUrls(WATCH_PLUGIN_CONFIG.watchUrls, WATCH_PLUGIN_CONFIG.watchUrlsConfigured === true ? [] : (CONFIG.bookmarkPages || []));
const STATE_FILE = path.join(ROOT, 'state', 'campus-watch-state.json');
const LOG_FILE = path.join(ROOT, 'state', 'campus-watch.log');
const PORT = Number(CONFIG.debugPort) || 9222;
const PROFILE = path.join(ROOT, 'state', 'campus-profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

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
// 把「报告时间」列里的各种写法（2026-10-26 10:00 / 2026/10/26 10:00 / 2026年10月26日 10:00）解析成时间戳；
// 解析不出就返回 null，用于把历史讲座/格式怪异的行过滤掉，避免把过期会议当新增。
function parseLectureTime(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  const norm = str.replace(/[年月]/g, '-').replace(/日/g, ' ').replace(/[./]/g, '-').trim();
  const m = norm.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T]?(\d{1,2}):(\d{2})/);
  if (m) {
    const dt = new Date(`${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}T${String(m[4]).padStart(2, '0')}:${m[5]}:00`);
    if (!Number.isNaN(dt.getTime())) return dt.getTime();
  }
  const m2 = norm.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m2) {
    const dt = new Date(`${m2[1]}-${String(m2[2]).padStart(2, '0')}-${String(m2[3]).padStart(2, '0')}T00:00:00`);
    if (!Number.isNaN(dt.getTime())) return dt.getTime();
  }
  return null;
}
// 同一题目在 DOM 里被重复渲染（如「ABCABC」）时收成「ABC」，避免输出重复标题。
function collapseDupTitle(t) {
  const s = String(t || '').trim();
  if (!s) return s;
  if (s.length >= 4 && s.length % 2 === 0 && s.slice(0, s.length / 2) === s.slice(s.length / 2)) {
    return s.slice(0, s.length / 2);
  }
  return s;
}
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function saveState(state) { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); }

async function ensureBrowser() {
  const { browser } = await ensureSessionBrowser({
    connect: async () => { try { return await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null }); } catch { return null; } },
    launch: launchBrowser,
    restore: browser => restoreCookies(browser, path.join(ROOT, 'state', 'campus-cookies.json'))
  });
  return browser;
}

async function launchBrowser() {
  fs.mkdirSync(PROFILE, { recursive: true });
  logLine('启动无头浏览器（如需登录会另弹可见窗口）');
  const child = spawn(EDGE, [
    '--headless=new',
    '--no-proxy-server',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(700);
    try { return await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null }); } catch {}
  }
  throw new Error('无法启动监控 Edge（端口 ' + PORT + '）');
}

// 页面加载失败（站点挂了/网络断/风控）不是内容变更，别把浏览器报错页当成更新报出去。
function looksLoadFailed(text) {
  return /无法访问此页面|ERR_CONNECTION_|关闭了连接|检查代理和防火墙|This site can'?t be reached|net::ERR_/i.test(String(text || ''));
}

async function fetchPage(page, url, { waitMs = 2500 } = {}) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
  await sleep(waitMs);
  const r = await page.evaluate(extractPageSnapshot).catch(() => ({ url, title: '', text: '', lines: [], links: [] }));
  // goto 失败/被重定向到别的站点时 location.href 会落到别的 host：此刻抓的是上一页旧内容，
  // 绝不能当成本页结果去比对基线（否则会把收藏夹/门户页误判成「内容更新」重复通知）。
  let hostOk = false;
  try { hostOk = new URL(String(r.url || '')).host === new URL(String(url || '')).host; } catch {}
  const status = classifySnapshot(r, url);
  if (!hostOk || status !== 'ready') return { url: r.url, title: r.title, text: '', lines: [], links: [], status };
  return { ...r, status };
}

async function checkBlackboard(page, state, changes) {
  state.monitorHealth ||= {};
  for (const course of CONFIG.bbCourses || []) {
    for (const p of course.pages || []) {
      const url = `https://portal.example.invalid/webapps/blackboard/content/listContent.jsp?course_id=${course.courseId}&content_id=${p.contentId}&mode=reset`;
      const health = state.monitorHealth[url] ||= {};
      health.checkedAt = Date.now();
      const r = await fetchPage(page, url, { waitMs: 2000 }).catch(() => null);
      if (r?.status === 'login') {
        Object.assign(health, { fetch: 'green', auth: 'red', diff: 'unknown', delivery: 'unknown', hint: '需要登录' });
        changes.push({ kind: 'login', url, name: course.name + '·' + p.label, msg: 'Blackboard 需要重新登录' });
        continue;
      }
      if (!r || looksLoadFailed(r.text) || !String(r.text || '').trim()) {
        Object.assign(health, { fetch: 'red', auth: 'unknown', diff: 'unknown', delivery: 'unknown', hint: '页面无法读取，请检查网络或登录状态' });
        logLine(`【${course.name}·${p.label}】页面加载失败/为空，跳过本轮（站点或网络问题，不改基线）`);
        continue;
      }
      Object.assign(health, { fetch: 'green', auth: 'green', hint: '页面可读取' });
      const content = r.text.slice(0, 20000);
      const items = r.links.filter(l => /bbcswebdav|assignment|listContent/.test(l.h) && l.t)
        .map(l => l.t).filter(t => !/^(课程主页|课程通知|课程资源|讨论版|作业区|Classin课堂|工具)$/.test(t));
      const key = `${course.name}/${p.label}`;
      const prev = state[key];
      const next = { hash: sha(content), items, lines: r.lines || [], linkDetails: r.links || [], contentVersion: 2 };
      state[key] = next;
      if (!prev || !Array.isArray(prev.lines)) { health.diff = 'baseline'; health.delivery = 'none'; continue; }
      const change = buildWebChange({ site: { name: course.name + '·' + p.label, url }, previous: prev, current: r });
      if (change) changes.push({ ...change, kind: 'homework' });
      health.diff = change ? 'changed' : 'stable'; health.delivery = change ? 'pending' : 'none';
      if (change) health.lastChangedAt = Date.now();
    }
  }
}

// ── 专用抢课脚本（ustc_grab_report_course，Python）───────────────────────────
// 用 requests 直接调接口抢课，比 DOM 更稳更快，还带 data/exclude.json「排除后不再选」。
// 脚本失败（缺 Python/依赖、网络 SSL、cookie 过期）时，checkLectures 回退 DOM 泛用方案。
const GRAB_DIR = path.join(ROOT, 'scripts', 'ustc-grab-report-course');
const GRAB_CLI = path.join(GRAB_DIR, 'grab_report_cli.py');
// 必须用项目 venv 的 python：裸 `python` 在这台机器上是 Windows Store 占位 stub（跑起来没输出）。
const GRAB_PY = fs.existsSync(path.join(GRAB_DIR, 'venv', 'Scripts', 'python.exe'))
  ? path.join(GRAB_DIR, 'venv', 'Scripts', 'python.exe')
  : 'python';

// 把浏览器里实时的 cookie 导出到 campus-cookies.json，给 Python 抢课脚本用。
// 为什么需要：Python 用的是导出快照，久了 _WEU/GS_SESSIONID 会过期，直连 API 就 403。
// 每次跑抢课前先刷新一遍，复用浏览器里还活着、且已经「进过学术报告选课应用」的会话。
async function refreshCookieJar(page) {
  const jar = path.join(ROOT, 'state', 'campus-cookies.json');
  try {
    // 关键：先「进一次学术报告选课应用」把应用会话初始化、并验证查询返回 200，再导出 cookie；
    // 只导裸 cookie 不带应用初始化，Python 直连接口照样 403。
    const cookies = await prepareReportSession(page.browser());
    if (Array.isArray(cookies) && cookies.length) {
      fs.writeFileSync(jar, JSON.stringify(cookies, null, 2), 'utf8');
      const yjs = cookies.filter((c) => c.domain === 'portal.example.invalid').length;
      logLine('已刷新抢课 cookie（应用会话已初始化）：共 ' + cookies.length + ' 条，yjs1 域 ' + yjs + ' 条');
      return true;
    }
  } catch (error) {
    logLine('刷新抢课 cookie 失败（会话可能需重登）：' + String(error?.message ?? error).slice(0, 140));
  }
  return false;
}

function runGrabScript() {
  const options = { cwd: GRAB_DIR, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', USTC_GRAB_LOCATION_KEYWORD: String(CONFIG.lectures?.locationKeyword || '高新') },
    stdio: ['ignore', 'pipe', 'pipe'] };
  let stage = 'cookie-sync';
  try {
    // 先同步 cookies：campus-cookies.json（浏览器登录态，会随重登刷新）→ config.yml，避免 _WEU 过期后拿旧值。
    execFileSync(GRAB_PY, [path.join(GRAB_DIR, 'sync_cookies.py')], { ...options, timeout: 20000 });
    stage = 'grab';
    const out = execFileSync(GRAB_PY, [GRAB_CLI], { ...options, timeout: 50000 });
    const line = String(out || '').trim().split('\n').filter(Boolean).pop();
    const j = JSON.parse(line || '{}');
    if (!j || typeof j.ok !== 'boolean') throw new Error('抢课脚本未输出有效结果');
    return j;
  } catch (error) {
    // CLI 用非零退出码报告失败，但 stdout 仍含结构化诊断和本轮已经完成的选/退课。
    if (stage === 'grab') {
      try {
        const line = String(error.stdout || '').trim().split('\n').filter(Boolean).pop();
        const result = JSON.parse(line);
        if (result?.ok === false) return result;
      } catch {}
    }
    return { ok: false, error_type: stage, error: String(error?.message ?? error).slice(0, 500) };
  }
}

function handleGrabResult(result, state, changes) {
  const grabbed = Array.isArray(result.grabbed) ? result.grabbed : [];
  for (const g of grabbed) {
    const id = String(g.bgbm || (g.title + '|' + g.time));
    if (state.notifiedGrab?.[id]) continue;
    recordEnrollment(GRAB_DIR, g);
    changes.push(enrollmentChange(g));
  }
  for (const w of (Array.isArray(result.withdrawn) ? result.withdrawn : [])) {
    changes.push({ kind: 'lectureWithdraw', msg: '🔁 已退掉排除课程：' + (w.time ? w.time + ' ' : '') + (w.title || '') });
  }
}

async function checkLectures(page, state, changes, force = false) {
  const lec = CONFIG.lectures;
  if (!lec?.enabled || !MONITOR_SCRIPTS.has('lectures')) return;
  migrateLegacyEnrollments(GRAB_DIR, state);
  const interval = Math.max(5, Number(lec.intervalMinutes) || 10) * 60000;
  if (!force && Date.now() - (Number(state.lastLectureCheckAt) || 0) < interval) return;
  state.lastLectureCheckAt = Date.now();
  // 优先专用抢课脚本；脚本不可用/失败再回退 DOM（DOM 同时是操作普通网页的泛用能力）。
  // 跑之前先从浏览器刷新 cookie（导出快照会过期，直连 API 就会 403）。
  const freshSession = page ? await refreshCookieJar(page) : false;
  const GRAB_HEARTBEAT = 'scripts/ustc-grab-report-course/grab_report_cli.py';
  const scriptResult = MONITOR_SCRIPTS.has('grab') ? (freshSession ? runGrabScript() : {ok:false,error_type:'initialization',error:'学术报告应用会话未初始化；未使用旧 cookie 执行脚本'}) : null;
  if (scriptResult) handleGrabResult(scriptResult, state, changes);
  if (scriptResult && scriptResult.ok === true) {
    reportScriptHeartbeat(ROOT, GRAB_HEARTBEAT, true, '抢到 ' + (scriptResult.grabbed || []).length + ' 场');
    logLine('抢课脚本已跑：抢到 ' + (scriptResult.grabbed || []).length + ' 场，退掉 ' + (scriptResult.withdrawn || []).length + ' 场');
    return;
  }
  reportScriptHeartbeat(ROOT, GRAB_HEARTBEAT, false, scriptResult?.error || '没有有效结果');
  logLine('抢课脚本失败：' + (scriptResult?.error || '没有有效结果'));
  logLine('抢课脚本不可用，回退 DOM 泛用方案');
  const fallback = await checkLecturesDOM(page, state, changes, force);
  if (fallback?.ok) reportScriptHeartbeat(ROOT, GRAB_HEARTBEAT, true, 'DOM备用流程正常；脚本：' + (scriptResult?.error || '未启用'), 'fallback');
}

async function checkLecturesDOM(page, state, changes, force = false) {
  const lec = CONFIG.lectures;
  if (!lec?.enabled) return;
  const policy = loadCoursePolicy(GRAB_DIR, lec);
  let appPage;
  try {
    const table = await openReportTableDOM(page.browser(), policy.query);
    appPage = table.page;
    const rows = eligibleReports(table.rows, policy);
    const nowList = rows.map(row => ({ ...normalizeCourse(row), speaker: row.BGRZW,
      deadline: row.JZSJ, cap: Number(row.KXRS), sel: Number(row.YXRS) }));
    const previous = new Set((state['lectures/high-tech']?.items || []).map(item => item.title + '|' + item.time));
    const newOnes = nowList.filter(item => !previous.has(item.title + '|' + item.time));
    if (newOnes.length) {
      changes.push({ kind: 'lecture', msg: '【高新校区讲座】新增：\n' +
        newOnes.map(item => '- ' + item.time + ' ' + item.title + '（' + (item.dept || '') + '）').join('\n') });
    }
    const pendingAnnouncements = state.pendingLectureAnnouncements || {};
    const notified = state.notifiedLectures || {};
    for (const item of newOnes) {
      const id = item.title + '|' + item.time;
      if (!notified[id]) pendingAnnouncements[id] = item;
    }
    for (const [id, item] of Object.entries(pendingAnnouncements)) {
      if (Date.parse(String(item.time).replace(' ', 'T')) <= Date.now()) { delete pendingAnnouncements[id]; continue; }
      try {
        for (const key of CONFIG.notifyGroups || []) await notifyConv(key,
          '📢 新讲座（高新校区）\n' + item.time + ' ' + item.title +
          (item.dept ? '\n组织：' + item.dept : '') + (item.place ? '\n地点：' + item.place : '') +
          '\n（自动选课监控中，成功后另行通知）');
        notified[id] = Date.now();
        delete pendingAnnouncements[id];
      } catch (error) { logLine('群通知失败，保留待重试：' + error.message); }
    }
    state.notifiedLectures = notified;
    state.pendingLectureAnnouncements = pendingAnnouncements;
    // Revisit every eligible report, including previously full or failed reports.
    const result = await processDOMRows(table.rows, policy, row => selectReportDOM(appPage, row.BGBM));
    handleGrabResult({ grabbed: result.grabbed }, state, changes);
    for (const course of result.full) {
      const key = 'fullNotice:' + course.BGBM;
      if (!state[key] || Date.now() - state[key] > 6 * 3600000) {
        state[key] = Date.now();
        changes.push({ kind: 'lectureFull', msg: '【高新校区讲座】满员，会继续重试：' + course.BGSJ + ' ' + course.BGTMZW });
      }
    }
    for (const failure of result.failed) {
      const key = 'failNotice:' + failure.course.BGBM;
      if (!state[key] || Date.now() - state[key] > 6 * 3600000) {
        state[key] = Date.now();
        changes.push({ kind: 'lectureFail', msg: '⚠️ 自动选课失败：' + failure.course.BGTMZW + '（' + failure.error + '）' });
      }
    }
    state['lectures/high-tech'] = { items: nowList };
    logLine('DOM 回退已跑：抢到 ' + result.grabbed.length + ' 场，满员 ' + result.full.length + ' 场');
    return {ok:true};
  } catch (error) {
    logLine('讲座 DOM 回退失败：' + error.message);
    if (error.error_type === 'auth' || /\/cas\/login|id\.ustc\.edu\.cn\/cas\//i.test(appPage?.url() || '')) {
      changes.push({ kind: 'login', url: lec.portalUrl || 'https://portal.example.invalid/', name: '研究生平台', msg: '研究生平台需要重新登录' });
    }
  } finally {
    if (appPage) await appPage.close().catch(() => {});
  }
}

async function checkBookmarks(page, state, changes) {
  state.monitorHealth ||= {};
  for (const site of WATCH_SITES) {
    const health = state.monitorHealth[site.url] ||= {};
    health.checkedAt = Date.now();
    const r = await fetchPage(page, site.url, { waitMs: 2500 }).catch(() => null);
    if (r?.status === 'login') {
      Object.assign(health, { fetch: 'green', auth: 'red', diff: 'unknown', delivery: 'unknown', hint: '需要登录，请协助在可见窗口完成登录' });
      // Always retain the login target; delivery cooldown is enforced separately.
      changes.push({ kind: 'login', url: site.url, name: site.name, msg: `【${site.name}】网页监控需要重新登录，请协助完成后继续监视。` });
      continue;
    }
    if (!r || looksLoadFailed(r.text) || !String(r.text || '').trim()) {
      Object.assign(health, { fetch: 'red', auth: 'unknown', diff: 'unknown', delivery: 'unknown', hint: '页面无法读取，请检查网址、网络或登录状态' });
      logLine(`【${site.name}】页面加载失败/为空，跳过本轮（不改基线）`);
      continue;
    }
    Object.assign(health, { fetch: 'green', auth: 'green', hint: '页面可读取' });
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
  return sendCampusNotification({ endpoint:'http://127.0.0.1:'+(cfg.consolePort||3100), consoleToken:resolveConsoleToken(ROOT,cfg),
    key,text,items:meta.items,log:logLine });
}

async function notifyOwner(text,meta={}) {
  if (CONFIG.notifyOwner === false) return false;
  try {
    const key = 'private:' + (JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'))?.ownerQQ || '');
    return await notifyConv(key, text,meta);
  } catch (error) {
    logLine('通知异常：' + (error?.message ?? error));
    return false;
  }
}

const FORCE = process.argv.includes('--force');
const LECTURES_ONLY = process.argv.includes('--lectures-only');

// 站点不可达时的退避：校内平台偶尔整段连不上（TLS 被重置/需要校园网/单点登录挂了）。
// 以前每轮都硬起浏览器、卡满 180 秒看门狗，既烧 CPU 又让健康巡检报「课程监管没跑」。
// 先在 Node 侧做一个 8 秒的轻量探测：连续失败就记一个截止时间，到点前直接跳过，不再拉浏览器。
const UNREACHABLE_FILE = path.join(ROOT, 'state', 'campus-watch-unreachable.json');
const UNREACHABLE_BACKOFF_MS = 10 * 60 * 1000;
function readUnreachableUntil() {
  try {
    const doc = JSON.parse(fs.readFileSync(UNREACHABLE_FILE, 'utf8'));
    return Number(doc?.until) || 0;
  } catch { return 0; }
}
function writeUnreachableUntil(until, reason = '') {
  try { fs.writeFileSync(UNREACHABLE_FILE, JSON.stringify({ until, reason, at: new Date().toISOString() }, null, 2), 'utf8'); } catch {}
}
async function siteReachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) campus-watch/0.1' } });
    return res.ok || res.status < 500;
  } catch { return false; }
}
async function preflight() {
  const targets = [...new Set([
    ...(!LECTURES_ONLY && MONITOR_SCRIPTS.has('blackboard') && CONFIG.bbCourses?.length ? ['https://portal.example.invalid/'] : []),
    ...(CONFIG.lectures?.enabled && MONITOR_SCRIPTS.has('lectures') ? [CONFIG.lectures.portalUrl || 'https://portal.example.invalid/'] : []),
    ...(!LECTURES_ONLY && WATCH_PLUGIN_CONFIG.webWatchEnabled !== false && MONITOR_SCRIPTS.has('bookmarks') ? WATCH_SITES.map(s => s.url) : [])
  ].map(url => new URL(url).origin))];
  const results = await Promise.all(targets.map(async (u) => [u, await siteReachable(u)]));
  const okAny = results.some(([, ok]) => ok);
  logLine('站点预检：' + results.map(([u, ok]) => u.replace(/^https?:\/\//, '').replace(/\/$/, '') + (ok ? '=通' : '=不通')).join(' '));
  return { okAny, results };
}

async function main() {
  // Interactive login owns the entire profile, including cookies and navigation.
  // Never refresh pages or replay an old jar while the owner is signing in.
  const loginLock = path.join(ROOT, 'state', 'login-window.lock');
  if (leaseActive(loginLock)) { console.log('登录正在进行，暂停后台页面检查'); return; }
  if (LECTURES_ONLY) {
    const state = readState();
    const interval = Math.max(5, Number(CONFIG.lectures?.intervalMinutes) || 10) * 60000;
    if (!CONFIG.lectures?.enabled || !MONITOR_SCRIPTS.has('lectures') || (!FORCE && Date.now() - (Number(state.lastLectureCheckAt) || 0) < interval)) {
      reportScriptHeartbeat(ROOT, 'scripts/campus-watch.mjs', true, '未到下次讲座检查时间');
      return;
    }
  }
  // 站点退避窗口内直接跳过，避免每轮卡满 180 秒。
  const until = readUnreachableUntil();
  if (!FORCE && until && Date.now() < until) {
    console.log('校内站点暂不可达，退避中，跳过本次（到 ' + new Date(until).toLocaleTimeString('zh-CN') + ' 再试）');
    return;
  }
  // Atomic PID lease: a live worker never expires before its watchdog.
  const lockFile = path.join(ROOT, 'state', 'campus-watch.lock');
  const release = acquireLease(lockFile);
  if (!release) { console.log('已有检查在运行，跳过本次'); return; }
  const releaseAtExit = () => release();
  process.once('exit', releaseAtExit);
  if (leaseActive(loginLock)) { release(); return; }
  const pre = await preflight();
  if (!pre.okAny && !FORCE) {
    writeUnreachableUntil(Date.now() + UNREACHABLE_BACKOFF_MS, '两个校内域名都连不上');
    logLine('校内站点都不可达，记下 10 分钟退避，本轮不拉浏览器');
    release();
    return;
  }
  if (pre.okAny) writeUnreachableUntil(0, '');
  // 看门狗：180 秒还没结束就强制退出，避免任务堆积（单页超时已收紧到 25s，正常应远低于 180s）。
  const watchdog = setTimeout(() => { logLine('检查超时（180s），强制退出'); release(); process.exit(1); }, 180000);
  watchdog.unref?.();
  const state = readState();
  const changes = [];
  let browser;
  try {
    browser = await ensureBrowser();
    // 用独立的临时标签页跑 BB/收藏夹检查，结束后关闭；yjs 标签页单独复用。
    const page = await browser.newPage();
    if (!LECTURES_ONLY && MONITOR_SCRIPTS.has('blackboard')) {
      await checkBlackboard(page, state, changes);
      await sleep(1500);
    }
    await checkLectures(page, state, changes, FORCE);
    if (!LECTURES_ONLY && WATCH_PLUGIN_CONFIG.webWatchEnabled !== false && WATCH_SITES.length && MONITOR_SCRIPTS.has('bookmarks')) {
      await sleep(1500);
      await checkBookmarks(page, state, changes);
    }
    // Keep the most recent session snapshot; do not move any visible window.
    saveCookies(path.join(ROOT, 'state', 'campus-cookies.json'), await browser.defaultBrowserContext().cookies());
    try { await page.close(); } catch {}
    await browser.disconnect();
    clearTimeout(watchdog);
  } catch (error) {
    logLine('检查失败：' + (error?.message ?? error));
    reportScriptHeartbeat(ROOT, 'scripts/campus-watch.mjs', false, error?.message ?? String(error));
    stageWebChanges(state, changes);
    saveState(state);
    try { await browser?.disconnect(); } catch {}
    release();
    clearTimeout(watchdog);
    process.exitCode = 1;
    return;
  }
  // Store raw diffs before calling AI: a crash or failed send must not lose changes.
  const notificationChanges = stageWebChanges(state, changes);
  saveState(state);
  // 登录失效 → 临时弹出登录窗口；登录后关闭它并恢复同一 profile 的无头浏览器。
  if (changes.some(c => c.kind === 'login')) {
    try {
      // 30 分钟去重：登录窗口导出 cookie 后会自删锁，靠锁判断会每分钟重弹；这里用持久时间戳兜住。
      let recent = Date.now() - (Number(state.lastLoginPopAt) || 0) < 30 * 60 * 1000;
      recent = recent || leaseActive(loginLock);
      if (!recent) {
        const targets = changes.filter(c => c.kind === 'login' && c.url).map(c => ({ name: c.name || '监控网页', url: c.url }));
        fs.writeFileSync(path.join(ROOT, 'state', 'campus-login-request.json'), JSON.stringify({ at: Date.now(), targets }, null, 2), 'utf8');
        state.lastLoginPopAt = Date.now();
        saveState(state);
        const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'login-window.mjs')], { cwd: ROOT, detached: true, stdio: 'ignore' });
        child.unref();
        logLine('检测到登录失效，已弹出登录窗口');
        for (const c of changes) if (c.kind === 'login') c.msg += '（已自动弹出登录窗口，请在窗口里登录）';
      }
    } catch (error) { logLine('弹出登录窗口失败：' + (error?.message ?? error)); }
  }
  state.webSummaryCache ||= {};
  const prepared = await prepareWebNotifications(notificationChanges, {
    cache: state.webSummaryCache,
    generate: WATCH_PLUGIN_CONFIG.aiWebSummary === false ? undefined : payload => generateWebSummary(payload, {
      root: ROOT, timeoutMs: WATCH_PLUGIN_CONFIG.summaryTimeoutMs || 35000
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
  const delivery = await dispatchOwnerChanges({
    dir: GRAB_DIR, state, changes: prepared.changes,
    send: (message,meta) => notifyOwner(message,meta)
  });
  for (const health of Object.values(state.monitorHealth || {})) {
    if (health.delivery === 'pending') health.delivery = delivery.sent ? 'green' : 'red';
  }
  if (state.monitorHealth) saveState(state);
  if (delivery.sent) {
    for (const change of prepared.changes) if (change.webDiff) delete state.pendingWebChanges[change.webDiff.id];
    saveState(state);
    logLine('QQ 通知确认成功：' + delivery.count + ' 条');
  } else if (delivery.count) logLine('QQ 通知未确认成功，保留待重试内容');
  else if (!changes.length) logLine('检查完成：无变化');
  else logLine('检查完成：' + new Set(changes.map(c => c.msg)).size + ' 处变化');
  reportScriptHeartbeat(ROOT, 'scripts/campus-watch.mjs', true, '最近一次检查完成');
  release();
}

main();
