import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {startConsoleFixture} from './console-ui-fixture.mjs';

const fixture=await startConsoleFixture();
const browser=await chromium.launch({headless:true,channel:'msedge'});
const old={provider:'deepseek-official',model:'deepseek-flash',effort:'low'};
const workerRange={allowed:[{provider:old.provider,model:old.model,efforts:['low','high']}]};
const config=()=>fixture.componentFixtures.get('obs-cost-policy').config;
fixture.componentFixtures.get('obs-cost-policy').config={conversation:old,task:old,presets:{'qq-admin':old,'qq-task-worker':workerRange}};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===fixture.url?r.continue():r.abort());
 await page.goto(fixture.url+'/#environment-presets');
 const root=page.locator('#presetModelPolicy'),global=root.locator('[data-model-scope="global"]');
 const row=id=>root.locator('[data-model-preset="'+id+'"]');
 const field=(el,key)=>el.locator('[data-model-field="'+key+'"]');
 const activate=key=>root.locator('[data-preset-select="'+key+'"]').click();
 const save=async el=>{
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/presets/model-policy'&&r.request().method()==='POST');
  await el.locator('[data-model-save]').click();const result=await response;
  assert.equal(result.status(),200,await result.text());
  await el.locator('[data-model-message]').filter({hasText:'已保存'}).waitFor();
  return result.request().postDataJSON();
 };
 await global.waitFor();assert(await global.locator('h4').isVisible());
 await activate('learning');await row('qq-learning').locator('[data-model-override]').check();
 await field(row('qq-learning'),'provider').selectOption('magpie-responses');
 await field(row('qq-learning'),'effort').selectOption('high');
 await field(global,'provider').selectOption('magpie-responses');await field(global,'effort').selectOption('medium');
 assert.equal((await save(global)).scope,'global');
 assert.deepEqual(config().conversation,{provider:'magpie-responses',model:'codex/gpt-6.1-sol',effort:'medium'});
 assert.deepEqual(config().task,config().conversation);
 assert.deepEqual(config().presets,{'qq-admin':old,'qq-task-worker':workerRange});
 assert.equal(await field(row('qq-learning'),'effort').inputValue(),'high','independent unsaved draft survives a global default save');
 assert.equal(await row('qq-learning').locator('[data-model-override]').isChecked(),true);
 await activate('reserved2');assert.equal(await field(row('qq-chat-v2'),'provider').inputValue(),'magpie-responses');
 assert.equal(await field(row('qq-chat-v2'),'effort').inputValue(),'medium');assert(await field(row('qq-chat-v2'),'provider').isDisabled());
 await activate('admin');assert.equal(await field(row('qq-admin'),'provider').inputValue(),old.provider);
 await row('qq-admin').locator('[data-model-override]').uncheck();await save(row('qq-admin'));
 assert.equal(await field(row('qq-admin'),'effort').inputValue(),'medium');assert.equal(Object.hasOwn(config().presets,'qq-admin'),false);
 await activate('task');assert(await global.isVisible());assert(await row('qq-task-worker').locator('[data-model-override]').isChecked());
 assert.deepEqual(config().presets['qq-task-worker'],workerRange);
 await row('qq-task-worker').locator('[data-model-override]').uncheck();await save(row('qq-task-worker'));
 const checked=row('qq-task-worker').locator('[data-range-effort]:checked');
 assert.equal(await checked.count(),1);assert.equal(await checked.first().getAttribute('data-provider'),'magpie-responses');
 assert.equal(await checked.first().getAttribute('data-effort'),'medium');

 await page.route('**/api/presets/model-policy',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  const response=await route.fetch(),data=await response.json();
  await route.fulfill({status:409,json:{...data,ok:false,error:'模型配置已保存，但部分会话同步失败',sync:{ok:false,failed:[{sessionId:'fixture-session',status:'failed'}]}}});
 },{times:1});
 await field(global,'effort').selectOption('xhigh');await global.locator('[data-model-save]').click();
 await global.locator('[data-model-message]').filter({hasText:'fixture-session'}).waitFor();
 assert.equal(config().conversation.effort,'xhigh');
 await activate('reserved2');assert.equal(await field(row('qq-chat-v2'),'effort').inputValue(),'xhigh');
 await page.reload();await global.waitFor();assert.equal(await field(global,'effort').inputValue(),'xhigh');
 for(const width of [1440,1024,768,390]){
  await page.setViewportSize({width,height:1000});assert(await global.isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
  if(process.env.PRESET_MODEL_UI_ARTIFACTS){fs.mkdirSync(process.env.PRESET_MODEL_UI_ARTIFACTS,{recursive:true});await root.screenshot({path:path.join(process.env.PRESET_MODEL_UI_ARTIFACTS,'global-model-default-'+width+'.png')});}
 }
 await page.route('**/api/presets/model-policy',async route=>{
  const response=await route.fetch(),data=await response.json();delete data.supportsGlobalDefault;await route.fulfill({response,json:data});
 });
 await page.reload();await global.waitFor();assert(await global.locator('[data-model-save]').isDisabled());
 assert.match(await global.locator('[data-model-note]').textContent(),/尚不支持全局保存/);
 assert.deepEqual(errors,[]);
 console.log('PASS global default visibility, inherited settings, enabled overrides and task ranges preserved, disabling overrides, independent drafts, partial sync, reload, mobile layout and older server detection');
}finally{await browser.close();await fixture.close();}
