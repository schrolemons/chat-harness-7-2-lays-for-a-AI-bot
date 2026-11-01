import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startConsoleFixture} from './console-ui-fixture.mjs';
const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,channel:'msedge'});
const pending=[],posts=[],errors=[];
async function until(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('UI request deadline exceeded');await new Promise(r=>setTimeout(r,10));}}
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/socialV2/time-bubbles*',async route=>{
  if(route.request().method()==='GET'){pending.push(route);return;}
  const body=route.request().postDataJSON();posts.push(body);await route.fulfill({json:{ok:true,key:body.key,all:body.slots||[],slots:body.slots||[]}});
 });
 await page.goto(fixture.url);await page.locator('[data-view="setting-l-2"]').first().click();
 await page.waitForFunction(()=>document.querySelector('#v2TbKey option')?.value);
 const save=page.locator('#v2TbSave'),load=page.locator('#v2TbLoad'),select=page.locator('#v2TbKey');
 assert.equal(await save.isDisabled(),true,'initially unhydrated editor cannot save');
 await page.evaluate(()=>{document.getElementById('v2TbKey').innerHTML='<option value="private:1">A</option><option value="private:2">B</option>';});
 await select.selectOption('private:1');
 await save.evaluate(b=>b.disabled=false);await save.click();
 assert.equal(posts.length,0,'handler must reject unhydrated save even if DOM is re-enabled');
 assert.equal(await save.isDisabled(),true);
 await load.click();await page.waitForFunction(()=>document.getElementById('v2TbSave').disabled);
 await until(()=>pending.length);
 await pending.shift().fulfill({json:{ok:false,error:'synthetic read failure'}});
 await page.waitForFunction(()=>document.getElementById('v2TbMsg').textContent.includes('读取失败'));
 assert.equal(await save.isDisabled(),true,'failed load remains locked');
 await load.click();await until(()=>pending.length);
 const stale=pending.shift();await select.selectOption('private:2');
 await stale.fulfill({json:{ok:true,all:[{id:'old',hour:8,minute:0,label:'A slot'}]}});
 await page.waitForTimeout(50);
 assert.equal(await save.isDisabled(),true,'late A response cannot authorize B');
 assert.equal(await page.locator('#v2TimeBubbleRows [data-tb-row]').count(),0,'late A response cannot populate B');
 await load.click();await until(()=>pending.length);
 await pending.shift().fulfill({json:{ok:true,all:[],allLocked:false}});
 await page.waitForFunction(()=>!document.getElementById('v2TbSave').disabled);
 await save.click();await until(()=>posts.length);
 assert.equal(posts[0].key,'private:2');assert.deepEqual(posts[0].slots,[],'a successfully loaded empty schedule is valid');
 await until(()=>pending.length);
 await pending.shift().fulfill({json:{ok:true,all:[],allLocked:false}});
 await page.waitForFunction(()=>!document.getElementById('v2TbSave').disabled);
 await select.selectOption('private:1');await select.selectOption('private:2');
 assert.equal(await save.isDisabled(),true,'switching back still requires a fresh load');
 assert.deepEqual(errors,[]);console.log('PASS initial/failed/inflight load gates, direct-save guard, stale response isolation, selected-session save, valid empty schedule');
}finally{for(const r of pending)await r.abort().catch(()=>{});await browser.close();await fixture.close();}
