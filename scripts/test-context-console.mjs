import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import fs from 'node:fs';import path from 'node:path';
import {startConsoleFixture} from './console-ui-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const exe=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(x=>fs.existsSync(x));
test('business windows sort unique QQ seqs, resolve receipts and retain the complete native tool timeline',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath:exe});try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const r={...data.request,key:'private:20012',observerVersion:6,layoutVersion:3,messages:[
   {role:'system',text:'固定规则'},
   {role:'user',source:'qq-context-dialogue',currentInput:false,text:'【QQ 回合 group】\n原因：probability\n【新增 QQ 消息数据】\n'+JSON.stringify([{seq:4,text:'较新未读',receiptState:'unseen'},{seq:1,text:'已经完成',receiptState:'unseen'},{seq:3,text:'旧消息已完成',receiptState:'complete'},{seq:2,text:'较旧已读待回复',read:true},{seq:5,text:'bot真实QQ回复',isSelf:true},{seq:6,text:'没有状态证据'}])},
   {role:'assistant',text:'调用回执',toolCalls:[{id:'r',name:'qq_report_message_receipts'}]},
   {role:'tool',text:JSON.stringify({ok:true,key:'private:20012',receipts:[{seq:1,state:'complete'},{seq:3,state:'complete'}]}),toolResults:[{toolCallId:'r'}]},
   {role:'assistant',text:'内部计划，不代表已经发送'},
   {role:'assistant',text:'调用发送',toolCalls:[{id:'s',name:'qq_send_message'}]},
   {role:'tool',text:JSON.stringify({ok:true,key:'private:20012',sent:1,failed:0}),toolResults:[{toolCallId:'s'}]},
   {role:'user',source:'qq-context-latest',text:'心情80\n【QQ 收件状态】\n'+JSON.stringify({receipts:[{seq:503,receiptState:'complete'},{seq:504,receiptState:'seen'}]}),contextSegments:[{id:'message-snapshot',text:'【QQ 收件状态】\n'+JSON.stringify({receipts:[{seq:503,receiptState:'complete'},{seq:504,receiptState:'seen'}]})}],contextUpdates:[{id:'ctx-context-dynamics',hash:'80'},{id:'message-snapshot',hash:'receipt-fixture'}]}
  ]};data.request=r;data.requestStages=[{kind:'current',request:r}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();assert.equal(await page.locator('[data-inspector-layout="business"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-inspector-region="arrivals"]').click();assert.equal(await page.locator('.context-sequence-row').first().getAttribute('data-inspector-select'),'task:2');assert.deepEqual(await page.locator('[data-inspector-select^="qq:"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.inspectorSelect)),['qq:2','qq:4']);await page.locator('[data-inspector-select="qq:2"]').click();assert.match(await page.locator('.context-detail').innerText(),/QQ 未处理消息[\s\S]*已读待处理/);
  const arg=process.argv.find(x=>x.startsWith('--artifacts=')),dir=arg?path.resolve(arg.slice(12)):null;if(dir){fs.mkdirSync(dir,{recursive:true});await page.locator('#contextInspector').screenshot({path:path.join(dir,'business-pending.png')});}
  await page.locator('[data-inspector-region="history"]').click();assert.deepEqual(await page.locator('[data-inspector-select^="qq:"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.inspectorSelect)),['qq:1','qq:3','qq:5']);await page.locator('[data-inspector-select="qq:1"]').click();assert(!(await page.locator('.context-detail').innerText()).includes('未读 QQ 消息（当时）'));
  assert.equal(await page.locator('.context-tracks,.context-relation-tree,.context-link-path').count(),0);assert.equal(await page.locator('.has-timeline>.context-sequence').count(),1);assert.equal(await page.locator('[data-inspector-select="message:2"].is-related').count(),1);const feed=await page.locator('.context-sequence-row').evaluateAll(nodes=>nodes.map(node=>node.dataset.inspectorSelect));assert(feed.indexOf('message:2')<feed.indexOf('message:3'));if(dir)await page.locator('#contextInspector').screenshot({path:path.join(dir,'single-timeline.png')});
  await page.locator('.context-related-links [data-inspector-related="message:2"]').click();assert.equal(await page.locator('[data-inspector-select="qq:1"].is-related').count(),1);
  await page.locator('[data-inspector-select="task:2"]').click();assert.match(await page.locator('.context-trigger').innerText(),/群聊普通来信通过概率判定/);
  await page.locator('[data-inspector-select="message:4"]').click();assert.match(await page.locator('.context-output-trace').innerText(),/DSH 会话记录/);
  await page.locator('[data-inspector-select="message:5"]').click();assert.match(await page.locator('.context-output-trace').innerText(),/QQ 投递成功[\s\S]*private:20012/);if(dir)await page.locator('#contextInspector').screenshot({path:path.join(dir,'business-output.png')});
  await page.locator('[data-inspector-region="unknown"]').click();assert.equal(await page.locator('[data-inspector-select="qq:6"]').count(),1);assert.match(await page.locator('.context-detail').innerText(),/状态未知/);
  await page.locator('[data-inspector-region="dynamic"]').click();await page.locator('[data-inspector-select="message:7"]').click();assert.equal(await page.locator('[data-inspector-select="receipt-index"]').count(),0);const receipts=page.locator('.context-detail [data-context-owner="message-snapshot"] .context-receipts');assert.match(await receipts.locator(':scope>summary').innerText(),/2 条/);await receipts.locator(':scope>summary').click();assert.match(await receipts.innerText(),/503[\s\S]*504/);assert(!(await page.locator('#contextInspector').innerText()).includes('未采集正文'));
  await page.locator('[data-inspector-layout="raw"]').click();assert.equal(await page.locator('.context-sequence-row').count(),8);assert.deepEqual(await page.locator('.context-sequence-row').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.requestPosition))),[1,2,3,4,5,6,7,8]);
  await page.locator('[data-inspector-select="message:1"]').click();const raw=await page.locator('.context-detail').innerText();assert(raw.includes('QQ 历史消息'));assert(raw.includes('QQ 未处理消息'));assert(!raw.includes('未读 QQ 消息（当时）'));
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1050});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});
test('waiting advice is readable by section, linked by call ID and never confused with QQ delivery',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath:exe});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const result={ok:true,arrived:false,endRound:false,probabilityPercent:50,emptyWaits:1,action:'followup',guidance:'追问刚才没聊完的细节，保持当前语气。',hint:'追问刚才没聊完的细节，保持当前语气。',newMessages:[{seq:8,sender:'示例用户',text:'<script>只作为原文展示</script>',receiptState:'seen'}]};const r={...data.request,layoutVersion:3,messages:[{role:'assistant',toolCalls:[{id:'wait-call',name:'qq_wait_for_messages'}],text:'调用等待工具'},{role:'tool',toolResults:[{toolCallId:'wait-call'}],text:JSON.stringify({type:'tool-result',toolCallId:'wait-call',content:JSON.stringify(result)})},{role:'user',source:'qq-context-latest',text:'心情80',contextUpdates:[{id:'ctx-context-dynamics',hash:'80'}]}]};data.request=r;data.requestStages=[{kind:'current',request:r}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();await page.locator('[data-inspector-select="message:1"]').click();
  const detail=page.locator('.context-detail'),text=await detail.innerText();for(const term of ['等待判定','继续本轮','下一步行动建议','旧话题追问','不是已发送的 QQ 消息','wait-call','示例用户'])assert(text.includes(term),term);
  assert.equal(await detail.locator('.context-action-advice pre').count(),1);assert.equal(await detail.locator('.context-qq-message').count(),1);assert.equal(await detail.locator('script').count(),0);
  assert.equal(await detail.locator('.context-raw-record').getAttribute('open'),null);await detail.locator('.context-raw-record>summary').click();assert(await detail.locator('.context-raw-record .context-detail-text').isVisible());await detail.locator('.context-raw-record>summary').click();
  const artifactArg=process.argv.find(x=>x.startsWith('--artifacts=')),dir=artifactArg?path.resolve(artifactArg.slice(12)):null;if(dir)fs.mkdirSync(dir,{recursive:true});
  for(const width of [1440,768,390]){await page.setViewportSize({width,height:1100});await detail.evaluate(node=>node.scrollTop=0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow '+width);assert(await detail.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'detail overflow '+width);if(dir)await page.locator('#contextConsole').screenshot({path:path.join(dir,'wait-advice-'+width+'.png')});}
  await page.locator('.context-layer-guide>summary').click();assert.equal(await page.locator('.context-layer-guide li').count(),5);assert.match(await page.locator('.context-layer-guide').innerText(),/世界书[\s\S]*历史后注入[\s\S]*独立 tools/);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('[data-inspector-component="ctx-chat-topic-drive"]').click();assert.match(await detail.innerText(),/组件职责与机制[\s\S]*等待工具返回/);
  await page.locator('[data-inspector-region="dynamic"]').click();assert(!(await detail.innerText()).includes('旧状态保留在历史原位置'));assert.match(await detail.innerText(),/仅保存在运行日志/);assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});

test('settings use three loading layers; C40 is on demand and management never appears as AI content',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath:exe});try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.preview)data.preview.modules.push({id:'obs-context-assembly',name:'可视化 context',text:'',placement:'current'});for(const stage of data.requestStages||[])if(stage.request)stage.request.modules.push({id:'obs-context-assembly',text:''});await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  assert.match(await page.locator('[data-inspector-view="components"]').innerText(),/组件来源\s*40$/);
  await page.locator('[data-inspector-view="components"]').click();assert.equal(await page.locator('[data-inspector-select^="component:"]').count(),40);
  await page.locator('#contextComponentLookup').selectOption('personal-core');assert.match(await page.locator('.context-detail').innerText(),/C40[\s\S]*按需/);
  assert.equal(await page.locator('#contextComponentLookup option[value="obs-context-assembly"]').count(),0);
  await page.locator('#contextDraftTab').click();
  assert.deepEqual(await page.locator('[data-context-group]').evaluateAll(nodes=>nodes.map(n=>n.dataset.contextGroup)),['fixed','stable','current']);
  assert.equal(await page.locator('[data-context-id="obs-context-assembly"]').count(),0);
  assert.match(await page.locator('[data-context-group="current"] [data-context-id="personal-core"]').innerText(),/按需注入[\s\S]*不控制.*工具权限/);
  assert.equal(await page.locator('#contextCompactHistory').count(),0);
  await page.evaluate(()=>{const transfer=new DataTransfer();document.querySelector('[data-context-id="ctx-context-dynamics"] .context-drag').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));document.querySelector('[data-context-id="role-card"]').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));});
  assert.match(await page.locator('#contextNotice').innerText(),/同一装填层/);
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1050});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  const arg=process.argv.find(x=>x.startsWith('--artifacts='));if(arg){const dir=path.resolve(arg.slice(12));fs.mkdirSync(dir,{recursive:true});await page.locator('#contextConsole').screenshot({path:path.join(dir,'context-settings-layers.png')});}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});

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
  assert.match(await page.locator('.context-refresh-note').innerText(),/组件已刷新/);
  const icons=await page.locator('#mainNav .nav-item:is([data-view="context-visual"],[data-view="setting-o-2"]) .nav-icon svg').evaluateAll(nodes=>nodes.map(node=>node.innerHTML));assert.equal(icons.length,2);assert.notEqual(icons[0],icons[1]);assert(!icons.some(icon=>icon.includes('M9 3v5H4')));
  await page.locator('[data-inspector-region="dynamic"]').click();assert.equal(await page.locator('.context-sequence-row').count(),2);
  await page.locator('[data-inspector-select="message:2"]').click();assert.match(await page.locator('.context-detail').innerText(),/已被后续更新取代/);assert.equal(await page.locator('.context-detail [data-context-owner="ctx-context-dynamics"]').count(),1);
  assert.equal(await page.locator('.context-detail-heading h3.context-superseded-title').count(),1);assert.match(await page.locator('.context-detail-heading h3').evaluate(node=>getComputedStyle(node).textDecorationLine),/line-through/);
  await page.locator('[data-inspector-component="ctx-context-dynamics"]').click();await page.locator('[data-inspector-message="message:5"]').click();const detail=await page.locator('.context-detail').innerText();assert.match(detail,/最新版本/);assert.match(detail,/心情80/);assert.equal(await page.locator('.context-detail-heading h3.context-superseded-title').count(),0);
  const artifactArg=process.argv.find(x=>x.startsWith('--artifacts='));if(artifactArg){const dir=path.resolve(artifactArg.slice(12));fs.mkdirSync(dir,{recursive:true});await page.locator('#contextConsole').screenshot({path:path.join(dir,'context-refill-current-mood.png')});}
  await page.setViewportSize({width:390,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }finally{await browser.close();await fixture.close();}
});
test('latest-tail UI separates incoming inputs from history and shows one complete current state',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath:exe});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const r={...data.request,layoutVersion:3,observerVersion:6,contextRefresh:{status:'fresh'},messages:[{role:'system',text:'硬规则'},{role:'user',source:'qq-context-stable',text:'稳定资料'},{role:'assistant',text:'工具调用',toolCalls:[{id:'c',name:'qq_mood'}]},{role:'tool',text:'80',toolResults:[{toolCallId:'c'}]},{role:'user',source:'qq-context-dialogue',currentInput:true,text:'【QQ 回合 message】\n【新增 QQ 消息数据】\n[{"seq":1,"text":"你好","receiptState":"unseen"}]'},{role:'user',source:'qq-context-latest',text:'【组件更新 ctx-context-dynamics】\n心情80',contextUpdates:[{id:'ctx-context-dynamics',hash:'80'}],contextSegments:[{id:'ctx-context-dynamics',text:'【组件更新 ctx-context-dynamics】\n心情80'}]}]};data.request=r;data.requestStages=[{kind:'current',request:r}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();assert.match(await page.locator('.context-refresh-note').innerText(),/当前资料集中在末尾/);
  await page.locator('[data-inspector-region="arrivals"]').click();assert.equal(await page.locator('[data-inspector-select="qq:1"]').count(),1);await page.locator('[data-inspector-select="qq:1"]').click();assert.match(await page.locator('.context-detail').innerText(),/QQ 未处理消息/);
  await page.locator('[data-inspector-region="dynamic"]').click();assert.equal(await page.locator('.context-sequence-row').count(),1);assert.match(await page.locator('.context-detail').innerText(),/仅最新状态/);assert.equal(await page.locator('.context-superseded-title').count(),0);
 }finally{await browser.close();await fixture.close();}
});
test('record details split task, known receipt states, unknown QQ states and named tool changes',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath:exe});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const r={...data.request,messages:[
   {role:'user',source:'user',text:'【当前时间】2026/10/30 10:57:09\n【会话令牌】hidden\n【提醒】你还没有完成回合收尾',provenance:{eventSeq:1795,eventType:'agent/inbox/spliced',recordedAt:1793329029351}},
   {role:'user',source:'qq-context-dialogue',text:'【QQ 回合 probability】\n处理要求\n【新增 QQ 消息数据】\n'+JSON.stringify([{seq:1,text:'旧消息',read:true},{seq:2,text:'新消息',receiptStatus:'unseen'},{seq:3,text:'状态不明'}])},
   {role:'developer',source:'tool-registry',text:'【tool-addition · 非文本载荷】',contentBlocks:[{type:'tool-addition',toolName:'fixture_read'},{type:'tool-removal',toolName:'old_read'}],provenance:{eventSeq:11,eventType:'developer/message',headerSeq:10}},
  ]};data.request=r;data.requestStages=[{kind:'current',request:r}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  await page.locator('[data-inspector-layout="raw"]').click();await page.locator('[data-inspector-select="message:0"]').click();assert.match(await page.locator('.context-detail').innerText(),/桥接收尾提醒[\s\S]*1795/);
  await page.locator('[data-inspector-select="message:1"]').click();const text=await page.locator('.context-detail').innerText();for(const term of ['桥接处理任务','QQ 未处理消息','状态未知','群聊普通来信通过概率判定'])assert(text.includes(term));
  await page.locator('[data-inspector-select="message:2"]').click();const tools=await page.locator('.context-detail').innerText();assert.match(tools,/工具定义变化[\s\S]*fixture_read[\s\S]*old_read/);assert.match(tools,/request\/header · seq 10/);assert.match(tools,/不是发给模型的字面文字/);
  assert.equal(await page.locator('.context-detail .context-raw-record').getAttribute('open'),null);assert.equal(await page.locator('.context-detail .context-detail-text').isVisible(),false,'do not display tool changes twice');
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
  assert.equal(await page.locator('#contextSession').inputValue(),'private:20012');await page.locator('[data-inspector-layout="raw"]').click();
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
  await choose('message:4');assert.match(await page.locator('.context-detail').innerText(),/bot 内部[\s\S]*DSH 会话记录/);
  await choose('message:3');assert.equal(await page.locator('.context-detail [data-context-owner="wake-action"]').count(),1);
  await choose('message:8');assert.equal(await page.locator('.context-detail [data-context-owner="wake-action"]').count(),1,'repeated task stays visible in both original positions');
  await page.locator('#contextInspectorKind').selectOption('result');assert.equal(await sequence.count(),1);await continuous();
  assert.equal(await sequence.first().getAttribute('data-request-position'),'7');
  await page.locator('#contextInspectorKind').selectOption('');
  await page.locator('#contextInspectorSearch').fill('no-match-here');assert.equal(await sequence.count(),0);assert.match(await page.locator('.context-sequence').innerText(),/没有匹配项/);
  await page.locator('#contextInspectorSearch').fill('');await continuous();
  await page.locator('[data-inspector-view="tools"]').click();assert.equal(await sequence.count(),2);await continuous();
  assert.match(await page.locator('.context-detail').innerText(),/qq_schedule[\s\S]*query by date/);
  await page.locator('[data-inspector-view="components"]').click();assert.equal(await page.locator('[data-inspector-select^="component:"]').count(),40);await continuous();
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
  const codes=await page.locator('#contextModules .context-number').allTextContents();
  assert.deepEqual(codes.map(s=>Number(s.slice(1))).sort((a,b)=>a-b),Array.from({length:40},(_,i)=>i+1));
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
