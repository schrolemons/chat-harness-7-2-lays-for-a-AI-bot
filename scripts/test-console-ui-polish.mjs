import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {startConsoleFixture} from './console-ui-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright'),fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,channel:'msedge'});const errors=[];
try{const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===fixture.url?r.continue():r.abort());await page.goto(fixture.url);await page.waitForSelector('[data-component-id="ctx-memory-profile-store"]',{state:'attached'});
 assert.equal(await page.locator('[data-component-id="ctx-memory-profile-store"]').count(),1);
 const views=await page.locator('#mainNav [data-view]').evaluateAll(nodes=>nodes.map(el=>el.dataset.view));
 for(const width of [1440,1024,390]){
  await page.setViewportSize({width,height:1000});
  for(const view of views){
   await page.locator('[data-view="'+view+'"]').first().click();
   await page.locator('[data-page="'+view+'"] details:not(.compact-actions)').evaluateAll(nodes=>nodes.forEach(e=>e.open=true));
   const faults=await page.evaluate(()=>{
    const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
    return [...document.querySelectorAll('.card input:is([type=text],[type=search],[type=password],[type=number],:not([type])),.card select:not([multiple]):not([size])')].filter(visible).flatMap(e=>{
     const r=e.getBoundingClientRect();return r.height>52||r.width>361?[e.id+': '+Math.round(r.width)+' × '+Math.round(r.height)]:[];
    });
   });
   assert.deepEqual(faults,[],view+' at '+width+' must use compact single-line controls');
   const gaps=await page.locator('[data-page="'+view+'"] .setting-field').evaluateAll(fields=>fields.filter(e=>e.getClientRects().length).flatMap(e=>{const label=e.querySelector(':scope > label'),control=e.querySelector(':scope > input:not([type=checkbox]),:scope > select,:scope > textarea');if(!label||!control)return [];if(label.getBoundingClientRect().height>55)return [control.id+': oversized label '+Math.round(label.getBoundingClientRect().height)];const gap=control.getBoundingClientRect().top-label.getBoundingClientRect().bottom;return gap>18?[control.id+': '+Math.round(gap)]:[];}));
   assert.deepEqual(gaps,[],view+' has detached labels at '+width);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),view+' overflows at '+width);
  }
 }
 const structure=await page.evaluate(()=>{
  const ids=[...document.querySelectorAll('[data-component-id]')].map(e=>e.dataset.componentId);const duplicates=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))].filter(id=>id!=='life-campus-watch');
  const missingExamples=[...document.querySelectorAll('.comp-field[data-config-key]')].filter(e=>!e.querySelector('.parameter-example')).map(e=>(e.closest('[data-component-id]')?.dataset.componentId||'?')+'.'+e.dataset.configKey);
  const order=['v2MemoryKey','v2AffairsKey','v2PmEnabled','v2ContextRecentLimit'].map(id=>document.getElementById(id));
  return {duplicates,missingExamples,ordered:order.every((el,i)=>!i||Boolean(order[i-1].compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))};
 });
 assert.deepEqual(structure.duplicates,[],'Each component must have one source-owned form');
 assert.deepEqual(structure.missingExamples,[],'Every declared user-facing parameter needs a behavior example');
 assert.equal(await page.locator('#dshEffortSave').innerText(),'保存 DSH 全局默认');
 assert.equal(await page.locator('#v2PmSave').innerText(),'保存此会话事实');
 assert.equal(await page.locator('#v2InitPromptSave').innerText(),'保存此会话背景');
 assert.equal(await page.locator('#v2TbSave').innerText(),'保存此会话时段');
 assert.equal(await page.locator('.profile-save').innerText(),'保存此 QQ 档案');
 assert.match(await page.locator('[data-component-id="ctx-user-mood"] .comp-save').innerText(),/保存全局/);
 assert.match(await page.locator('#envCompImageGeneration .comp-save').innerText(),/保存本机/);
 assert(structure.ordered,'Memory must run from short-term context to affairs, durable facts, and injection budgets');
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('[data-view="overview"]').first().click();
 const effort=await page.locator('#dshEffortSelect').boundingBox(),save=await page.locator('#dshEffortSave').boundingBox();assert(Math.abs(effort.y+effort.height-save.y-save.height)<=2,'Effort save button must align with its select');
 const preset=await page.locator('#closedPreset').boundingBox();assert(preset.height<=44&&preset.width<=321,'Preset selector must stay single-line');

 await page.locator('[data-view="environments"]').first().click();await page.locator('#envCompImageGeneration .comp-body[data-loaded="1"]').waitFor();
 assert.equal(await page.locator('#section-environments .member-card-preview').count(),0);
 assert.equal(await page.locator('.comp-card[data-id="exec-image-generation"],[data-component-id="exec-image-generation"]').count(),1);
 assert.match(await page.locator('#section-environments').innerText(),/API调用/);
 const width=await page.locator('#envCompImageGeneration [data-config-key="model"] input').evaluate(e=>e.getBoundingClientRect().width);assert(width<=321);
 await page.locator('[data-view="setting-l-0"]').first().click();const input=page.locator('#v2StateKey');const list=await input.getAttribute('list');assert(list);assert(await page.locator('#'+list+' option[value="private:60006"]').count());await input.fill('private:60006');await page.locator('#v2StateView').click();await page.locator('#v2StateSummary').getByText('未读 2 条').waitFor();assert.equal(await page.locator('#v2AllStatesOutput').count(),0);
 await page.setViewportSize({width:390,height:844});await page.locator('[data-view="environments"]').first().click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);console.log('PASS: 30 pages × 3 viewports, compact controls including preset, unique profiles/API mount, session picker, no JS errors');
}finally{await browser.close();await fixture.close();}
