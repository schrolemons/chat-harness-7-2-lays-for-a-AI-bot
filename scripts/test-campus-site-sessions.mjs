import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import puppeteer from 'puppeteer-core';
import {createSiteSessions} from './campus-site-sessions.mjs';
test('platform contexts isolate the same identity provider and persist each platform through browser handoff', {timeout:60000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'site-sessions-'));let browser;
 const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');if(req.url==='/grant'){res.setHeader('set-cookie','identity=platform-A; Path=/');res.end('<main>ok</main>');}else res.end('<main>'+String(req.headers.cookie||'empty')+'</main>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
 const launch=headless=>puppeteer.launch({executablePath,headless,args:['--no-proxy-server','--window-position=-32000,-32000']});
 t.after(async()=>{await browser?.close().catch(()=>{});await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:300});});
 browser=await launch(false);let sessions=createSiteSessions(root,browser,{seedLegacy:false});
 const a=await sessions.context('https://platform-a.example/'),b=await sessions.context('https://platform-b.example/');assert.notEqual(a,b);assert.equal(await sessions.context('https://platform-a.example/another-path'),a);
 const pa=await a.newPage();await pa.goto(origin+'/grant');await pa.evaluate(()=>localStorage.setItem('account','A'));
 const pb=await b.newPage();await pb.goto(origin+'/private');assert.equal(await pb.evaluate(()=>document.body.innerText),'empty');assert.equal(await pb.evaluate(()=>localStorage.getItem('account')),null);
 await sessions.checkpoint();await sessions.close();await browser.close();browser=await launch(true);sessions=createSiteSessions(root,browser);
 const resumed=await sessions.page('https://platform-a.example/');await resumed.goto(origin+'/private');assert.match(await resumed.evaluate(()=>document.body.innerText),/platform-A/);assert.equal(await resumed.evaluate(()=>localStorage.getItem('account')),'A');
 await resumed.evaluate(()=>localStorage.removeItem('account'));await resumed.reload();assert.equal(await resumed.evaluate(()=>localStorage.getItem('account')),null,'manual logout must not restore an old storage value');
 const other=await sessions.page('https://platform-b.example/');await other.goto(origin+'/private');assert.equal(await other.evaluate(()=>document.body.innerText),'empty');await sessions.close();
});
test('one-time legacy migration seeds only the exact platform domain, never another platform or shared IdP',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'site-seed-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'state'));fs.writeFileSync(path.join(root,'state/campus-cookies.json'),JSON.stringify([{name:'own',value:'A',domain:'.a.example',path:'/'},{name:'other',value:'B',domain:'b.example',path:'/'},{name:'idp',value:'X',domain:'identity.example',path:'/'}]));
 const received=[];const context={newPage:async()=>{throw Error('unexpected page');},id:'synthetic',setCookie:async(...items)=>received.push(...items),pages:async()=>[],cookies:async()=>received,close:async()=>{}};
 const sessions=createSiteSessions(root,{createBrowserContext:async()=>context});await sessions.context('https://a.example/');assert.deepEqual(received.map(x=>x.name),['own']);await sessions.close();
});
