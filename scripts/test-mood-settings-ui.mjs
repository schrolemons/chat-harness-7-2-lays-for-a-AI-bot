import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createPluginHost} from '../src/plugin-host.js';
import {startConsoleFixture} from './console-ui-fixture.mjs';

const id='ctx-user-mood',root=fs.mkdtempSync(path.join(os.tmpdir(),'mood-settings-ui-'));
fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
fs.cpSync(new URL('../plugins/qq-components/ctx-user-mood',import.meta.url),path.join(root,'plugins/qq-components',id),{recursive:true});
const host=createPluginHost({root,startTimers:false});
let fixture,browser;
try {
  await host.loadAll();fixture=await startConsoleFixture();
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage(),writes=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/plugins/config',async route=>{
    const body=route.request().postDataJSON();if(body.id!==id)return route.continue();
    const result=host.setConfig(id,body.config);writes.push({body,result});
    if(result.ok){await host.reload(id);fixture.componentFixtures.get(id).config=structuredClone(result.config);}
    await route.fulfill({json:result});
  });
  await page.goto(fixture.url+'/#setting-c-0');
  const field=name=>page.locator('#cfg-'+id+'-'+name);
  await field('dailyRecoveryHour').waitFor();
  for(const [name,value]of [['noReplyPenalty','10'],['dailyRecoveryHour','4'],['dailyFloor','60']])assert.equal(await field(name).inputValue(),value);
  await field('noReplyPenalty').fill('7');await field('dailyRecoveryHour').fill('8');await field('dailyFloor').fill('72');
  const save=page.locator('#section-setting-c-0 .comp-save').first();
  const message=page.locator('#section-setting-c-0 .comp-msg').first();
  await save.click();await message.filter({hasText:'已保存'}).waitFor();
  assert.equal(writes.at(-1).result.ok,true);
  const policy=host.callService('mood','policy',{});
  assert.deepEqual([policy.noReplyPenalty,policy.dailyRecoveryHour,policy.dailyFloor],[7,8,72]);
  await page.reload();await field('dailyRecoveryHour').waitFor();
  for(const [name,value]of [['noReplyPenalty','7'],['dailyRecoveryHour','8'],['dailyFloor','72']])assert.equal(await field(name).inputValue(),value,'saved '+name);
  assert.match(await page.locator('#section-setting-c-0 .policy-facts').textContent(),/不额外增加额度/);
  assert.doesNotMatch(await page.locator('#section-setting-c-0 .policy-facts').textContent(),/5 分钟安全窗口|扣 10 分|凌晨 4 点/);
  await field('dailyRecoveryHour').fill('24');const before=writes.length;await save.click();
  await message.filter({hasText:'超出有效范围'}).waitFor();assert.equal(writes.length,before);
  await field('dailyRecoveryHour').fill('4.5');await save.click();
  await message.filter({hasText:'整数小时'}).waitFor();assert.equal(writes.at(-1).result.ok,false);
  await field('dailyRecoveryHour').fill('0');await field('noReplyPenalty').fill('0');await field('dailyFloor').fill('0');
  await save.click();await message.filter({hasText:'已保存'}).waitFor();
  assert.deepEqual(['noReplyPenalty','dailyRecoveryHour','dailyFloor'].map(k=>host.callService('mood','policy',{})[k]),[0,0,0]);
  assert.deepEqual(errors,[]);
  console.log('PASS editable defaults, real-host save/reload/readback, zero values, validation and updated explanations');
} finally {
  await browser?.close();await fixture?.close();await host.dispose();
  fs.rmSync(root,{recursive:true,force:true});
}
