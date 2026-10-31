import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';import path from 'node:path';import {startConsoleFixture} from './console-ui-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright'),executablePath=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(fs.existsSync);
const call=(id,name,args)=>({role:'assistant',toolCalls:[{id,name}],text:JSON.stringify({type:'tool-call',id,name,arguments:args})});
const result=(id,data)=>({role:'tool',toolResults:[{toolCallId:id}],text:JSON.stringify(data)});
test('three visual families cover real reply, direct private delivery, quotes and forward reads in light/dark/mobile',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/context/preview*',async route=>{
   const response=await route.fetch(),data=await response.json();if(data.request){
    const request={...data.request,key:'group:12',messages:[{role:'system',text:'系统规则'},{role:'user',source:'qq-context-stable',text:'稳定资料'},
     {role:'user',source:'qq-context-dialogue',text:'【新增 QQ 消息数据】\n'+JSON.stringify([{seq:505,sender:'群友',isOwner:true,dialogueSeq:90,text:'[引用 AI助手：吃饭了吗]已经聊完的消息',plain:'已经聊完的消息',quoteTargetIsSelf:true,receiptState:'complete'},{sender:'我',dialogueSeq:91,text:'bot旧消息',isSelf:true}])},
     call('r','qq_reply',{groupId:'12',replyToMessageId:'-41',message:'引用后的回答'}),result('r',{ok:true,key:'group:12',sent:1,failed:0,quoted:{sender:{nickname:'群友乙'},text:'你是谁'}}),
     call('p','qq_send_private_message',{userId:'34',message:'【传话】来自群友：你好'}),result('p',{ok:true,key:'private:34',sent:1,failed:0}),
     call('f','qq_get_forward_msg',{key:'group:12',id:'f1'}),result('f',{ok:true,key:'group:12',id:'f1',messages:[{sender:'转发人',text:'转发中的正文'}]}),
     call('m','qq_memory_append',{key:'group:12',category:'memberImpression'}),result('m',{ok:true,key:'group:12',category:'memberImpression',memory:{}}),
     {role:'assistant',text:'先把这次观察记下来，再继续聊天。'},
     {role:'user',source:'qq-context-task',text:'本次处理要求'},
     {role:'user',source:'qq-context-latest',text:'心情80'},
    ]};data.request=request;data.requestStages=[{kind:'current',request}];
   }await route.fulfill({response,json:data});
  });
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  assert.deepEqual(await page.locator('.context-layout-map [data-inspector-region] strong').allTextContents(),['系统上下文','用户级稳定上下文','聊天与工具历史','本次来信与待处理','当前补充资料（历史后注入）']);
  assert.equal(await page.locator('.context-layout-map .context-layer-summary').count(),5);
  assert.equal(await page.locator('[data-entry-kind="delivery"]').count(),2);assert.equal(await page.locator('[data-entry-kind="quote"]').count(),1);assert.equal(await page.locator('[data-entry-kind="forwarded"]').count(),1);
  const reply=page.locator('[data-inspector-select="delivery:r:0"]');assert.match(await reply.innerText(),/引用 群友乙[\s\S]*你是谁[\s\S]*引用后的回答/);
  const relay=page.locator('[data-inspector-select="delivery:p:0"]');assert.match(await relay.innerText(),/group:12 → private:34/);
  const internal=page.locator('[data-entry-kind="assistant"]');assert.match(await internal.innerText(),/工具续接[\s\S]*印象回执后[\s\S]*生成原文[\s\S]*这次观察/);
  await internal.click();assert.match(await page.locator('.context-output-trace').innerText(),/前一步工具处理[\s\S]*不是这段内部文字的保存位置[\s\S]*state\/social-v2\.json[\s\S]*memberImpressions[\s\S]*本条数据去向[\s\S]*session\.v4\.jsonl\.zstd/);
  await reply.click();assert.match(await page.locator('.context-detail').innerText(),/发送成功[\s\S]*没有消息 seq/);
  await page.getByRole('button',{name:'查看来源工具返回',exact:true}).click();
  assert.equal(await page.locator('[data-inspector-layout="business"]').getAttribute('aria-pressed'),'true','source links must keep the message-aware timeline');
  assert.equal(await page.locator('[data-entry-kind="qq"]').count(),2,'user and bot QQ cards survive source navigation');
  await page.locator('[data-inspector-select="qq:505"]').click();assert.match(await page.locator('.context-processing-record').innerText(),/吃饭了吗[\s\S]*已经聊完的消息/);await page.locator('.context-processing-record details>summary').click();await page.locator('.context-processing-record [data-inspector-message]').first().click();
  assert.equal(await page.locator('[data-inspector-layout="business"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.context-detail').getAttribute('data-inspector-detail'),'qq:505','QQ source links retain the extracted message rather than the retired wrapper');
  const signature=node=>{const s=getComputedStyle(node);return [s.backgroundColor,s.borderTopWidth,s.borderRadius,s.width].join('|');};
  for(const dark of [false,true]){
   if(dark)await page.locator('#themeToggle').click();
   for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:1000});
    const signatures=[];
    for(const family of ['message','context','tool']){
     const values=await page.locator('.context-sequence .context-family-'+family).evaluateAll((nodes,source)=>{const sign=eval('('+source+')');return nodes.map(sign);},signature.toString());
     assert(values.length>=2,family);assert.equal(new Set(values).size,1,family+' uses one card style at '+width);signatures.push(values[0].split('|')[0]);
    }
    assert.equal(new Set(signatures).size,3,'three distinct families');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const widths=[];for(const family of ['message','context','tool'])widths.push(await page.locator('.context-sequence .context-family-'+family).first().evaluate(node=>node.getBoundingClientRect().width));
    assert(widths[0]<widths[2]&&widths[2]<widths[1],'messages < tools < context at '+width);
    const incoming=await page.locator('[data-inspector-select="qq:505"]').boundingBox(),outgoing=await page.locator('[data-inspector-select="delivery:r:0"]').boundingBox();assert(outgoing.x>incoming.x,'bot messages align to the right');
    for(const key of ['qq:505','quote:group:12:-41','forwarded:f:0']){const card=page.locator('[data-inspector-select="'+key+'"]');assert.equal(await card.evaluate(n=>n.classList.contains('is-message-outgoing')),false,'humans including owner/quotes/forwards remain left');}
    assert.equal(await page.locator('[data-entry-kind="qq"].is-qq-self').evaluate(n=>n.classList.contains('is-message-outgoing')),true);
    assert.match(await relay.innerText(),/来自群友：你好/);
   }
  }
  const artifact=process.argv.find(x=>x.startsWith('--artifacts='));if(artifact){const dir=path.resolve(artifact.slice(12));fs.mkdirSync(dir,{recursive:true});await page.setViewportSize({width:1440,height:1100});await page.locator('#themeToggle').click();await reply.click();await page.locator('#contextInspector').screenshot({path:path.join(dir,'context-three-families.png')});}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});

test('simulated delivery keeps pending users visible through maintenance and moves them only after successful receipt',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];let stage=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(fixture.url).origin?route.continue():route.abort());
  await page.route('**/api/context/preview*',async route=>{
   const response=await route.fetch(),data=await response.json();if(data.request){
    const incoming={seq:650,dialogueSeq:50,messageId:'user-650',sender:'管理员',isOwner:true,text:'[引用 AI助手：今天忙吗]刚忙完，记得我们的约定',plain:'刚忙完，记得我们的约定',quoteTargetIsSelf:true,receiptState:'seen'};
    const messages=[{role:'system',text:'模拟规则'},{role:'user',source:'qq-context-dialogue',text:'【历史 QQ 消息数据】\n'+JSON.stringify([{dialogueSeq:49,isSelf:true,text:'今天忙吗',sender:'我'}])},
     {role:'user',source:'qq-context-task',triggerReason:'atMention',text:'原因：atMention\n处理管理员的来信'},
     {role:'user',source:'qq-context-dialogue',currentInput:true,text:'【新增 QQ 消息数据】\n'+JSON.stringify([incoming])}];
    if(stage>=1)messages.push(call('note','qq_task_note',{key:'group:12',action:'upsert',title:'约定'}),result('note',{ok:true,key:'group:12',item:{id:'a1'}}),{role:'assistant',text:'先记好约定，还没有回复来信。'});
    if(stage>=2)messages.push(call('fail','qq_reply',{key:'group:12',messageId:'user-650',message:'这条没有送达'}),result('fail',{ok:false,error:'模拟投递失败'}));
    if(stage>=3)messages.push(call('reply','qq_reply',{key:'group:12',messageId:'user-650',message:'忙完就好，我记得我们的约定。'}),result('reply',{ok:true,key:'group:12',sent:1,failed:0,messageId:'bot-651',quoted:{sender:'管理员',text:incoming.plain}}),call('receipt','qq_report_message_receipts',{key:'group:12',receipts:[{seq:650,status:'complete'}]}),result('receipt',{ok:true,key:'group:12',receipts:[{seq:650,state:'complete'}]}));
    const request={...data.request,key:'group:12',id:'sim-'+stage,messages};data.request=request;data.requestStages=[{kind:'current',request}];
   }await route.fulfill({response,json:data});
  });
  // Exercise the real debug UI against its isolated, local mock endpoint.
  await page.goto(fixture.url+'/#operations');await page.locator('#tsKind').selectOption('group');await page.locator('#tsId').fill('12');await page.locator('#tsMsg').fill('模拟投递，核验左右消息卡片');
  const posted=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/test-send');await page.locator('#tsSend').click();assert.equal((await posted).postDataJSON().message,'模拟投递，核验左右消息卡片');
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  for(stage=0;stage<=3;stage++){
   if(stage){const ready=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/context/preview');await page.locator('#contextRefresh').click();await ready;}
   await page.locator('[data-inspector-region="arrivals"]').click();
   if(stage<3){assert.equal(await page.locator('[data-inspector-select="qq:650"]').count(),1);assert.equal(await page.locator('[data-entry-kind="delivery"]').count(),0);}
   else assert.equal(await page.locator('[data-inspector-select="qq:650"]').count(),0);
   await page.locator('[data-inspector-region="history"]').click();
   assert.equal(await page.locator('[data-inspector-select="qq:650"]').count(),stage===3?1:0,'only confirmed double receipts move the user into history');
   assert.equal(await page.locator('[data-inspector-select="delivery:fail:0"]').count(),0,'a failed send is never a bot chat');
   if(stage===1){await page.locator('[data-entry-kind="assistant"]').click();assert.match(await page.locator('.context-output-trace').innerText(),/state\/memory\/affairs\/group_12\.json/);}
   if(stage===3){
    const human=page.locator('[data-inspector-select="qq:650"]'),bot=page.locator('[data-inspector-select="delivery:reply:0"]');
    assert.match(await human.innerText(),/650[\s\S]*管理员[\s\S]*刚忙完/);assert.match(await bot.innerText(),/引用 管理员[\s\S]*忙完就好/);
    assert((await bot.boundingBox()).x>(await human.boundingBox()).x);assert.equal(await human.locator('[data-qq-seq="650"]').count(),1);
    const arg=process.argv.find(x=>x.startsWith('--artifacts='));if(arg){const dir=path.resolve(arg.slice(12));fs.mkdirSync(dir,{recursive:true});await human.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,'simulated-chat-left-right.png')});}
   }
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});
