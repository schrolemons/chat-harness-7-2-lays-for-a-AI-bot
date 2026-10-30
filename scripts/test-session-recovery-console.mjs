import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {startConsoleFixture} from './console-ui-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const exe=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(x=>fs.existsSync(x));
test('operations owns one recovery switch with bounded parameters, nearby examples and a specific save button',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath:exe});
 try{const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.url+'/#operations');const section=page.locator('#section-maintenance');
  const panel=section.locator('details').filter({has:page.locator('[data-component-slot="obs-session-recovery"]')});
  assert.equal(await panel.count(),1);assert.notEqual(await panel.getAttribute('open'),null);
  const slot=panel.locator('[data-component-slot="obs-session-recovery"]');await slot.locator('.comp-enabled').waitFor();
  assert.equal(await slot.locator('.comp-enabled').isVisible(),true);
  const advanced=slot.locator('details.parameter-group');assert.equal(await advanced.getAttribute('open'),null);
  assert(await advanced.locator('summary').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el,'::after').transform).b)>0,'closed nested group must show a downward arrow');
  await advanced.locator('summary').click();
  assert.equal(await slot.locator('input[type="checkbox"]').count(),1);assert.equal(await slot.locator('input[type="number"]').count(),4);
  assert((await slot.innerText()).includes('全局'));assert.equal(await slot.locator('.parameter-example').count(),4);
  assert((await slot.innerText()).includes('保存全局会话自动恢复设置'));assert(!errors.length,errors.join('\n'));
  const notes=section.locator('[data-component-slot="tool-user-checking"]');await notes.locator('.comp-enabled').waitFor();assert.equal(await notes.locator('.comp-enabled').isVisible(),true);assert.equal(await notes.locator('input[type="checkbox"]').count(),1);assert.equal(await notes.locator('details.parameter-group').getAttribute('open'),null);assert((await notes.locator('..').innerText()).includes('故障'));
  for(const width of [1280,768]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 }finally{await browser.close();await fixture.close();}
});
