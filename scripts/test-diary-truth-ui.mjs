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
  {key:'private:222',targetDate:'2026-11-01',targetSent:true,deliveryStatus:'sent',sentAt,lastConfirmedSentAt:sentAt,lastConfirmedDiaryDate:'2026-11-01',scheduledDeliveryStatus:'absent',attempts:[{id:'diary:private:222:2026-11-01:manual:fixture-123',day:'2026-11-01',kind:'manual',stage:'finished',updatedAt:sentAt,reason:'send_unconfirmed',receiptStatus:'uncertain',partsSent:1,partsTotal:2,error:'网络连接异常；错误码=1006507'}]},
  {key:'group:333',targetDate:'2026-11-02',previousDay:'2026-11-01',previousDiaryMissing:true,previousDiaryAvailable:true,previousDiaryStatus:'uncertain'},
 ];
 const posts=[];await page.route('**/api/socialV2/daily-diary',route=>{if(route.request().method()==='POST'){posts.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,pending:posts.at(-1).action==='sendNow',sentCount:1,results:[{day:'2026-11-01',ok:true}]}});}return route.fulfill({json:{ok:true,config:{hour:18,minute:30},conversations:conversations.map(c=>({hasDiary:true,diaryChars:123,diarySource:'memory',...c}))}});});
 await page.route('**/api/plugins/call',async route=>{const body=route.request().postDataJSON();if(body?.tool==='diary_history')return route.fulfill({json:{ok:true,result:{ok:true,dates:[{date:'2026-11-01',keys:['private:111','group:333'],deliveries:[{key:'private:111',status:'legacy_unconfirmed'},{key:'group:333',status:'uncertain'}]}]}}});return route.continue();});
 await page.goto(fixture.url+'/#setting-o-1');
 const cards=page.locator('.diary-session-card');await cards.first().waitFor();
 assert.match(await cards.nth(0).innerText(),/上一窗口旧记录待核对/);
 assert.match(await cards.nth(0).innerText(),/请先在 QQ 核对，再补发已有正文/);
 assert.equal(await cards.nth(0).locator('.diary-session-state').getAttribute('class'),'diary-session-state missing');
 assert.equal(await cards.nth(0).locator('[data-dd-action="catchUpAll"]').isEnabled(),true);
 assert.match(await cards.nth(2).innerText(),/上一窗口投递待核对/);
 assert.match(await cards.nth(2).innerText(),/QQ 未确认全部分段，补发已暂停/);
 assert.doesNotMatch(await cards.nth(2).innerText(),/可直接补发/);
 assert.equal(await cards.nth(2).locator('[data-dd-action="catchUpAll"]').isEnabled(),false);
 assert.doesNotMatch(await cards.nth(1).innerText(),/目标日已确认发送|此窗口已有确认发送/);
 assert.match(await cards.nth(1).innerText(),/01:12/);
 await cards.nth(1).locator('summary').filter({hasText:'投递记录'}).click();
 assert.match(await cards.nth(1).innerText(),/QQ 网关未确认全部分段，请先核对会话 · 分段 1\/2/);
 assert.match(await cards.nth(1).innerText(),/网络连接异常；错误码=1006507/);
 assert.match(await cards.nth(1).innerText(),/2026-10-31 18:30 至 2026-11-01 18:30/);
 assert.match(await cards.nth(1).innerText(),/手动发送不抵扣/);
 assert.match(await cards.nth(1).locator('[data-dd-action="sendNow"]').innerText(),/2026-11-01/);
 assert.doesNotMatch(await page.locator('#section-setting-o-1').innerText(),/22:00|22点/);
 conversations=[{key:'private:222',targetDate:'2026-11-02',targetSent:false,deliveryStatus:'absent',sentAt:0,previousDiaryMissing:false,previousSentAt:Date.parse('2026-11-01T18:31:00+08:00')}];
 await page.locator('#v2DdRefresh').click();await cards.filter({hasText:'上一窗口已发送'}).waitFor();
 assert.match(await cards.first().innerText(),/18:31/);
 // Catch-up remains available while another diary window is being prepared.
 conversations=[{key:'private:111',targetDate:'2026-11-02',hasDiary:false,deliveryStatus:'absent',diaryPending:true,previousDiaryAvailable:true,previousDiaryMissing:true,previousDiaryStatus:'archive_only'}];
 await page.locator('#v2DdRefresh').click();await cards.first().locator('[data-dd-action="sendNow"][disabled]').waitFor();
 assert.equal(await cards.first().locator('[data-dd-action="catchUpAll"]').isEnabled(),true);
 page.once('dialog',d=>d.accept());await cards.first().locator('[data-dd-action="catchUpAll"]').click();await page.waitForFunction(()=>document.getElementById('v2DdMsg').textContent.includes('补发完成'));
 assert.equal(posts.at(-1).action,'catchUpAll');assert.equal(posts.at(-1).key,'private:111');
 conversations=[{key:'private:222',targetDate:'2026-11-02',hasDiary:false,deliveryStatus:'absent',diaryPending:false,previousDiaryAvailable:true,previousDiaryMissing:true,previousDiaryStatus:'absent'}];
 await page.locator('#v2DdRefresh').click();await cards.first().locator('[data-dd-key="private%3A222"]').first().waitFor();
 assert.equal(await cards.first().locator('[data-dd-action="catchUpAll"]').isEnabled(),false,'no matching Console archive means no catch-up');
 assert.equal(await cards.first().locator('[data-dd-action="sendNow"]').isEnabled(),true);
 await cards.first().locator('[data-dd-action="sendNow"]').click();await page.waitForFunction(()=>document.getElementById('v2DdMsg').textContent.includes('已请求'));
 assert.equal(posts.at(-1).action,'sendNow');assert.equal(posts.at(-1).key,'private:222');
 fs.mkdirSync('state/audits/diary-truth-20261101',{recursive:true});
 await page.screenshot({path:'state/audits/diary-truth-20261101/diary-ui.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS diary receipts, actual minute timestamps, configurable windows, independent scheduled status, zero page errors');
}finally{await browser?.close();await fixture.close();}
