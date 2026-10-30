import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import fs from 'node:fs';import path from 'node:path';
import {startConsoleFixture} from './console-ui-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const exe=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(x=>fs.existsSync(x));

test('refill UI locates current mood, distinguishes historical state and uses custom navigation icons',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath:exe});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.route('**/api/context/preview*',async route=>{
   const response=await route.fetch(),data=await response.json();const r={...data.request,requestId:'refill-demo',requestInRound:2,layoutVersion:2,observerVersion:5,contextRefresh:{status:'fresh'},messages:[
    {role:'system',text:'系统硬规则与原始角色卡'},
    {role:'user',source:'qq-context-stable',text:'固定用户背景'},
    {role:'user',source:'qq-context-update',text:'【组件更新 ctx-context-dynamics】\n心情60',contextUpdates:[{id:'ctx-context-dynamics',hash:'old'}],contextSegments:[{id:'ctx-context-dynamics',text:'【组件更新 ctx-context-dynamics】\n心情60'}]},
    {role:'assistant',text:'调用心情工具',toolCalls:[{id:'c1',name:'qq_mood'}]},
    {role:'tool',text:'心情已更新',toolResults:[{toolCallId:'c1',name:'qq_mood'}]},
    {role:'user',source:'qq-context-update',text:'【组件更新 ctx-context-dynamics】\n心情80',contextUpdates:[{id:'ctx-context-dynamics',hash:'new'}],contextSegments:[{id:'ctx-context-dynamics',text:'【组件更新 ctx-context-dynamics】\n心情80'}]},
   ],modules:[{id:'ctx-context-dynamics',name:'心情与表情策略',text:'心情80',included:true,inRequest:true,placement:'current'}]};
   data.request=r;data.requestStages=[{kind:'initial',request:null},{kind:'previous',request:null},{kind:'current',request:r}];await route.fulfill({response,json:data});
  });
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  assert.match(await page.locator('.context-refresh-note').innerText(),/已读取最新/);
  const icons=await page.locator('#mainNav .nav-item:is([data-view="context-visual"],[data-view="setting-o-2"]) .nav-icon svg').evaluateAll(nodes=>nodes.map(node=>node.innerHTML));assert.equal(icons.length,2);assert.notEqual(icons[0],icons[1]);assert(!icons.some(icon=>icon.includes('M9 3v5H4')));
  await page.locator('[data-inspector-region="dynamic"]').click();assert.equal(await page.locator('.context-sequence-row').count(),2);
  await page.locator('[data-inspector-select="message:2"]').click();assert.match(await page.locator('.context-detail').innerText(),/历史状态，已有后续更新/);assert.equal(await page.locator('.context-detail [data-context-owner="ctx-context-dynamics"]').count(),1);
  await page.locator('[data-inspector-component="ctx-context-dynamics"]').click();await page.locator('[data-inspector-message="message:5"]').click();const detail=await page.locator('.context-detail').innerText();assert.match(detail,/当前有效/);assert.match(detail,/心情80/);
  const artifactArg=process.argv.find(x=>x.startsWith('--artifacts='));if(artifactArg){const dir=path.resolve(artifactArg.slice(12));fs.mkdirSync(dir,{recursive:true});await page.locator('#contextConsole').screenshot({path:path.join(dir,'context-refill-current-mood.png')});}
  await page.setViewportSize({width:390,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }finally{await browser.close();await fixture.close();}
});
test('DSH-style context inspector preserves sequence, tool pairs, definitions, source frames and global editing',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath:exe});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.url?route.continue():route.abort());
  const sequence=page.locator('.context-sequence-row');
  const continuous=async()=>{const numbers=await page.locator('.context-sequence-number').allTextContents();assert.deepEqual(numbers.map(Number),Array.from({length:numbers.length},(_,i)=>i+1));};
  const choose=key=>page.locator('[data-inspector-select="'+key+'"]').click();
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  assert.equal(await page.locator('#contextSession').inputValue(),'private:20012');
  assert.equal(await sequence.count(),9);await continuous();
  assert.equal(await page.locator('#contextSave').isVisible(),false);
  assert.equal(await page.locator('[data-inspector-detail="message:7"] [data-context-owner="ctx-context-dynamics"]').count(),1);
  assert.match(await page.locator('.context-detail [data-context-owner]').first().innerText(),/组件 C\d+/);
  assert.equal(await page.locator('#contextModules literal-data').count(),0);
  assert.match(await page.locator('.context-detail .is-unattributed').innerText(),/<literal-data>/);
  assert.match(await page.locator('.context-detail .is-unattributed').innerText(),/桥接补充背景资料/);
  assert.equal(await page.getByText('未归属',{exact:true}).count(),0);
  await choose('message:1');assert.match(await page.locator('.context-detail').innerText(),/DSH 会话压缩摘要[\s\S]*压缩较早对话/);
  await choose('message:2');assert.match(await page.locator('.context-detail').innerText(),/DSH 运行环境更新[\s\S]*按需补充/);
  await choose('message:5');assert.match(await page.locator('.context-detail').innerText(),/工具调用[\s\S]*qq_schedule[\s\S]*call-demo/);
  await choose('message:6');assert.match(await page.locator('.context-detail').innerText(),/工具返回[\s\S]*call-demo/);
  await choose('message:4');assert.match(await page.locator('.context-detail').innerText(),/bot 生成[\s\S]*不能据此认定/);
  await choose('message:3');assert.equal(await page.locator('.context-detail [data-context-owner="wake-action"]').count(),1);
  await choose('message:8');assert.equal(await page.locator('.context-detail [data-context-owner="wake-action"]').count(),1,'repeated task stays visible in both original positions');
  await page.locator('#contextInspectorKind').selectOption('result');assert.equal(await sequence.count(),1);await continuous();
  assert.equal(await sequence.first().getAttribute('data-request-position'),'7');
  await page.locator('#contextInspectorKind').selectOption('');
  await page.locator('#contextInspectorSearch').fill('no-match-here');assert.equal(await sequence.count(),0);assert.match(await page.locator('.context-sequence').innerText(),/没有匹配项/);
  await page.locator('#contextInspectorSearch').fill('');await continuous();
  await page.locator('[data-inspector-view="tools"]').click();assert.equal(await sequence.count(),2);await continuous();
  assert.match(await page.locator('.context-detail').innerText(),/qq_schedule[\s\S]*query by date/);
  await page.locator('[data-inspector-view="components"]').click();assert.equal(await page.locator('[data-inspector-select^="component:"]').count(),39);await continuous();
  await page.locator('#contextComponentLookup').selectOption('life-schedule-reminder');assert.match(await page.locator('.context-detail').innerText(),/C25[\s\S]*本次未(?:提供|采集)/);
  await page.locator('[data-inspector-component="ctx-context-dynamics"]').click();assert.equal(await page.locator('#contextComponentLookup').inputValue(),'ctx-context-dynamics');
  for(const query of ['05','C05','心情']){await page.locator('#contextInspectorSearch').fill(query);assert.ok(await page.locator('[data-inspector-select="component:ctx-context-dynamics"]').count());}
  await page.locator('#contextInspectorSearch').fill('');
  await choose('component:ctx-context-dynamics');assert.match(await page.locator('.context-detail').innerText(),/组件 C05/);
  await choose('component:message-snapshot');assert.match(await page.locator('.context-detail').innerText(),/收件处理进度（放入背景资料）/);assert.match(await page.locator('.context-detail').innerText(),/新增聊天原文（随本轮任务提供）/);
  await page.locator('[data-inspector-view="messages"]').click();
  assert.equal(await page.getByText('AI 的历史消息',{exact:true}).count(),0);
  assert.equal(await page.locator('#contextRequestSelect option').count(),3);
  await page.locator('#contextRequestSelect').selectOption('initial');assert.match(await page.locator('#contextRequestDiff').textContent(),/首次模型调用/);
  assert.match(await page.locator('#contextRequestSummary').innerText(),/9 条消息记录/);
  await page.locator('#contextRequestSelect').selectOption('current');assert.match(await page.locator('#contextRequestDiff').textContent(),/qq_schedule/);
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no overflow at '+width);}
  const artifactArg=process.argv.find(x=>x.startsWith('--artifacts='));
  if(artifactArg){
   const dir=path.resolve(artifactArg.slice(12));fs.mkdirSync(dir,{recursive:true});
   await choose('message:7');await page.locator('#contextInspector').screenshot({path:path.join(dir,'context-inspector-desktop.png')});
   await page.locator('.context-detail').screenshot({path:path.join(dir,'context-component-frames.png')});
   await page.locator('#themeToggle').click();await page.locator('#contextInspector').screenshot({path:path.join(dir,'context-inspector-dark.png')});
   await page.locator('#themeToggle').click();await page.setViewportSize({width:390,height:1000});await page.locator('#contextInspector').screenshot({path:path.join(dir,'context-inspector-mobile.png')});await page.setViewportSize({width:1440,height:1000});
  }
  await page.locator('#contextDraftTab').click();await page.locator('[data-context-toggle="ctx-context-dynamics"]').waitFor();
  const headings=await page.locator('[data-context-group="modules"] .context-module h3').allTextContents();
  assert.deepEqual(headings.map(s=>Number(s.match(/^\d+/)?.[0])),Array.from({length:39},(_,i)=>i+1));
  assert.ok((await page.locator('[data-context-id="session-protocol"]').textContent()).includes('本轮暂无内容'));
  await page.locator('[data-context-toggle="ctx-context-dynamics"]').uncheck();await page.waitForFunction(()=>!document.querySelector('#contextSave').disabled);
  await page.getByRole('button',{name:'上移 黑话',exact:true}).click();await page.waitForFunction(()=>{const ids=[...document.querySelectorAll('#contextModules [data-context-id]')].map(x=>x.dataset.contextId);return ids.indexOf('slang-context')<ids.indexOf('message-snapshot');});
  await page.locator('[data-context-id="ctx-context-dynamics"] .context-drag').dragTo(page.locator('[data-context-id="slang-context"] .context-drag'));
  await page.waitForFunction(()=>{const ids=[...document.querySelectorAll('#contextModules [data-context-id]')].map(x=>x.dataset.contextId);return ids.indexOf('ctx-context-dynamics')<ids.indexOf('slang-context');});
  await page.locator('#contextSave').click();await page.waitForFunction(()=>document.querySelector('#contextNotice').textContent.includes('已保存全局'));
  await page.reload();await page.locator('#contextInspector').waitFor();await page.locator('#contextDraftTab').click();assert.equal(await page.locator('[data-context-toggle="ctx-context-dynamics"]').isChecked(),false);
  const reqs=await(await page.request.get(fixture.url+'/__fixture/requests')).json();
  assert.equal(reqs.requests.filter(x=>x.path==='/api/context/policy').length,1);assert.ok(!reqs.requests.some(x=>x.path==='/api/plugins/toggle'||x.path==='/api/plugins/order'));
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});
test('two calls show two unique options, with first/previous merged and counts kept out of round labels',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath:exe});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route('**/api/context/preview*',async route=>{
   const response=await route.fetch(),data=await response.json();
   if(data.requestStages?.[0]?.request){const first=data.requestStages[0].request;data.requestStages[1].request=first;data.requestStages[2].request.requestInRound=2;}
   await route.fulfill({response,json:data});
  });
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  assert.equal(await page.locator('#contextRequestSelect option').count(),2);
  const labels=await page.locator('#contextRequestSelect option').allTextContents();assert.match(labels[0],/首次.*也是上一次/);assert.match(labels[1],/第 2 次模型调用/);
  assert.ok(labels.every(label=>!label.includes('回合')));
  const artifactArg=process.argv.find(x=>x.startsWith('--artifacts='));if(artifactArg){const dir=path.resolve(artifactArg.slice(12));fs.mkdirSync(dir,{recursive:true});await page.locator('#contextRequestPicker').screenshot({path:path.join(dir,'request-picker-merged.png')});await page.locator('[data-inspector-component="life-schedule-reminder"]').click();await page.locator('#contextInspector').screenshot({path:path.join(dir,'source-mapping.png')});}
 }finally{await browser.close();await fixture.close();}
});
