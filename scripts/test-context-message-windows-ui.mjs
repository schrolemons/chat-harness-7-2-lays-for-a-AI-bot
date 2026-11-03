import test from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';import fs from'node:fs';import path from'node:path';import{startConsoleFixture}from'./console-ui-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright'),executablePath=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(fs.existsSync);
const call=(id,name)=>({role:'assistant',toolCalls:[{id,name}],text:JSON.stringify({type:'tool-call',id,name,arguments:{key:'group:12'}})}),result=(id,data)=>({role:'tool',toolResults:[{toolCallId:id}],text:JSON.stringify(data)});

test('old unresolved tool history stays historical while only the captured current queue is pending',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){
   const old=Array.from({length:109},(_,i)=>({seq:1001+i,dialogueSeq:600+i,text:'旧历史 '+i,receiptState:'seen'})),recent=Array.from({length:39},(_,i)=>({seq:1111+i,dialogueSeq:800+i,text:'本次待答 '+i,receiptState:'seen'}));
   const request={...data.request,key:'group:12',messages:[{role:'user',source:'qq-context-dialogue',text:'【新增 QQ 消息数据】\n'+JSON.stringify([...old,...recent])},{role:'user',source:'qq-context-latest',contextSegments:[{id:'message-snapshot',text:'【QQ 收件状态】\n'+JSON.stringify({unreadCount:40,pendingFromSeq:1111,partial:true,receipts:[{seq:1111,seenAt:1}]})}]}]};data.request=request;data.requestStages=[{kind:'current',request}];
  }await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  await page.locator('[data-inspector-region="arrivals"]').click();assert.equal(await page.locator('.context-sequence [data-entry-kind="qq"]').count(),39);assert(!(await page.locator('.context-sequence').innerText()).includes('旧历史'));
  await page.locator('[data-inspector-region="history"]').click();assert.equal(await page.locator('.context-sequence [data-entry-kind="qq"]').count(),109);assert.match(await page.locator('.context-sequence').innerText(),/当时已读未回复/);
 }finally{await browser.close();await fixture.close();}
});
test('continuous retries show the latest failed pair with attempts, keep success and split around other tools',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  let phase=0;const pair=(n,ok=false,name='qq_reply')=>[{...call('try-'+n,name),provenance:{eventSeq:n*10,toolOperationIndex:n},text:JSON.stringify({type:'tool-call',id:'try-'+n,name,arguments:{message:'尝试'+n,key:'group:12'}})},{...result('try-'+n,ok?{ok:true,sent:1}:{}),provenance:{eventSeq:n*10+1},isError:!ok,text:ok?'{"ok":true,"sent":1}':'Error: 失败'+n}];
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const messages=phase===0?[...pair(1),...pair(2),...pair(3),...pair(4,true)]:phase===1?[...pair(1),...pair(2),...pair(3,true,'other_tool'),...pair(4),...pair(5)]:[{id:'old',role:'user',source:'qq-context-tool-history',text:'旧归档',archivedToolPairs:[1,2,3].map(n=>({name:'qq_reply',callId:'old-'+n,callEventSeq:n*10,resultEventSeq:n*10+1,operationIndex:n,argumentsText:JSON.stringify({message:'旧尝试'+n}),errorText:'Error: 旧失败'+n}))},...pair(4,true,'other_tool'),...pair(5),...pair(6)];const request={...data.request,messages};data.request=request;data.requestStages=[{kind:'current',request}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  assert.equal(await page.locator('.context-sequence [data-entry-kind="call"]').count(),2);assert.equal(await page.locator('.context-sequence [data-entry-kind="result"]').count(),2);assert.equal(await page.locator('.context-sequence .context-window-badge').filter({hasText:'尝试次数：3'}).count(),2);
  await page.locator('[data-inspector-select="message:4"]').click();assert.match(await page.locator('.context-detail').innerText(),/尝试次数：3[\s\S]*尝试3/);await page.locator('[data-inspector-select="message:5"]').click();assert.match(await page.locator('.context-detail').innerText(),/失败3/);assert.equal(await page.locator('[data-inspector-select="message:6"]').count(),1);assert.equal(await page.locator('[data-inspector-select="message:7"]').count(),1);
  for(const width of [1440,768,390]){await page.setViewportSize({width,height:1100});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow at '+width);}
  phase=1;await page.reload();await page.locator('#contextInspector').waitFor();assert.equal(await page.locator('.context-sequence [data-entry-kind="call"]').count(),5);assert.equal(await page.locator('.context-sequence .context-window-badge').filter({hasText:'尝试次数'}).count(),0);
  phase=2;await page.reload();await page.locator('#contextInspector').waitFor();assert.equal(await page.locator('.context-sequence [data-entry-kind="call"]').count(),4);assert.equal(await page.locator('[data-inspector-select="message:0"]').count(),0);await page.locator('[data-inspector-select="restored:old-3:call"]').click();assert.match(await page.locator('.context-detail').innerText(),/尝试次数：3[\s\S]*旧尝试3/);assert.equal(await page.locator('.context-failure-example').count(),0);
 }finally{await browser.close();await fixture.close();}
});

test('history and pending tabs use shared dialogue numbers for human and bot messages',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const r={...data.request,key:'group:12',messages:[
   {role:'system',text:'固定规则'},
   {role:'user',source:'qq-context-dialogue',provenance:{eventSeq:9800},text:'【历史 QQ 消息数据】\n'+JSON.stringify([{seq:535,dialogueSeq:2,sender:'用户甲',text:'应该出现在历史窗口的用户原文',receiptState:'complete'},{isSelf:true,dialogueSeq:3,sender:'我',text:'AI助手以前的回复'}])},
   call('u','qq_get_unread_messages'),result('u',[{seq:536,dialogueSeq:4,sender:'用户乙',text:'读取工具里的待处理用户原文'}]),
   call('w','qq_wait_for_messages'),result('w',{content:[{type:'text',text:JSON.stringify({ok:true,arrived:true,newMessages:[{seq:537,dialogueSeq:5,receiptState:'seen',sender:'用户丙',text:'等待工具里的待处理用户原文'}]})}]}),
   call('d','qq_get_message_detail'),result('d',{ok:true,key:'group:12',info:{seq:538,sender:'用户丁',text:'详情工具里的已处理用户原文',receiptState:'complete'}}),
   {role:'user',source:'qq-context-task',text:'请处理本次来信'},
   {role:'user',source:'qq-context-latest',text:'当前状态'},
  ]};data.request=r;data.requestStages=[{kind:'current',request:r}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  for(const width of[1440,390]){
   await page.setViewportSize({width,height:1100});await page.locator('[data-inspector-region="history"]').click();
   assert.match(await page.locator('.context-sequence').innerText(),/应该出现在历史窗口的用户原文/);assert.match(await page.locator('.context-sequence').innerText(),/详情工具里的已处理用户原文/);
   assert.equal(await page.locator('[data-inspector-select="qq:535"] [data-dialogue-seq="2"]').innerText(),'2');assert(await page.locator('[data-dialogue-seq="2"]').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=16));
   assert.equal(await page.locator('[data-inspector-select="qq:dialogue:3"] [data-dialogue-seq="3"]').innerText(),'3');assert.equal(await page.locator('.context-sequence-number[data-qq-seq],.context-sequence-number[data-dialogue-seq="9800"]').count(),0);
   await page.locator('[data-inspector-region="arrivals"]').click();assert.deepEqual(await page.locator('[data-entry-kind="qq"] .context-sequence-number').allTextContents(),['4','5']);
   assert.match(await page.locator('.context-sequence').innerText(),/读取工具里的待处理用户原文/);assert.match(await page.locator('.context-sequence').innerText(),/等待工具里的待处理用户原文/);
   await page.locator('[data-inspector-select="qq:536"]').click();await page.locator('.context-processing-record details>summary').click();await page.locator('.context-processing-record [data-inspector-message]').click();assert.equal(await page.locator('[data-inspector-layout="business"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.context-detail').getAttribute('data-inspector-detail'),'qq:536');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  const arg=process.argv.find(x=>x.startsWith('--artifacts='));if(arg){const dir=path.resolve(arg.slice(12));fs.mkdirSync(dir,{recursive:true});await page.setViewportSize({width:1440,height:1100});for(const region of['history','arrivals']){await page.locator('[data-inspector-region="'+region+'"]').click();await page.locator('#contextInspector').screenshot({path:path.join(dir,region+'-human-messages.png')});}}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});

test('selecting a visible message preserves list and page scroll on desktop and mobile',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const request={...data.request,messages:[{role:'user',source:'qq-context-dialogue',text:'【历史 QQ 消息数据】\n'+JSON.stringify(Array.from({length:90},(_,i)=>({...(i%2?{isSelf:true}:{seq:1000+i,receiptState:'complete'}),dialogueSeq:2000+i,sender:i%2?'我':'用户',text:'滚动定位消息 '+i+'：'+ '正文内容。'.repeat(10)})))}]};data.request=request;data.requestStages=[{kind:'current',request}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.locator('.context-sequence').scrollIntoViewIfNeeded();await page.locator('.context-sequence').evaluate(list=>list.scrollTop=1800);
   const key=await page.locator('.context-sequence').evaluate(list=>{const bounds=list.getBoundingClientRect();return [...list.querySelectorAll('[data-inspector-select]')].find(row=>{const b=row.getBoundingClientRect();return b.top>bounds.top+30&&b.bottom<Math.min(bounds.bottom,innerHeight)-20;})?.dataset.inspectorSelect;});assert(key,'visible message');
   const button=page.locator('[data-inspector-select="'+key+'"]');await button.scrollIntoViewIfNeeded();const before=await page.evaluate(()=>({list:document.querySelector('.context-sequence').scrollTop,page:document.scrollingElement.scrollTop}));assert(before.list>1000);
   await button.click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const after=await page.evaluate(()=>({list:document.querySelector('.context-sequence').scrollTop,page:document.scrollingElement.scrollTop}));assert(Math.abs(after.list-before.list)<=2,'list scroll moved: '+JSON.stringify({width,before,after}));assert(Math.abs(after.page-before.page)<=2,'page scroll moved: '+JSON.stringify({width,before,after}));assert.equal(await page.locator('.context-detail').getAttribute('data-inspector-detail'),key);
  }
 }finally{await browser.close();await fixture.close();}
});

test('archived bot 648 and delivered bot 649 keep their dialogue numbers and source links',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const request={...data.request,key:'group:12',messages:[
   {id:'summary',role:'user',source:'compact-checkpoint',text:'已压缩的历史摘要'},
   {role:'user',source:'qq-context-dialogue',text:'【历史 QQ 消息数据】\n'+JSON.stringify([{seq:81,dialogueSeq:647,text:'真好',receiptState:'complete'},{isSelf:true,dialogueSeq:649,text:'下一条回复'}])},
   call('reply','qq_reply'),{...result('reply',{ok:true,key:'group:12',sent:1}),deliveryRecords:[{callId:'reply',index:0,dialogueSeq:649}]}
  ],archivedDeliveries:[{key:'archived:old:0',kind:'delivery',region:'history',name:'bot QQ 消息（摘要历史）',text:'苏锡常呀……AI助手只听过名字，念起来像一串小水泡。',dialogueSeq:648,summaryId:'summary',resultEventSeq:3230,targetKey:'group:12',verified:true,archived:true}]};request.messages[2].text=JSON.stringify({type:'tool-call',id:'reply',arguments:{text:'下一条回复'}});data.request=request;data.requestStages=[{kind:'current',request}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1100});for(const seq of [647,648,649])assert.equal(await page.locator('.context-sequence-number[data-dialogue-seq="'+seq+'"]').count(),1);}
  await page.locator('[data-inspector-select="archived:old:0"]').click();assert.match(await page.locator('.context-detail').innerText(),/摘要历史[\s\S]*苏锡常呀/);assert.match(await page.locator('.context-detail').innerText(),/对话序号：648/);
  await page.locator('.context-detail [data-inspector-message="message:0"]').click();assert.equal(await page.locator('.context-detail').getAttribute('data-inspector-detail'),'message:0');
 }finally{await browser.close();await fixture.close();}
});

test('wrapped checkpoint has a separate summary card and archived messages link directly to it',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const request={...data.request,key:'group:12',messages:[{role:'system',text:'规则'},{id:'wrapped-summary',role:'user',source:'qq-context-stable',wrappedSource:'compact-checkpoint',text:'【稳定会话资料】\n只属于稳定资料的内容\n\nThis is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Continue the task directly.\n\n<compacted-summary>\n## Primary Request and Intent\n只属于历史摘要的内容\n</compacted-summary>'}],archivedDeliveries:[{key:'archived:wrapped:0',kind:'delivery',region:'history',name:'bot QQ 消息（摘要历史）',text:'旧回复',dialogueSeq:648,summaryId:'wrapped-summary',resultEventSeq:3230,targetKey:'group:12',verified:true,archived:true}]};data.request=request;data.requestStages=[{kind:'current',request}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  await page.locator('[data-inspector-select="archived:wrapped:0"]').click();await page.locator('.context-detail').getByRole('button',{name:'查看对应摘要',exact:true}).click();
  assert.equal(await page.locator('.context-detail').getAttribute('data-inspector-detail'),'summary:message:1');
  assert.match(await page.locator('.context-detail h3').innerText(),/历史压缩摘要/);
  assert.match(await page.locator('.context-detail-text').innerText(),/只属于历史摘要的内容/);assert(!(await page.locator('.context-detail-text').innerText()).includes('只属于稳定资料的内容'));
  for(const width of [1440,768,390]){await page.setViewportSize({width,height:1100});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow at '+width);}
  await page.locator('[data-inspector-select="message:1"]').click();assert.match(await page.locator('.context-detail-text').innerText(),/只属于稳定资料的内容/);assert(!(await page.locator('.context-detail-text').innerText()).includes('只属于历史摘要的内容'));
  await page.locator('[data-inspector-layout="raw"]').click();await page.locator('[data-inspector-select="message:1"]').click();assert.match(await page.locator('.context-detail-text').innerText(),/只属于稳定资料的内容[\s\S]*只属于历史摘要的内容/);assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});

test('generation sources show the requested dialogue, incoming trigger and periodic trigger with working navigation',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){
   const generation={reason:'message',inputs:[{id:'incoming',eventSeq:1,kind:'qq-context-dialogue'}]};
   const request={...data.request,messages:[{id:'incoming',role:'user',source:'qq-context-dialogue',text:'【新增 QQ 消息数据】\n'+JSON.stringify([{seq:82,dialogueSeq:902,text:'帮我查询日程',receiptState:'seen'}])},
    {role:'user',source:'qq-context-tool-history',text:'重复工具错误折叠归档'},
    {...call('schedule','qq_schedule'),text:JSON.stringify({type:'tool-call',id:'schedule',arguments:{action:'list'}}),provenance:{generation}},
    {...call('unread','qq_get_unread_messages'),provenance:{generation}},
    {...call('periodic','qq_schedule'),provenance:{generation:{reason:'proactiveCheck',inputs:[]}}}]};data.request=request;data.requestStages=[{kind:'current',request}];
   }await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  await page.locator('[data-inspector-select="message:2"]').click();assert.match(await page.locator('.context-output-trace').innerText(),/对话序号 902/);
  await page.locator('.context-output-trace [data-inspector-message="qq:82"]').click();assert.equal(await page.locator('.context-detail').getAttribute('data-inspector-detail'),'qq:82');assert.match(await page.locator('.context-detail').innerText(),/帮我查询日程/);
  for(const [index,title]of [[3,'收到新消息'],[4,'静默后主动检查']]){await page.locator('[data-inspector-select="message:'+index+'"]').click();assert.match(await page.locator('.context-output-trace .context-trace-section').first().innerText(),new RegExp(title));assert(!/输入记录后继续生成|重复工具错误折叠归档/.test(await page.locator('.context-output-trace').innerText()));}
 }finally{await browser.close();await fixture.close();}
});

test('source and destination have separate sections with normal-weight content and spaced actions',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const request={...data.request,messages:[{role:'user',source:'qq-context-stable',text:'稳定会话资料'},call('trace-read','mcp__snowluma__qq_get_unread_messages'),result('trace-read',{ok:true,key:'group:12',messages:[]})]};data.request=request;data.requestStages=[{kind:'current',request}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();await page.locator('[data-inspector-select="message:2"]').click();
  const trace=page.locator('.context-output-trace');assert.equal(await trace.locator('.context-trace-section').count(),2);
  for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:1100});
   const metrics=await trace.evaluate(node=>{const sections=node.querySelectorAll('.context-trace-section'),heading=node.querySelector('h4'),value=node.querySelector('.context-trace-value'),links=node.querySelector('.context-flow-links'),note=node.querySelector('.context-trace-note');return {headingWeight:Number(getComputedStyle(heading).fontWeight),valueWeight:Number(getComputedStyle(value).fontWeight),border:parseFloat(getComputedStyle(sections[1]).borderTopWidth),linksSeparated:!links||!note||note.getBoundingClientRect().top>=links.getBoundingClientRect().bottom+4,overflow:node.scrollWidth>node.clientWidth+1};});
   assert(metrics.headingWeight>metrics.valueWeight);assert(metrics.valueWeight<=400);assert(metrics.border>=1);assert(metrics.linksSeparated);assert(!metrics.overflow);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
 }finally{await browser.close();await fixture.close();}
});

test('five English roles replace native role/source fields and drive message filtering',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const request={...data.request,messages:[{role:'system',source:'system-prompt',text:'系统规则'},{role:'user',source:'user',text:'外部来信'},{role:'assistant',source:'model',text:'模型原文'},call('role-read','fixture_read'),result('role-read',{ok:true}),{role:'user',source:'qq-context-latest',text:'动态上下文'}]};data.request=request;data.requestStages=[{kind:'current',request}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();await page.locator('[data-inspector-layout="raw"]').click();
  assert.deepEqual(await page.locator('#contextInspectorKind option').evaluateAll(nodes=>nodes.map(node=>node.value)),['','assistant','user','tool','system','developer']);
  await page.locator('[data-inspector-select="message:5"]').click();assert.equal(await page.locator('.context-role-field dt:text-is("role") + dd').innerText(),'developer');assert.equal(await page.locator('.context-detail-fields dt').filter({hasText:/^(消息角色|来源)$/}).count(),0);assert.equal(await page.locator('.context-protocol-role').count(),0);
  await page.locator('#contextInspectorKind').selectOption('assistant');assert.deepEqual(await page.locator('.context-sequence-row').evaluateAll(nodes=>nodes.map(node=>node.dataset.inspectorSelect)),['message:2','message:3']);assert.deepEqual(await page.locator('.context-sequence-main>.context-display-role').allTextContents(),['assistant','assistant']);
  await page.locator('#contextInspectorKind').selectOption('tool');assert.equal(await page.locator('.context-role-field dt:text-is("role") + dd').innerText(),'tool');assert.equal(await page.locator('.context-sequence-row').count(),1);assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});


test('cold 5+5 incoming is optional while separately fetched cache history stays out of incoming',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{const page=await browser.newPage({viewport:{width:1440,height:1100}});
 await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const request={...data.request,key:'group:12',messages:[{role:'user',source:'qq-context-dialogue',text:'【历史 QQ 消息数据】\n'+JSON.stringify([{seq:1,dialogueSeq:1,text:'单独补读的缓存旧消息',replyDisposition:'history',seenAt:1},{seq:8,dialogueSeq:8,text:'半小时窗口来信A',replyDisposition:'history',seenAt:1},{seq:9,dialogueSeq:9,text:'半小时窗口来信B',replyDisposition:'history',seenAt:1}])},{role:'user',source:'qq-context-latest',contextSegments:[{id:'message-snapshot',text:'【QQ 收件状态】\n'+JSON.stringify({inputSeqs:[8,9],pendingSeqs:[],unreadCount:0,queueObservedThroughSeq:9,receipts:[]})}]}]};data.request=request;data.requestStages=[{kind:'current',request}];}await route.fulfill({response,json:data});});
 await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();for(const width of [1440,390]){await page.setViewportSize({width,height:1100});await page.locator('[data-inspector-region="arrivals"]').click();const incoming=await page.locator('.context-sequence').innerText();assert.match(incoming,/半小时窗口来信A/);assert.match(incoming,/自由回应/);assert(!incoming.includes('单独补读的缓存旧消息'));assert.match(await page.locator('.context-window-summary').innerText(),/可自由回应/);await page.locator('[data-inspector-region="history"]').click();const history=await page.locator('.context-sequence').innerText();assert.match(history,/单独补读的缓存旧消息/);assert(!history.includes('半小时窗口来信A'));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 }finally{await browser.close();await fixture.close();}
});
