// Persist cooldowns and expose read-only per-site monitor status to the console.
import fs from 'node:fs';
import path from 'node:path';
import { parseWatchUrls, parseScriptPaths } from './monitor-config.mjs';
import { leaseActive } from '../../../scripts/web-watch-browser-session.mjs';
const recoveryURL=new URL('./login-recovery.mjs',import.meta.url);recoveryURL.search=new URL(import.meta.url).search;
const {createLoginRecovery,validateLoginPolicy}=await import(recoveryURL.href);
const BOOT_ID=process.pid+':'+performance.timeOrigin;

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  let spawning=null;
  const requestSpawn=(args,onAccepted=()=>{})=>{
    if(spawning)return spawning;
    const accept=value=>{if(value===true)onAccepted();return value===true;};
    try{
      const result=ctx.capabilities?.spawnWebWatch?.(args);
      if(result&&typeof result.then==='function')return spawning=Promise.resolve(result).then(accept,error=>{ctx.warn?.('监控启动失败：'+error.message);return false;}).finally(()=>{spawning=null;});
      return accept(result);
    }catch(error){ctx.warn?.('监控启动失败：'+error.message);return false;}
  };
  const recovery=createLoginRecovery(ctx.root,{config:cfg});
  recovery.beginBoot(BOOT_ID);
  const fast = Math.max(1, Number(cfg.fastCheckMinutes) || 1) * 60000;
  const full = Math.max(1, Number(cfg.fullCheckMinutes) || 30) * 60000;
  const watchUrls = parseWatchUrls(cfg.watchUrls);
  const scriptPaths = parseScriptPaths(cfg.scriptPaths);
  const allScriptPaths=parseScriptPaths((Array.isArray(cfg.scriptPaths)?cfg.scriptPaths:[]).map(item=>typeof item==='object'&&item?{...item,enabled:true}:item));
  const knownSites = () => cfg.webWatchEnabled === false ? [] : watchUrls;

  ctx.registerTool('web_watch_status', {
    description: '只读查看监控网址、脚本选择及各监控灯状态；红灯表示需要管理员协助排查或登录',
    handler: () => {
      const state = readJson(path.join(ctx.root, 'state', 'web-watch-state.json'));
      const heartbeats = readJson(path.join(ctx.root, 'state', 'script-heartbeats.json'));
      const scripts = allScriptPaths.map(script => {
        const beat = heartbeats[script] || {};
        const recent = Number(beat.at) > 0 && Date.now() - Number(beat.at) < Math.max(full * 2, 10 * 60000);
        const description=typeof cfg.scriptDescriptions?.[script]==='string'?cfg.scriptDescriptions[script].replace(/\s+/g,' ').trim().slice(0,240):'';
        return { path: script, description, health: cfg.scriptCollabEnabled === false || !scriptPaths.includes(script) ? 'paused' : recent ? (beat.ok === false ? 'red' : beat.mode === 'fallback' ? 'fallback' : 'green') : Number(beat.at)>0 ? 'stale' : 'unknown', checkedAt: beat.at || null, hint: beat.hint || (recent ? '最近有运行心跳' : '尚未接入运行心跳') };
      });
      const sites = knownSites().map(site => ({ ...site, health: state.monitorHealth?.[site.url] || null }));
      return { ok: true, sites:sites.map(site=>{const entry=recovery.get(site.url),health={...(site.health||{})};if(['waiting','paused'].includes(entry.phase))health.auth='red';else if(entry.phase==='needed')health.auth='unknown';else if(entry.recoveredAt>Number(health.checkedAt||0))health.auth='green';return {...site,health,loginRecovery:{...entry,...recovery.policy}};}), scripts };
    }
  });
  // Admin intent travels through the existing admin-only config route, never an AI tool.
  const validateConfig=config=>{
    const checked=validateLoginPolicy(config),request=config.manualRetry;
    try { parseWatchUrls(config.watchUrls); parseScriptPaths(config.scriptPaths); }
    catch (error) { checked.errors.push(error.message); }
    if(request?.nonce&&request.nonce!==ctx.state.get().lastRetryNonce){
      if(typeof request.nonce!=='string'||request.nonce.length>80||!knownSites().some(site=>site.url===request.url))checked.errors.push('只能重新监管已配置的网址');
    }
    return {...checked,ok:checked.errors.length===0};
  };
  if(cfg.manualRetry?.nonce&&cfg.manualRetry.nonce!==ctx.state.get().lastRetryNonce&&validateConfig(cfg).ok){
      recovery.retry(cfg.manualRetry.url,knownSites().find(site=>site.url===cfg.manualRetry.url)?.name);ctx.state.set({lastFastAt:0,lastFullAt:0,lastRetryNonce:cfg.manualRetry.nonce});
      const busy=leaseActive(path.join(ctx.root,'state','login-window.lock'))||leaseActive(path.join(ctx.root,'state','web-watch.lock'));
      if(!busy)requestSpawn(['--force','--retry-url',cfg.manualRetry.url]);
  }

  return { validateConfig,hooks: { onTick({ now = Date.now() } = {}) {
    if(recovery.pendingNotices().length&&typeof ctx.capabilities?.sendNotificationDetailed==='function'){
      void (async()=>{for(const item of recovery.pendingNotices()){if(!recovery.pendingNotices().some(current=>current.id===item.id))continue;try{const key='private:'+String(ctx.capabilities.getOwnerQQ?.()||'');const result=await ctx.capabilities.sendNotificationDetailed(key,item.text,{id:item.id,sourceAt:item.sourceAt,expiresAt:item.expiresAt});recovery.noticeResult(item.id,result?.ok===true,result?.reason||'');}catch(error){recovery.noticeResult(item.id,false,error.message);break;}}})().catch(error=>ctx.warn?.('登录提示处理失败：'+error.message));
    }
    const hasWebWork = cfg.webWatchEnabled !== false && watchUrls.some(site=>recovery.canCheck(site.url,now));
    if (!hasWebWork) return;
    const spawn = ctx.capabilities?.spawnWebWatch;
    if (typeof spawn !== 'function') return;
    if (leaseActive(path.join(ctx.root, 'state', 'login-window.lock')) || leaseActive(path.join(ctx.root, 'state', 'web-watch.lock'))) return;
    const pending=knownSites().find(site=>{const entry=recovery.get(site.url);return entry.phase==='needed'&&entry.requestedAt&&entry.requestedUrl===site.url;});
    if(pending)return requestSpawn(['--force','--retry-url',pending.url]);
    const s = ctx.state.get(), t = Number(now) || Date.now();
    if (s.lastFastAt && t - s.lastFastAt < fast) return;
    const needFull = !s.lastFullAt || t - s.lastFullAt >= full;
    // A minute tick is a scheduler check, not a reason to navigate every minute.
    if (!needFull) return;
    return requestSpawn([], () => ctx.state.set({ lastFastAt: t, lastFullAt: t }));
  } } };
}
