import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';import path from 'node:path';
import {startConsoleFixture} from './console-ui-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const executablePath=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(fs.existsSync);
test('web supervision exposes one interval and cap, renders paused status, and retries only the clicked website',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 let attempts=3,phase='paused',retries=0;const url='https://course.example/private';
 try{
  fixture.componentFixtures.get('life-campus-watch').config.watchUrls=['合成课程 | '+url];
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/plugins/call',async route=>{const body=route.request().postDataJSON();if(body.tool==='campus_watch_status'){await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,result:{ok:true,sites:[{name:'合成课程',url,health:{auth:phase==='ready'?'green':'red'},loginRecovery:{phase,attempts,loginMaxAttempts:3}}],scripts:[]}})});}else await route.continue();});
  await page.route('**/api/plugins/config',async route=>{const body=route.request().postDataJSON();if(body.config?.manualRetry?.nonce){assert.equal(body.config.manualRetry.url,url);attempts=0;phase='needed';retries++;await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});}else await route.continue();});
  await page.goto(fixture.url+'/#environment-watch');
  const root=page.locator('#envCompBrowserWatch');await root.locator('.comp-save').waitFor();
  const cap=root.locator('.comp-field').filter({hasText:'登录尝试／通知上限（次）'}).locator('input');
  const interval=root.locator('.comp-field').filter({hasText:'登录尝试／提醒间隔（分钟）'}).locator('input');
  assert.equal(await cap.inputValue(),'3');assert.equal(await interval.inputValue(),'5');await cap.fill('4');await interval.fill('7');
  await root.locator('.comp-save').click();await page.waitForFunction(()=>document.querySelector('#envCompBrowserWatch .comp-msg')?.textContent.includes('已保存'));
  assert.equal(fixture.componentFixtures.get('life-campus-watch').config.loginMaxAttempts,4);assert.equal(fixture.componentFixtures.get('life-campus-watch').config.loginRetryMinutes,7);
  const status=page.locator('#envMonitorStatus');assert.match(await status.innerText(),/已暂停.*手动重新监管/);assert.match(await status.innerText(),/3\s*\/\s*3/);
  await page.clock.install();
  await status.getByRole('button',{name:'重新监管',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#envMonitorStatus')?.textContent.includes('等待后台验证'));
  assert.equal(retries,1);assert.match(await status.innerText(),/0\s*\/\s*3/);
  phase='ready';await page.clock.fastForward(6000);await page.waitForFunction(()=>document.querySelector('#envMonitorStatus')?.textContent.includes('正常监管'));assert.match(await status.innerText(),/访问正常/);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});

test('each ordinary, Blackboard and lecture row retries its own URL and automatically shows the completed result',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});const sites=[{name:'普通网页',url:'https://public.example/course'},{name:'Blackboard资源',url:'https://bb.example/course/resources'},{name:'讲座平台',url:'https://lecture.example/'}].map(x=>({...x,phase:'paused',attempts:3})),clicked=[];
 try{const page=await browser.newPage();await page.route('**/api/plugins/call',async route=>{const body=route.request().postDataJSON();if(body.tool!=='campus_watch_status')return route.continue();await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,result:{ok:true,sites:sites.map(s=>({...s,health:{auth:s.phase==='ready'?'green':'red'},loginRecovery:{phase:s.phase,attempts:s.attempts,loginMaxAttempts:3}})),scripts:[]}})});});
 await page.route('**/api/plugins/config',async route=>{const body=route.request().postDataJSON(),url=body.config?.manualRetry?.url;if(!url)return route.continue();const site=sites.find(x=>x.url===url);assert(site);clicked.push(url);site.phase='needed';site.attempts=0;await route.fulfill({contentType:'application/json',body:'{"ok":true}'});});
 await page.goto(fixture.url+'/#environment-watch');await page.locator('#envMonitorStatus .watch-site').first().waitFor();await page.clock.install();
 for(const site of sites){const row=page.locator('#envMonitorStatus .watch-site').filter({hasText:site.name});await row.getByRole('button',{name:'重新监管',exact:true}).click();await page.waitForFunction(name=>[...document.querySelectorAll('#envMonitorStatus .watch-site')].find(x=>x.textContent.includes(name))?.textContent.includes('等待后台验证'),site.name);site.phase='ready';await page.clock.fastForward(6000);await page.waitForFunction(name=>[...document.querySelectorAll('#envMonitorStatus .watch-site')].find(x=>x.textContent.includes(name))?.textContent.includes('正常监管'),site.name);}
 assert.deepEqual(clicked,sites.map(x=>x.url));
 }finally{await browser.close();await fixture.close();}
});
