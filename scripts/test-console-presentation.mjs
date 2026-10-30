import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startConsoleFixture } from './console-ui-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const fixture=await startConsoleFixture();
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 const page=await browser.newPage();
 await page.route('**/*',r=>new URL(r.request().url()).origin===fixture.url?r.continue():r.abort());
 await page.goto(fixture.url);
 await page.waitForSelector('[data-component-id="ctx-knowledge-quota"]',{state:'attached'});
 for(const id of ['ctx-chat-style','ctx-context-dynamics','ctx-context-lifecycle','ctx-context-runtime','ctx-context-session']) {
  assert.equal(await page.locator('[data-component-id="'+id+'"],.comp-card[data-id="'+id+'"]').count(),0,id+' is internal prompt assembly, not a settings card');
  assert(fixture.componentFixtures.has(id),id+' remains registered');
 }
 assert(await page.locator('[data-component-id="ctx-knowledge-quota"]').count()>0);
 console.log('PASS: five internal prompt cards absent; functional settings and registrations retained');
} finally { await browser.close();await fixture.close(); }
