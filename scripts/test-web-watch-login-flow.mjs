import crypto from 'node:crypto';import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createLoginRecovery} from '../plugins/qq-components/life-web-watch/login-recovery.mjs';
import {waitForLogin,reuseLoginPage,authenticatedPage,createLoginProbe} from './web-watch-login-flow.mjs';
import {matchesMonitorBrowser} from './web-watch-browser-ownership.mjs';
import {flushLoginNotices} from './web-watch-login-notifications.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
const target={name:'合成课程',url:'https://course.example/private'};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'login-flow-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({ownerQQ:123,consolePort:4199,consoleToken:'fixture-console-token'}));let now=10000000;return {root,recovery:createLoginRecovery(root,{clock:()=>now}),clock:()=>now,sleep:async ms=>{now+=ms;}};}
test('failed checks and QQ notices use the same interval, stop at N, and use no agent token or LLM',async t=>{
 const f=fixture(t),sent=[];f.recovery.fail(target);
 const notify=()=>flushLoginNotices({...f,send:async request=>{assert.equal(request.endpoint,'http://127.0.0.1:4199');assert.equal(request.key,'private:123');sent.push({at:f.clock(),item:request.items[0]});return true;}});
 await notify();const result=await waitForLogin({...f,target,notify,isReady:async()=>false});
 assert.equal(result.reason,'paused');assert.equal(sent.length,3);assert.equal(sent[1].at-sent[0].at,300000);assert.equal(sent[2].at-sent[1].at,300000);assert.match(sent[2].item.text,/暂停/);
 await notify();assert.equal(sent.length,3);
});
test('successful login is detected between attempts and a new SSO tab is considered',async t=>{
 const f=fixture(t);f.recovery.fail(target);let polls=0;
 const result=await waitForLogin({...f,target,notify:async()=>{},isReady:async()=>++polls===2});assert.equal(result.ready,true);assert.equal(f.recovery.get(target.url).attempts,1);
 const old={isClosed:()=>false,url:()=>target.url+'/login',snapshot:{url:target.url+'/login',text:'请登录'}},newTab={isClosed:()=>false,url:()=>target.url,snapshot:{url:target.url,text:'课程资源'}};
 assert.equal(await authenticatedPage({pages:async()=>[old,newTab]},target,page=>page.snapshot),newTab);
});
test('existing managed login tab is reused and only duplicate login tabs are closed',async()=>{
 let created=0,closed=0;const pages=[1,2].map(n=>({isClosed:()=>false,url:()=>target.url+'/login?copy='+n,close:async()=>{closed++;}}));
 const selected=await reuseLoginPage({pages:async()=>pages,newPage:async()=>{created++;}},target,{owned:true});assert.equal(created,0);assert.equal(selected.page,pages[1]);assert.equal(closed,1);
 const directory=path.resolve('synthetic monitor profile');assert(matchesMonitorBrowser('msedge "--user-data-dir='+directory+'" --remote-debugging-port=9222',{profile:directory,port:9222}));assert(!matchesMonitorBrowser('msedge "--user-data-dir='+directory+'" --remote-debugging-port=9223',{profile:directory,port:9222}));
});
test('console retry is administrator-only, validates the target and does not reset another site',async()=>{
 const h=await bridgeHarness({files:{'state/plugins/config/life-web-watch.json':{watchUrls:['公告 | '+target.url]}}});let server;
 try{
  const recovery=createLoginRecovery(h.temp,{config:{loginMaxAttempts:1}});recovery.fail(target);recovery.fail({url:'https://other.example/private',name:'其他站点'});
  server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  const key='group:456';const token=h.getSocialV2State(key).agentToken;
  const call=(url,agent=false,nonce=crypto.randomUUID())=>fetch(base+'/api/plugins/config',{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token',...(agent?{'x-agent-call':'1','x-agent-token':token}:{})},body:JSON.stringify({id:'life-web-watch',config:{manualRetry:{url,nonce}}})});
  assert.equal((await call(target.url,true)).status,403);assert.equal(recovery.get(target.url).phase,'paused');
  const bad=await (await call('https://unconfigured.example/')).json();assert.equal(bad.ok,false);
  const nonce=crypto.randomUUID();const done=await (await call(target.url,false,nonce)).json();assert.equal(done.ok,true);assert.equal(recovery.get(target.url).attempts,0);assert.equal(recovery.get('https://other.example/private').phase,'paused');
  recovery.fail(target);assert.equal(recovery.get(target.url).phase,'paused');
  assert.equal((await (await call(target.url,false,nonce)).json()).ok,true);assert.equal(recovery.get(target.url).phase,'paused','reloading a consumed nonce must not reset attempts');
  assert.equal((await (await call(target.url)).json()).ok,true);
  const status=await h.pluginHost.callTool('web_watch_status',{});assert.equal(status.result.sites[0].loginRecovery.attempts,0);
 }finally{if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}await h.close();}
});

test('SSO cookie changes trigger validation even if the original login tab stays at the identity provider',async()=>{
 let cookies=[{name:'session',value:'before'}],calls=0,now=10000000;
 const probe=await createLoginProbe({browser:{pages:async()=>[]},context:{cookies:async()=>cookies},target,snapshot:async()=>{},verify:async()=>{calls++;return true;},retryMs:()=>300000,clock:()=>now});assert.equal(await probe(),false);assert.equal(calls,0);cookies=[{name:'session',value:'after'}];assert.equal(await probe(),true);assert.equal(calls,1);assert.equal(await probe(),false);assert.equal(calls,1);
});

test('transient access failures send nothing; persistent page failures notify once and recover only on the same page',async t=>{
 const f=fixture(t),sent=[],other={url:target.url+'/other',name:'另一课程'};
 const notify=()=>flushLoginNotices({...f,send:async request=>{sent.push(request.items[0]);return true;}});
 f.recovery.checkFailed(target,'读取暂时失败');await notify();await f.sleep(3000);f.recovery.checkRecovered(target.url);await notify();assert.equal(sent.length,0);
 f.recovery.checkFailed(target,'读取失败');await f.sleep(300000);f.recovery.checkRecovered(other.url);f.recovery.checkFailed(target,'复查仍失败');await notify();assert.equal(sent.length,1);assert(sent[0].text.includes(target.url));
 f.recovery.checkRecovered(other.url);await notify();assert.equal(sent.length,1);
 f.recovery.checkRecovered(target.url);await notify();assert.equal(sent.length,2);assert.match(sent[1].text,/原先失败的页面/);
});
