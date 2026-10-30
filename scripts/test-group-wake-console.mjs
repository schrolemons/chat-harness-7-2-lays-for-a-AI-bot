import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';import path from 'node:path';
import {startConsoleFixture} from './console-ui-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const executablePath=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(f=>fs.existsSync(f));
test('L0 q and L1 p are separate partial forms; each save preserves fresh fields owned by the other',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});
 try{const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(fixture.url+'/#setting-l-0');
 const incoming=page.locator('#section-setting-l-0 [data-component-slot="life-wake-reasons"]'),proactive=page.locator('#section-setting-l-1 [data-component-slot="life-wake-reasons"]');
 await incoming.locator('[data-config-key="groupAtBonus"] input').waitFor({state:'attached'});await page.locator('#section-setting-l-0 details').evaluateAll(els=>els.forEach(e=>e.open=true));
 const guidance=await page.locator('#section-setting-l-0').innerText();assert.ok(guidance.includes('私聊来信100%'));assert.ok(guidance.includes('最终70%'));assert.ok(guidance.includes('不再抽签'));
 assert.deepEqual((await incoming.locator('[data-config-key]').evaluateAll(els=>els.map(e=>e.dataset.configKey))).sort(),['groupAtBonus','groupNameBonus','groupQuestionBonus','groupPokeBonus','groupNames'].sort());assert.equal(await incoming.locator('.comp-enabled').count(),0);
 assert.equal(await page.locator('#v2RecProb,#v2RecAt,#v2WakeDefaultMode').count(),0);
 await incoming.locator('[data-config-key="groupAtBonus"] input').fill('0');await incoming.locator('[data-config-key="groupNames"] input').fill('鲸鱼, DS');
 await page.request.post(fixture.url+'/api/plugins/config',{data:{id:'life-wake-reasons',config:{initialProbability:.42}}});
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/plugins/config')&&r.request().postDataJSON()?.id==='life-wake-reasons');await page.locator('#section-setting-l-0 .v2-save').click();await saved;
 let writes=fixture.requests.filter(r=>r.path==='/api/plugins/config'&&r.body.id==='life-wake-reasons');assert.equal(writes.at(-1).body.config.groupAtBonus,0);assert.equal(writes.at(-1).body.config.groupNames,'鲸鱼, DS');assert.equal(writes.at(-1).body.config.initialProbability,.42);
 await page.locator('#mainNav [data-view="setting-l-1"]').click();await proactive.locator('.comp-save').waitFor();await proactive.locator('details').evaluateAll(els=>els.forEach(e=>e.open=true));assert.equal(await proactive.locator('[data-config-key^="group"]').count(),0);
 await proactive.locator('[data-config-key="initialProbability"] input').fill('0.35');await page.request.post(fixture.url+'/api/plugins/config',{data:{id:'life-wake-reasons',config:{groupAtBonus:.75}}});
 const savedP=page.waitForResponse(r=>r.url().endsWith('/api/plugins/config')&&r.request().postDataJSON()?.id==='life-wake-reasons');await proactive.locator('.comp-save').click();await savedP;
 writes=fixture.requests.filter(r=>r.path==='/api/plugins/config'&&r.body.id==='life-wake-reasons');assert.equal(writes.at(-1).body.config.groupAtBonus,.75);assert.equal(writes.at(-1).body.config.initialProbability,.35);assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});
