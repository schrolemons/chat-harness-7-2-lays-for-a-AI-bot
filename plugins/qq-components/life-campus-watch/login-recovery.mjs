import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {acquireLease} from '../../../scripts/campus-browser-session.mjs';
export function loginPolicy(config={}){return {loginMaxAttempts:config.loginMaxAttempts??3,loginRetryMinutes:config.loginRetryMinutes??5};}
export function validateLoginPolicy(config={}){const p=loginPolicy(config),errors=[];if(!Number.isInteger(p.loginMaxAttempts)||p.loginMaxAttempts<1||p.loginMaxAttempts>20)errors.push('登录尝试上限必须为1–20次');if(!Number.isInteger(p.loginRetryMinutes)||p.loginRetryMinutes<1||p.loginRetryMinutes>1440)errors.push('登录尝试／提醒间隔必须为1–1440分钟');return {ok:errors.length===0,errors};}
export function loginOrigin(url){const value=new URL(url);if(!['http:','https:'].includes(value.protocol)||value.username||value.password)throw Error('无效监管网址');return value.origin;}
export const beijingTime=at=>at?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(at)+'（北京时间）':'本轮未检测到掉线';
export function createLoginRecovery(root,{config={},clock=Date.now}={}){
 const file=path.join(root,'state','campus-login-recovery.json');
 const currentPolicy=()=>{const policy=loginPolicy(typeof config==='function'?config():config);if(!validateLoginPolicy(policy).ok)throw Error('登录恢复配置无效');return policy;};
 currentPolicy();
 function read(){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return {sites:{}};throw error;}}
 function update(fn){const release=acquireLease(file+'.lock');if(!release)throw Error('登录恢复状态正在更新，请稍后重试');try{const state=read();state.sites||={};const value=fn(state);const temp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(temp,file);return structuredClone(value);}finally{release();}}
 const fresh=()=>({phase:'needed',attempts:0,generation:crypto.randomUUID(),nextAttemptAt:0,notices:[],targets:[]});
 const keyFor=url=>loginOrigin(url);
 const get=url=>{const entry=read().sites?.[keyFor(url)];return entry?structuredClone(entry):{phase:'ready',attempts:0,nextAttemptAt:0,targets:[]};};
 function notice(entry,text,kind,now){entry.notices||=[];entry.notices.push({id:'campus-login:'+entry.generation+':'+kind+':'+entry.attempts,text,sourceAt:now,expiresAt:now+currentPolicy().loginRetryMinutes*60000,accepted:false});entry.notices=entry.notices.slice(-22);}
 return {
  get policy(){return currentPolicy();},get,
  claimWindow(){return update(state=>{const now=clock();if(state.lastWindowSpawnAt&&now-state.lastWindowSpawnAt<30000)return false;state.lastWindowSpawnAt=now;return true;});},
  canCheck(url,now=clock()){const entry=get(url);return entry.phase!=='paused'&&!(entry.phase==='waiting'&&now<entry.nextAttemptAt);},
  fail(target,{generation}={}){const key=keyFor(target.url),now=clock();return update(state=>{
   let entry=state.sites[key];if(generation&&entry?.generation!==generation)return {...entry,stale:true};
   if(!entry||entry.phase==='ready')entry=state.sites[key]=fresh();
   const url=new URL(target.url).href,name=String(target.name||'监控网页').slice(0,60);
   if(!entry.targets.some(item=>item.url===url))entry.targets=[...entry.targets,{url,name}].slice(-20);
   if(entry.phase==='paused'||entry.phase==='waiting'&&now<entry.nextAttemptAt)return entry;
   const policy=currentPolicy();entry.attempts++;entry.lastFailureAt=now;entry.firstFailureAt||=now;entry.url=url;entry.nextAttemptAt=now+policy.loginRetryMinutes*60000;entry.phase=entry.attempts>=policy.loginMaxAttempts?'paused':'waiting';entry.name=name;
   const ending=entry.phase==='paused'?'已达到上限，现已暂停此网站监管，不再自动弹窗。请到控制台“网页监督”的该网站状态旁点击“重新监管”。':`请在监控专用窗口完成登录；${policy.loginRetryMinutes}分钟后再次尝试，登录成功后自动验证并转入无头监管。`;
   notice(entry,`【网页监管需要登录】${name}\n网址：${url}\n最近检测到掉线：${beijingTime(now)}\n恢复验证时间：尚未恢复\n第${entry.attempts}/${policy.loginMaxAttempts}次尝试未通过登录验证。${ending}`,'failed',now);
   return entry;
  });},
  recovered(url,generation){const key=keyFor(url),now=clock();return update(state=>{const entry=state.sites[key];if(!entry||entry.generation!==generation||entry.phase==='paused')return {ok:false};entry.phase='ready';entry.attempts=0;entry.nextAttemptAt=0;entry.recoveredAt=now;entry.checkError='';entry.notices=[];entry.noticeError='';notice(entry,`【网页监管已恢复】${entry.name||'监控网页'}\n网址：${entry.url||url}\n最近检测到掉线：${beijingTime(entry.lastFailureAt)}\n恢复验证时间：${beijingTime(now)}\n该网站访问已验证，已恢复其独立会话的无头后台监管。`,'recovered',now);return {ok:true};});},
  retry(url,name){const key=keyFor(url);return update(state=>{const old=state.sites[key]||{};const entry=state.sites[key]={...fresh(),targets:old.targets||[],url,name:name||old.name||'监控网页',requestedUrl:url,requestedAt:clock(),lastFailureAt:['waiting','paused'].includes(old.phase)?old.lastFailureAt||0:0};return entry;});},
  checkFailed(target,error){const now=clock(),key=keyFor(target.url);return update(state=>{const entry=state.sites[key]||=fresh();if(['waiting','paused'].includes(entry.phase))return entry;const notify=entry.phase!=='error';entry.phase='error';entry.url=target.url;entry.name=target.name||entry.name||'监控网页';entry.checkError=String(error).slice(0,240);entry.checkedAt=now;if(notify)notice(entry,`【网页监管访问失败】${entry.name}\n网址：${target.url}\n发现时间：${beijingTime(now)}\n恢复验证时间：尚未恢复\n${entry.checkError}\n未确认登录失效，不自动弹出登录窗口。`,'check-error',now);return entry;});},
  beginBoot(bootId){return update(state=>{if(state.bootId===bootId)return false;state.bootId=bootId;state.lastWindowSpawnAt=0;for(const [key,old]of Object.entries(state.sites)){state.sites[key]={...fresh(),phase:old.phase==='ready'?'ready':'needed',targets:old.targets||[],name:old.name||'监控网页',url:old.url,lastFailureAt:old.lastFailureAt||0,recoveredAt:old.recoveredAt||0};}return true;});},
  pendingNotices(){return Object.values(read().sites||{}).flatMap(entry=>(entry.notices||[]).filter(item=>!item.accepted&&clock()<item.expiresAt)).sort((a,b)=>a.sourceAt-b.sourceAt);},
  noticeResult(id,accepted,error=''){return update(state=>{for(const entry of Object.values(state.sites)){const item=entry.notices?.find(n=>n.id===id);if(item){item.accepted=accepted===true;entry.noticeError=accepted?'':String(error).slice(0,240);entry.lastNoticeAt=clock();return true;}}return false;});}
 };
}
