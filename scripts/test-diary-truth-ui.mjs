import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {startConsoleFixture} from './console-ui-fixture.mjs';

const fixture=await startConsoleFixture();let browser;
try{
 fixture.state.v2.dailyDiary={enabled:true,hour:18,minute:30,maxChars:500};
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const sentAt=Date.parse('2026-11-01T01:12:00+08:00');
 let conversations=[
  {key:'private:111',targetDate:'2026-11-02',lastDiaryDate:'2026-11-01',targetSent:true,deliveryStatus:'sent',sentAt:0,previousDay:'2026-11-01',previousDiaryMissing:true,previousDiaryAvailable:true,previousDiaryStatus:'legacy_unconfirmed'},
  {key:'private:222',targetDate:'2026-11-01',targetSent:true,deliveryStatus:'sent',sentAt,lastConfirmedSentAt:sentAt,lastConfirmedDiaryDate:'2026-11-01',scheduledDeliveryStatus:'absent'},
 ];
 await page.route('**/api/socialV2/daily-diary',route=>route.fulfill({json:{ok:true,config:{hour:18,minute:30},conversations:conversations.map(c=>({hasDiary:true,diaryChars:123,diarySource:'memory',...c}))}}));
 await page.goto(fixture.url+'/#setting-o-1');
 const cards=page.locator('.diary-session-card');await cards.first().waitFor();
 assert.match(await cards.nth(0).innerText(),/昨日日记未发送/);
 assert.match(await cards.nth(0).innerText(),/可直接补发已有正文，不调用模型/);
 assert.equal(await cards.nth(0).locator('.diary-session-state').getAttribute('class'),'diary-session-state missing');
 assert.equal(await cards.nth(0).locator('[data-dd-action="catchUpAll"]').isEnabled(),true);
 assert.doesNotMatch(await cards.nth(1).innerText(),/目标日已确认发送|此窗口已有确认发送/);
 assert.match(await cards.nth(1).innerText(),/01:12/);
 assert.match(await cards.nth(1).innerText(),/2026-10-31 18:30 至 2026-11-01 18:30/);
 assert.match(await cards.nth(1).innerText(),/手动发送不抵扣/);
 assert.match(await cards.nth(1).locator('[data-dd-action="sendNow"]').innerText(),/2026-11-01/);
 assert.doesNotMatch(await page.locator('#section-setting-o-1').innerText(),/22:00|22点/);
 conversations=[{key:'private:222',targetDate:'2026-11-02',targetSent:false,deliveryStatus:'absent',sentAt:0,previousDiaryMissing:false,previousSentAt:Date.parse('2026-11-01T18:31:00+08:00')}];
 await page.locator('#v2DdRefresh').click();await cards.filter({hasText:'上一窗口已发送'}).waitFor();
 assert.match(await cards.first().innerText(),/18:31/);
 fs.mkdirSync('state/audits/diary-truth-20261101',{recursive:true});
 await page.screenshot({path:'state/audits/diary-truth-20261101/diary-ui.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS diary receipts, actual minute timestamps, configurable windows, independent scheduled status, zero page errors');
}finally{await browser?.close();await fixture.close();}
