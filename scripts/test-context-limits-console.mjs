import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {startConsoleFixture} from './console-ui-fixture.mjs';import {CONTEXT_LIMIT_FIELDS} from '../src/bridge-core/context-limits.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright'),executablePath=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(x=>fs.existsSync(x));
test('Console message limits save to their canonical APIs, preserve zero and match runtime bounds',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.url+'/#setting-c-1');await page.locator('[data-page="setting-c-1"] details').filter({has:page.locator('#context-wakeRecentLimit')}).locator('summary').click();await page.locator('#context-wakeRecentLimit').waitFor({state:'visible'});
  for(const key of ['wakeRecentLimit','wakeMessageLimit','wakeHistoryMessageMaxChars','wakePendingMessageMaxChars','wakeMaxChars','weakWakeMaxChars']){const input=page.locator('#context-'+key);assert.equal(Number(await input.getAttribute('min')),CONTEXT_LIMIT_FIELDS[key].min);assert.equal(Number(await input.getAttribute('max')),CONTEXT_LIMIT_FIELDS[key].max);}
  assert((await page.locator('#contextReceiptRange').innerText()).includes('最近'+(fixture.state.v2.doubleStamp?.windowCount??8)+'条非bot入站消息'));
  for(const [id,value]of [['context-wakeRecentLimit','7'],['context-wakeHistoryMessageMaxChars','0'],['context-wakeMessageLimit','3'],['context-wakePendingMessageMaxChars','120'],['context-wakeMaxChars','6000'],['context-weakWakeMaxChars','900'],['v2ContextWindow','12'],['v2ContextUnreadLimit','80'],['v2ContextRecentLimit','160']])await page.locator('#'+id).fill(value);
  await page.locator('[data-page="setting-c-1"] .v2-save').click();await page.waitForFunction(()=>document.querySelector('[data-page="setting-c-1"] .v2-save-msg')?.textContent.includes('已保存'));
  const config=(await(await page.request.get(fixture.url+'/api/socialV2/config')).json()).config.context;assert.equal(config.wakeRecentLimit,7);assert.equal(config.wakeHistoryMessageMaxChars,0);assert.equal(config.wakePendingMessageMaxChars,120);assert.equal(config.contextWindow,12);assert.equal(config.unreadLimit,80);
  await page.locator('#usageRecoveryPrivate').fill('4');await page.locator('#usageRecoveryGroupAt').fill('2');await page.locator('#usageRecoveryGroup').fill('3');await page.locator('#usageRecoverySave').click();await page.waitForFunction(()=>document.querySelector('#contextBudgetWindowsMsg')?.textContent.includes('已保存'));
  const budget=await(await page.request.get(fixture.url+'/api/tokens/budgets')).json();assert.deepEqual(budget.recoveryWindows,{privateMessages:4,groupMessages:3,groupAtMessages:2});assert.equal(await page.locator('#usageRecoveryPrivate').count(),1);
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1100});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow at '+width);}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});
