import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {startConsoleFixture} from './console-ui-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const executablePath=[join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(existsSync);
test('budget cycle loads real time, saves only its own field, survives reload and preserves drafts on errors',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});let release;
 const waiting=new Promise(resolve=>{release=resolve;});
 fixture.componentFixtures.get('life-token-budget').config.dailyResetTime='04:30';
 try{
  const page=await browser.newPage();
  await page.route('**/api/plugins/detail?id=life-token-budget',async route=>{await waiting;await route.continue();});
  await page.goto(fixture.url);await page.locator('[data-view="usage"]').first().click();
  const clock=page.locator('#usageBudgetResetTime'),save=page.locator('#usageBudgetResetSave');await clock.waitFor({timeout:2000});
  assert(await save.isDisabled());release();await page.waitForFunction(()=>!document.getElementById('usageBudgetResetSave').disabled);
  assert.equal(await clock.inputValue(),'04:30');await clock.fill('06:45');await page.locator('#usageGlobalLimit').fill('17');
  await save.click();await page.waitForFunction(()=>document.getElementById('usageBudgetResetMsg').textContent.includes('已保存'));
  assert.equal(fixture.componentFixtures.get('life-token-budget').config.dailyResetTime,'06:45');
  const write=fixture.requests.filter(x=>x.path==='/api/plugins/config'&&x.body.id==='life-token-budget').at(-1);
  assert.deepEqual(write.body.config,{dailyResetTime:'06:45'});assert.equal(await page.locator('#usageGlobalLimit').inputValue(),'17');
  assert.match(await page.locator('#usageBudgetCycleSummary').innerText(),/06:45/);
  await page.reload();await page.locator('[data-view="usage"]').first().click();await page.waitForFunction(()=>document.getElementById('usageBudgetResetTime').value==='06:45');
  await page.route('**/api/plugins/config',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:'fixture save failed'})}));
  await clock.fill('07:00');await save.click();await page.waitForFunction(()=>document.getElementById('usageBudgetResetMsg').textContent.includes('保存失败'));
  assert.equal(await clock.inputValue(),'07:00');assert.match(await page.locator('#usageBudgetCycleSummary').innerText(),/06:45/);
  assert.equal(fixture.componentFixtures.get('life-token-budget').config.dailyResetTime,'06:45');
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 }finally{release();await browser.close();await fixture.close();}
});
