import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
import {startConsoleFixture} from './console-ui-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright'),executablePath=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(fs.existsSync);
test('cost panel explains one source for conversations and tasks with editable default and upgrade controls',async()=>{
 execFileSync(process.execPath,['scripts/build-console.mjs'],{cwd:process.cwd(),windowsHide:true});
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(fixture.url+'/#usage');const slot=page.locator('[data-component-slot="obs-cost-policy"]');await slot.waitFor({state:'attached'});
  for(const ancestor of await slot.locator('xpath=ancestor::details').all())if(await ancestor.getAttribute('open')===null)await ancestor.locator(':scope > summary').click();
  const model=page.locator('#cfg-obs-cost-policy-defaultModel'),effort=page.locator('#cfg-obs-cost-policy-defaultEffort');await model.waitFor();await model.selectOption('deepseek-v4-pro');await effort.selectOption('max');assert.equal(await model.inputValue(),'deepseek-v4-pro');assert.equal(await effort.inputValue(),'max');
  const text=await slot.innerText();assert.match(text,/唯一调用策略/);assert.match(text,/未完成任务/);assert.match(text,/正在生成的请求不追溯切换/);assert.match(text,/升级档位/);assert.match(text,/压缩摘要保持独立/);assert.equal(await slot.locator('.comp-enabled').count(),0);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1100});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(process.env.COST_POLICY_UI_ARTIFACTS){fs.mkdirSync(process.env.COST_POLICY_UI_ARTIFACTS,{recursive:true});await slot.screenshot({path:path.join(process.env.COST_POLICY_UI_ARTIFACTS,'cost-'+width+'.png')});}}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});
