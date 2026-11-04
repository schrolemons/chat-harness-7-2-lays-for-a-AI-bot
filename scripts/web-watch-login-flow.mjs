import {classifySnapshot} from './web-watch-browser-session.mjs';
import crypto from 'node:crypto';
const origin=url=>{try{return new URL(url).origin;}catch{return '';}};
export async function reuseLoginPage(browser,target,{owned=false}={}){
 const pages=(await browser.pages()).filter(page=>!page.isClosed()),matching=pages.filter(page=>origin(page.url())===origin(target.url));
 const selected=matching.at(-1)||await browser.newPage();
 if(owned)for(const page of matching)if(page!==selected&&/\/(?:login|signin|sign-in)(?:[/?#.]|$)/i.test(page.url()))await page.close().catch(()=>{});
 return {page:selected,reused:matching.includes(selected)};
}
export async function waitForLogin({target,recovery,isReady,notify,sleep,clock=Date.now,signal}){
 const generation=recovery.get(target.url).generation;
 while(!signal?.aborted){
  const entry=recovery.get(target.url);
  if(entry.generation!==generation)return {ready:false,reason:'superseded'};
  if(entry.phase==='paused')return {ready:false,reason:'paused'};
  if(await isReady())return {ready:true,generation};
  if(clock()>=Number(entry.nextAttemptAt||0)){
   const failed=recovery.fail(target,{generation});await notify();
   if(failed.stale)return {ready:false,reason:'superseded'};
   if(failed.phase==='paused')return {ready:false,reason:'paused'};
  }
  await sleep(3000);
 }
 return {ready:false,reason:'aborted'};
}
export async function authenticatedPage(browser,target,snapshot){
 for(const page of await browser.pages()){
  if(page.isClosed()||origin(page.url())!==origin(target.url))continue;
  try{if(classifySnapshot(await snapshot(page),target.url)==='ready')return page;}catch{}
 }
 return null;
}

// SSO may finish in a provider popup without navigating the original login tab.
// A changed cookie set warrants a protected-page probe inside this platform's
// context. Probe tabs never refresh or type into the user's login page.
export async function createLoginProbe({browser,context,target,snapshot,verify,retryMs,clock=Date.now}){
 const signature=async()=>crypto.createHash('sha256').update(JSON.stringify(await context.cookies())).digest('hex');
 const initial=await signature();let last='',lastAt=null;
 return async()=>{
  const page=await authenticatedPage(browser,target,snapshot),cookies=await signature();
  if(!page&&cookies===initial)return false;
  const current=(page?.url()||'')+'|'+cookies,now=clock();
  if(lastAt!==null&&(now-lastAt<10000||current===last&&now-lastAt<retryMs()))return false;
  last=current;lastAt=now;return verify();
 };
}
