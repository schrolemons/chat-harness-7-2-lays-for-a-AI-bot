#!/usr/bin/env node
// A platform owns its login context, cookies and storage. Never borrow another login.
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import puppeteer from 'puppeteer-core';
import {createOwnedMonitorClient} from './owned-monitor-client.mjs';
import {acquireLease,classifyNavigation,selectLoginTargets} from './web-watch-browser-session.mjs';
import {createSiteSessions} from './web-watch-site-sessions.mjs';
import {reuseLoginPage,waitForLogin,createLoginProbe} from './web-watch-login-flow.mjs';
import {createLoginRecovery,loginOrigin} from '../plugins/qq-components/life-web-watch/login-recovery.mjs';
import {flushLoginNotices} from './web-watch-login-notifications.mjs';
import {extractPageSnapshot} from '../plugins/qq-components/life-web-watch/web-changes.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let ownedCleanup=async()=>{};
const ownedMonitor=createOwnedMonitorClient({root:ROOT,kind:'login-window',onShutdown:()=>ownedCleanup()});
const read=(file,fallback={})=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));}catch{return fallback;}};
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const log=message=>{const line='['+new Date().toISOString()+'] '+message;fs.appendFileSync(path.join(ROOT,'state','login-window.log'),line+'\n');console.log(line);};
const recovery=createLoginRecovery(ROOT,{config:()=>read('state/plugins/config/life-web-watch.json')});
const notify=()=>flushLoginNotices({root:ROOT,recovery,log});
async function launch(headless) {
 if (ownedMonitor) return ownedMonitor.connect(headless);
 return puppeteer.launch({executablePath:EDGE,headless,args:['--no-proxy-server']});
}
async function closeBrowser(browser) {
 if (!browser) return;
 if (ownedMonitor) await browser.disconnect();
 else await browser.close();
}
const snapshot=page=>page.evaluate(extractPageSnapshot);
async function main(){
 const releaseLogin=acquireLease(path.join(ROOT,'state','login-window.lock'));if(!releaseLogin){log('已有登录协助进程，不再创建标签');return;}
 let browser,sessions,context,releaseProfile,activeTarget,generation,resume=false;
 ownedCleanup=async()=>{await sessions?.close();await closeBrowser(browser);releaseProfile?.();releaseLogin();};
 const scoped=()=>({pages:()=>context.pages(),newPage:()=>context.newPage()});
 async function attach(){sessions=createSiteSessions(ROOT,browser,{strictClose:!!ownedMonitor});context=await sessions.context(activeTarget.url);}
 async function transition(headless){if(ownedMonitor){await ownedMonitor.cleanup(()=>sessions?.checkpoint());await ownedMonitor.cleanup(()=>sessions?.close());await ownedMonitor.cleanup(()=>browser.disconnect());}else{await sessions?.checkpoint();await closeBrowser(browser);}browser=await launch(headless);await attach();}
 try{
  const deadline=Date.now()+190000;
  while(!(releaseProfile=acquireLease(path.join(ROOT,'state','web-watch.lock')))){if(Date.now()>=deadline)throw Error('后台检查尚未结束');await sleep(1000);}
  const requested=read('state/web-watch-login-request.json');
  const targets=selectLoginTargets(Date.now()-Number(requested.at)<30*60000?requested:{},[]);
  activeTarget=targets.find(target=>recovery.get(target.url).phase==='waiting');if(!activeTarget)return;
  const sameSite=targets.filter(target=>loginOrigin(target.url)===loginOrigin(activeTarget.url));generation=recovery.get(activeTarget.url).generation;
  await notify();browser=await launch(false);
  await attach();const {page,reused}=await reuseLoginPage(scoped(),activeTarget,{owned:true});
  if(!reused)await page.goto(activeTarget.url,{waitUntil:'domcontentloaded',timeout:25000}).catch(()=>{});
  await page.bringToFront().catch(()=>{});log('已打开或复用该平台独立登录标签；不自动填账号密码、不刷新等待页');
  async function verify(){
   const probe=await context.newPage();try{for(const target of sameSite){let navigationSucceeded=true,response;try{response=await probe.goto(target.url,{waitUntil:'domcontentloaded',timeout:25000});}catch{navigationSucceeded=false;}if(classifyNavigation(await snapshot(probe),target.url,{navigationSucceeded,httpStatus:response?.status()||200})!=='ready')return false;}return true;}finally{await probe.close().catch(()=>{});}
  }
  const isReady=await createLoginProbe({browser:scoped(),context,target:activeTarget,snapshot,verify,retryMs:()=>recovery.policy.loginRetryMinutes*60000});
  const result=await waitForLogin({target:activeTarget,recovery,notify,sleep,isReady});
  await transition(true);
  if(!result.ready){log('登录协助结束：'+result.reason);return;}
  if(!(await verify()))throw Error('无头交接后的原平台访问验证未通过');
  if(ownedMonitor)await ownedMonitor.cleanup(()=>sessions.checkpoint());else await sessions.checkpoint();
  if(recovery.recovered(activeTarget.url,result.generation).ok){await notify();resume=true;log('该平台登录及无头访问均已验证，恢复后台监管');}
 }catch(error){log('登录协助异常：'+error.message);if(activeTarget&&recovery.get(activeTarget.url).generation===generation){recovery.fail(activeTarget,{generation});await notify().catch(()=>{});}}
 finally{try{await sessions?.close();}catch(error){ownedMonitor?.noteCleanupFailure(error);log('保存平台会话失败：'+error.message);}try{await closeBrowser(browser);}catch(error){ownedMonitor?.noteCleanupFailure(error);}releaseProfile?.();releaseLogin();}
 if(resume&&ownedMonitor){await ownedMonitor.spawn('web-watch',['--force','--retry-url',activeTarget.url]);return;}
 if(resume){const child=spawn(process.execPath,[path.join(ROOT,'scripts','web-watch.mjs'),'--force','--retry-url',activeTarget.url],{cwd:ROOT,detached:true,stdio:'ignore',windowsHide:true});child.unref();}
}
main().catch(error=>{log('登录恢复未完成：'+error.message);process.exitCode=1;}).finally(()=>ownedMonitor?.dispose());
