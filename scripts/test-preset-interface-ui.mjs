import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startConsoleFixture} from './console-ui-fixture.mjs';
const fixture=await startConsoleFixture();
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(fixture.url+'/#environment-admin');
 await page.locator('#v2AdminDevEnabled').waitFor({state:'visible'});
 assert.equal(await page.locator('#envAdminControls select,#v2AdminDevPreset').count(),0);
 assert.match(await page.locator('#envAdminEnabledExample').textContent(),/qq-admin.*当前聊天模式/);
 for(const enabled of [true,false]) {
  await page.locator('#v2AdminDevEnabled').setChecked(enabled);
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/socialV2/config')&&r.request().method()==='POST');
  await page.locator('#envAdminControls .v2-save').click();
  assert.equal((await saved).status(),200);
  assert.equal(fixture.state.v2.adminDev.enabled,enabled);
  await page.reload();await page.locator('#v2AdminDevEnabled').waitFor({state:'visible'});
  assert.equal(await page.locator('#v2AdminDevEnabled').isChecked(),enabled);
 }
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 console.log('PASS fixed admin UI, save on/off, persisted reload, mobile layout, zero page errors');
} finally {await browser.close();await fixture.close();}
