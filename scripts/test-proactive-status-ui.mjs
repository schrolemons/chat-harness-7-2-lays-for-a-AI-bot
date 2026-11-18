import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import{createRequire}from'node:module';
import{startConsoleFixture}from'./console-ui-fixture.mjs';
const{chromium}=createRequire(import.meta.url)('playwright');
const executablePath=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(fs.existsSync);
const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try{const page=await browser.newPage({viewport:{width:1440,height:1250}}),errors=[];let reads=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/socialV2/states',route=>{reads++;return route.fulfill({json:{ok:true,conversations:[{key:'private:10001',proactive:{conversationAwake:false,stage:reads,willingness:60,source:'evidence-expired',lastAI:{value:55,reason:'今天他没来信',at:Date.parse('2026-11-11T18:51:30+08:00')},review:{required:true,reason:'availability-evidence-expired'},effectiveProbability:.442,effectiveInterval:{minMinutes:6.6000000000000005,maxMinutes:13.200000000000001},nextAt:Date.parse('2026-11-12T21:38:47+08:00'),phase:'scheduled',lastFinishedReason:'no-send',observedAt:Date.now()}}]}});});
 await page.goto(fixture.url+'/#setting-l-1');const root=page.locator('#proactivePreview');await root.getByText('private:10001',{exact:true}).waitFor();
 assert.match(await root.textContent(),/私聊来信直接进入处理/);assert.match(await root.textContent(),/6\.6–13\.2 分钟/);assert.doesNotMatch(await root.textContent(),/evidence-expired|0000000000/);
 const before=reads;await page.waitForFunction(n=>Number(document.querySelector('#proactivePreview dd:nth-of-type(2)')?.textContent)>n,before,{timeout:12000});assert(reads>before,'visible page auto refreshes');
 fs.mkdirSync('state/audits/response-flow-20261112',{recursive:true});await root.screenshot({path:'state/audits/response-flow-20261112/proactive-status.png'});
 for(const width of[768,390]){await page.setViewportSize({width,height:1200});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 assert.deepEqual(errors,[]);console.log('PASS: truthful field labels, historical date, rounded interval, automatic refresh and responsive layout');
}finally{await browser.close();await fixture.close();}
