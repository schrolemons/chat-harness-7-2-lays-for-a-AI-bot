// Generic, opt-in website monitor. Contains no institution, account, target URL or personal automation.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import puppeteer from 'puppeteer-core';
import {parseWatchUrls} from '../plugins/qq-components/life-campus-watch/monitor-config.mjs';
import {extractPageSnapshot,buildWebChange,stageWebChanges,prepareWebNotifications} from '../plugins/qq-components/life-campus-watch/web-changes.mjs';
import {generateWebSummary} from '../plugins/qq-components/life-campus-watch/summarizer.mjs';
import {resolveConsoleToken} from '../plugins/qq-components/obs-bridge-health/health.mjs';
import {reportScriptHeartbeat} from './script-heartbeat.mjs';
import {notificationBatches} from './web-notification-items.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),stateFile=path.join(root,'state','campus-watch-state.json');
const read=(file,fallback={})=>{try{return JSON.parse(fs.readFileSync(file));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const save=state=>{fs.mkdirSync(path.dirname(stateFile),{recursive:true});const temp=stateFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(temp,stateFile);};
async function main(){
 const config=read(path.join(root,'config.json')),options=read(path.join(root,'state/plugins/config/life-campus-watch.json'));
 const sites=parseWatchUrls(options.watchUrls||[]);if(options.webWatchEnabled===false||!sites.length)return;
 const state=read(stateFile),changes=[];state.monitorHealth ||= {};
 const executablePath=process.env.CHAT_HARNESS_BROWSER||options.browserExecutable||[path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.ProgramFiles||'C:\\Program Files','Google/Chrome/Application/chrome.exe')].find(file=>fs.existsSync(file));
 if(!executablePath)throw Error('Choose your browserExecutable in the local monitor configuration');
 const browser=await puppeteer.launch({executablePath,headless:true,userDataDir:path.join(root,'state','website-browser'),args:['--no-first-run','--no-default-browser-check']});
 try{for(const site of sites){const health=state.monitorHealth[site.url] ||= {};health.checkedAt=Date.now();let page;
  try{page=await browser.newPage();await page.goto(site.url,{waitUntil:'networkidle2',timeout:25000});const snapshot=await page.evaluate(extractPageSnapshot);
   if(!snapshot.text||new URL(snapshot.url).host!==new URL(site.url).host)throw Error('Page unavailable or redirected to another host');
   if(/请登录|统一身份认证登录|Sign in|请输入用户名/i.test(snapshot.text)){health.auth='red';health.hint='请在自己的浏览器会话中完成登录';continue;}
   const previous=state[site.url],change=previous?buildWebChange({site,previous,current:snapshot}):null;
   state[site.url]={lines:snapshot.lines,linkDetails:snapshot.links,contentVersion:2};Object.assign(health,{fetch:'green',auth:'green',diff:change?'changed':previous?'stable':'baseline'});if(change)changes.push(change);
  }catch(error){health.fetch='red';health.hint=error.message;}finally{await page?.close().catch(()=>{});}}
 }finally{await browser.close();}
 const pending=stageWebChanges(state,changes);save(state);state.webSummaryCache ||= {};
 const prepared=await prepareWebNotifications(pending,{cache:state.webSummaryCache,generate:options.aiWebSummary===false?undefined:payload=>generateWebSummary(payload,{root})});
 for(const id of prepared.suppressedIds)delete state.pendingWebChanges[id];save(state);
 if(prepared.changes.length){const key='private:'+config.ownerQQ;
  for(const items of notificationBatches(prepared.changes)){
  const response=await fetch('http://127.0.0.1:'+(config.consolePort||3100)+'/api/notifications/send',{method:'POST',headers:{'content-type':'application/json','x-console-token':resolveConsoleToken(root,config)},body:JSON.stringify({key,items}),signal:AbortSignal.timeout(30000)});const out=await response.json();if(!response.ok||!out.ok)throw Error('Notification not accepted');
  }
  for(const change of prepared.changes)delete state.pendingWebChanges[change.webDiff.id];save(state);}
 reportScriptHeartbeat(root,'scripts/campus-watch.mjs',true,'Website monitor completed');
}
main().catch(error=>{reportScriptHeartbeat(root,'scripts/campus-watch.mjs',false,error.message);console.error(error.message);process.exitCode=1;});
