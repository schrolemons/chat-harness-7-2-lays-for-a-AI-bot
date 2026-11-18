import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('cross-session private sends distinguish the game result from the originating QQ grant',async()=>{
 const source=fs.readFileSync(new URL('../src/mcp-snowluma-safe.js',import.meta.url),'utf8');
 const description=source.match(/'qq_send_private_message',\s*'([^']+)'/)?.[1];
 assert.match(description,/发起私聊.*contentId/);
 assert.match(description,/游戏会话 ID.*不能替代/);
 assert.match(description,/收件人无需先来信/);
});
test('send tool contracts require explicit grouping before a one-message answer to several inputs',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');
 const field=createReplyContentCarrier().decorate('qq_send_message',['send',{},async()=>{}])[1].contentId.description;
 assert.match(field,/多条来信/);assert.match(field,/只发一条/);assert.match(field,/先.*qq_reply_contents/);assert.match(field,/显式.*contentId/);
 const source=fs.readFileSync(new URL('../src/mcp-snowluma-safe.js',import.meta.url),'utf8');
 for(const name of ['qq_send_message','qq_reply']){
  const description=source.match(new RegExp("'"+name+"',\\s*'([^']+)'"))?.[1];
  assert.match(description,/先.*qq_reply_contents/);assert.match(description,/contentId/);
 }
});
test('send tools expose one semantic content id and concurrent calls carry independent source scopes',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');
 const carrier=createReplyContentCarrier(),observed=[];
 const original=['send description',{message:{}},async input=>{await new Promise(r=>setTimeout(r,input.delay));observed.push(carrier.headers({}).get('x-reply-content-id'));}];
 const decorated=carrier.decorate('qq_send_message',original);
 assert(decorated[1].contentId);assert.equal(original[1].contentId,undefined);
 await Promise.all([decorated[2]({contentId:'content:a',delay:10}),decorated[2]({contentId:'content:b',delay:0})]);
 assert.deepEqual(observed,['content:b','content:a']);assert.equal(carrier.headers({}).get('x-reply-content-id'),null);
 assert.equal(carrier.decorate('qq_get_recent_messages',original),original);
 for(const name of ['qq_schedule','qq_task_spawn','qq_task_input','qq_task_cancel'])assert(carrier.decorate(name,original)[1].contentId);
 for(const name of ['qq_diary','qq_task_list','qq_task_result','worklog_history','diary_history','diary_read'])assert.equal(carrier.decorate(name,original),original);
});
test('a new send without a content id cannot inherit a previous call id',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');
 const carrier=createReplyContentCarrier(),seen=[];
 const decorated=carrier.decorate('qq_send_sticker',['sticker',{},async()=>seen.push(carrier.headers({}).get('x-reply-content-id'))]);
 await decorated[2]({contentId:'content:a'});await decorated[2]({});assert.deepEqual(seen,['content:a',null]);
 assert.throws(()=>decorated[1].contentId.parse('bad\r\nheader'));
});
test('image relays carry the same explicit source grant as other cross-session sends',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');const carrier=createReplyContentCarrier();
 const decorated=carrier.decorate('qq_relay_image',['relay',{key:{},target:{},imageId:{}},async()=>carrier.headers({}).get('x-reply-content-id')]);
 assert(decorated[1].contentId);assert.match(decorated[1].contentId.description,/task/);
 assert.equal(await decorated[2]({contentId:'content:owner-task'}),'content:owner-task');assert.equal(carrier.headers({}).get('x-reply-content-id'),null);
});
test('one explicit source group is admitted before send without another model step',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');const calls=[];
 const carrier=createReplyContentCarrier({declareContents:async input=>{calls.push(['declare',input]);return {ok:true,contents:[{id:'content:one',key:input.key,kind:'chat',seqs:[1,2],taskPending:false}]};}});
 const send=carrier.decorate('qq_send_message',['send',{},async()=>{calls.push(['send',carrier.headers({}).get('x-reply-content-id')]);return {content:[{type:'text',text:'{"ok":true,"sent":1}'}]};}])[2];
 const r=await send({key:'private:123',token:'fixture',sourceSeqs:[2,1],messages:'完整回复'});
 assert.deepEqual(calls.map(x=>x[0]),['declare','send']);assert.equal(calls[1][1],'content:one');assert.deepEqual(calls[0][1].groups,[{seqs:[1,2],kind:'auto'}]);assert.deepEqual(JSON.parse(r.content[0].text).replyContent.seqs,[1,2]);
});
test('deferred or mismatched task grants never reach the image relay',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');let sends=0;
 for(const patch of [{taskPending:true},{key:'private:999'},{seqs:[2]},{taskExempt:false}]){
  const carrier=createReplyContentCarrier({declareContents:async()=>({ok:true,contents:[{id:'content:task',key:'private:123',kind:'task',seqs:[1],taskExempt:true,taskPending:false,...patch}]})});
  const relay=carrier.decorate('qq_relay_image',['relay',{},async()=>sends++])[2];
  await assert.rejects(relay({key:'private:123',token:'fixture',sourceSeqs:[1]}),/本次未发送/);
 }assert.equal(sends,0);
});

test('verified source seqs determine the canonical ID even when the model also copies a stale or invented ID',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');
 for(const name of ['qq_send_message','qq_relay_image']){
  const kind=name==='qq_relay_image'?'task':'chat';let declared=0,observed;
  const carrier=createReplyContentCarrier({declareContents:async input=>{declared++;assert.deepEqual(input.groups,[{seqs:[679],kind:name==='qq_relay_image'?'task':'auto'}]);return {ok:true,contents:[{id:'content:canonical',key:input.key,kind,seqs:[679],taskExempt:kind==='task',taskPending:false}]};}});
  const send=carrier.decorate(name,['send',{},async input=>{observed={id:input.contentId,header:carrier.headers({}).get('x-reply-content-id')};return {content:[{type:'text',text:'{"ok":true}'}]};}])[2];
  const result=await send({key:'private:123',token:'fixture',sourceSeqs:[679],contentId:'content:invented'});
  assert.equal(declared,1);assert.deepEqual(observed,{id:'content:canonical',header:'content:canonical'});assert.equal(JSON.parse(result.content[0].text).replyContent.contentId,'content:canonical');
 }
});

test('an explicit ID never bypasses rejection of its accompanying unadmitted source seqs',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');let sent=0;
 const carrier=createReplyContentCarrier({declareContents:async()=>({ok:false,error:'source_not_admitted'})});
 const send=carrier.decorate('qq_send_message',['send',{},async()=>sent++])[2];
 await assert.rejects(send({key:'private:123',token:'fixture',sourceSeqs:[999],contentId:'content:old-valid'}),/本次未发送/);assert.equal(sent,0);
});
