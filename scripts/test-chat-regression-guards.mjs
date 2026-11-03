import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPlugin} from '../plugins/qq-components/ctx-context-session/index.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {serializeModelData} from '../src/qq-model-view.js';

test('current identity takes priority over historical self-introductions without rewriting history',()=>{
 const blocks=[];
 createPlugin({config:{},addPromptBlock:t=>blocks.push(t)}).hooks.beforePrompt({roleName:'蓝鲸',selfName:'蓝鲸助手',selfId:'123'});
 assert.match(blocks.join('\n'),/历史.*(?:自称|自我介绍).*不.*(?:身份|角色)/);
 assert.match(blocks.join('\n'),/自我介绍.*当前角色/);
 assert.doesNotMatch(blocks.join('\n'),/AI助手/);
 const other=[];createPlugin({config:{},addPromptBlock:t=>other.push(t)}).hooks.beforePrompt({roleName:'纸鹤',selfName:'纸鹤',selfId:'123'});
 assert.match(other.join('\n'),/纸鹤/);assert.doesNotMatch(other.join('\n'),/AI助手/);
});

const rejectionURL=new URL('../plugins/qq-components/ctx-chat-reply-shape/send-rejection.mjs',import.meta.url);
test('missing or unadmitted semantic content explains a safe recovery before another send',async()=>{
 const {describeSendRejection}=await import(rejectionURL);
 const required=describeSendRejection('发送内容范围拒绝：content_required');
 assert.equal(required?.code,'REPLY_CONTENT_REQUIRED');assert.equal(required.retryable,true);
 assert.match(required.hint,/本回合.*完整.*seq/);assert.match(required.hint,/qq_reply_contents/);
 assert.match(required.hint,/contentId/);assert.match(required.hint,/不.*(?:重试|生成)/);
 const unadmitted=describeSendRejection('完整内容分组失败：source_not_admitted');
 assert.equal(unadmitted?.code,'REPLY_SOURCE_NOT_ADMITTED');assert.equal(unadmitted.retryable,true);
 assert.match(unadmitted.hint,/qq_get_unread_messages/);assert.match(unadmitted.hint,/完整正文.*引用/);
 assert.match(unadmitted.hint,/旧回合/);assert.match(unadmitted.hint,/qq_reply_contents/);
 for(const code of ['content_required_extra','source_not_admitted_extra'])assert.equal(describeSendRejection(code),null);
});
test('only genuine exhausted send limits become non-retryable; partial allowance stays editable',async()=>{
 const {describeSendRejection}=await import(rejectionURL);
 for(const message of ['最多发送 0 条','本轮发送额度已用完','发送计划拒绝：turn_limit']){
  const result=describeSendRejection(message);assert.equal(result.code,'TURN_SEND_LIMIT');assert.equal(result.retryable,false);assert.equal(result.remaining,0);
  assert.match(result.hint,/等待.*新.*消息/);assert.match(result.hint,/不.*(?:重试|换.*工具)/);
 }
 for(const message of ['最多发送 2 条','单条消息不能超过500字','agent token 无效','Insufficient Balance','网络超时'])assert.equal(describeSendRejection(message),null);
});

async function guardFixture(){
 const {installSendFailureGuard}=await import('../plugins/qq-components/ctx-chat-reply-shape/request-guard.mjs');
 const handlers=new Map(),ctx={on:(name,fn)=>{const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);}};
 installSendFailureGuard(ctx);const session={id:'test'};let seq=0;
 const emit=(type,data)=>{for(const fn of handlers.get('session/event')||[])fn(session,{type,seq:++seq,data});};
 const failure=(name='mcp__snowluma__qq_reply',text='发送失败：本轮发送额度已用完')=>{const callId='call-'+(++seq);emit('tool/call',{turn:1,callId,name});emit('tool/result',{turn:1,message:{toolCallId:callId,isError:true,content:[{type:'text',text}]}});};
 const step=async(messages=[],turn=1)=>{let entered=0;const chain=(handlers.get('agent/pre-step')||[]).reduceRight((next,fn)=>()=>fn({agent:{session},turn,messages},next),async()=>{entered++;return {kind:'enter',messages};});const decision=await chain();return {decision,entered};};
 return {emit,failure,step};
}

function declaredSource(f,{name='mcp__snowluma__qq_reply_contents',body={},isError=false}={}){
 f.emit('tool/call',{turn:1,callId:'declare-source',name,arguments:JSON.stringify({key:'group:456',groups:[{seqs:[7],kind:'chat'}]})});
 f.emit('tool/result',{turn:1,message:{toolCallId:'declare-source',isError,content:[{type:'text',text:JSON.stringify({ok:true,key:'group:456',contents:[{id:'content:valid',seqs:[7],kind:'chat'}],...body})}]}});
}
test('a successful matching declaration recovers only the current missing-content send streak',async()=>{
 const f=await guardFixture();f.failure(undefined,'发送内容范围拒绝：content_required');f.failure(undefined,'发送内容范围拒绝：content_required');
 assert.equal((await f.step()).decision.kind,'reject');declaredSource(f);
 assert.equal((await f.step()).decision.kind,'enter');
 f.failure(undefined,'发送内容范围拒绝：content_required');assert.equal((await f.step()).decision.kind,'enter');
 f.failure(undefined,'发送内容范围拒绝：content_required');declaredSource(f);
 assert.equal((await f.step()).decision.kind,'reject','redeclaring the same content cannot repeatedly wash away omitted IDs');
});
test('unrelated, mismatched, failed and pending declarations cannot clear missing-content failures',async()=>{
 for(const options of [{name:'mcp__snowluma__qq_get_recent_messages'},{isError:true},{body:{ok:false}},{body:{key:'group:other'}},{body:{contents:[{id:'content:wrong',seqs:[8],kind:'chat'}]}},{body:{contents:[{id:'content:pending',seqs:[7],kind:'task',taskPending:true}]}}]){
  const f=await guardFixture();f.failure(undefined,'发送内容范围拒绝：content_required');f.failure(undefined,'发送内容范围拒绝：content_required');declaredSource(f,options);
  assert.equal((await f.step()).decision.kind,'reject');
 }
});
test('valid content declarations do not clear unrelated send failures or terminal exhaustion',async()=>{
 for(const error of ['agent token 无效','网络超时','发送计划拒绝：content_limit','发送计划拒绝：turn_limit']){
  const f=await guardFixture();f.failure(undefined,error);f.failure(undefined,error);declaredSource(f);
  assert.equal((await f.step()).decision.kind,'reject');
 }
});

test('one exhausted semantic content does not stop another declared content in the same native turn',async()=>{
 const f=await guardFixture();
 f.emit('tool/call',{turn:1,callId:'declare',name:'mcp__snowluma__qq_reply_contents'});
 f.emit('tool/result',{turn:1,message:{toolCallId:'declare',content:[{type:'text',text:JSON.stringify({ok:true,contents:[{id:'content:a'},{id:'content:b'}]})}]}});
 for(let n=0;n<2;n++){
  const id='fail'+n;f.emit('tool/call',{turn:1,callId:id,name:'mcp__snowluma__qq_send_message',arguments:JSON.stringify({contentId:'content:a'})});
  f.emit('tool/result',{turn:1,message:{toolCallId:id,isError:true,content:[{type:'text',text:'发送计划拒绝：content_limit'}]}});
 }
 assert.equal((await f.step()).decision.kind,'enter');
});
test('two actual send-cap failures stop the next model request, including across send tools',async()=>{
 const f=await guardFixture();f.failure();assert.equal((await f.step()).decision.kind,'enter');
 f.failure('mcp__snowluma__qq_send_sticker','发送表情失败：发送计划拒绝：turn_limit');
 const stopped=await f.step();assert.equal(stopped.decision.kind,'reject');assert.equal(stopped.entered,0);
 assert.equal((await f.step([],2)).decision.kind,'enter','new turns do not inherit the exhausted-request loop');
});
test('new claimed input is never discarded by the request guard',async()=>{
 const f=await guardFixture();f.failure();f.failure();
 const messages=[{id:'new',source:{kind:'user'},content:[{type:'text',text:'新问题'}]}];
 const result=await f.step(messages);assert.equal(result.decision.kind,'enter');assert.deepEqual(result.decision.messages,messages);
});
test('quotes, read-tool errors, old-turn events and partial allowance do not trip the guard',async()=>{
 const f=await guardFixture();f.emit('user/message',{content:[{type:'text',text:'发送计划拒绝：turn_limit'}]});
 f.failure('mcp__snowluma__qq_get_message_detail');f.failure('mcp__snowluma__qq_reply','最多发送 2 条');
 f.emit('tool/result',{turn:1,message:{isError:true,toolCallId:'unknown',content:[{type:'text',text:'本轮发送额度已用完'}]}});
 assert.equal((await f.step()).decision.kind,'enter');
 f.failure();f.failure();assert.equal((await f.step([],2)).decision.kind,'enter');
});

test('a confirmed successful send clears the previous failure streak',async()=>{
 const f=await guardFixture();f.failure();
 f.emit('tool/call',{turn:1,callId:'sent',name:'mcp__snowluma__qq_send_message'});
 f.emit('tool/result',{turn:1,message:{toolCallId:'sent',content:[{type:'text',text:'{"ok":true,"sent":1}'}]}});
 f.failure();assert.equal((await f.step()).decision.kind,'enter');
});
test('actual HTTP message reads cannot clear token, network or exhausted-content failures',async t=>{
 for(const kind of ['token','network','cap','incomplete-network'])await t.test(kind,async()=>{
  const h=await bridgeHarness({config:{sendDelayMs:0},files:{'state/plugins/config/ctx-chat-reply-shape.json':{maxMessagesNormal:1,maxMessagesCasual:1,maxMessagesSerious:1,maxSendPerMinute:0,maxSendPerHour:0,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0}},...(kind.includes('network')?{globals:{fetch:async()=>{const error=Error('网络超时');error.knownFailed=true;throw error;}}}:{})});let server;
  try{
   h.setMode('reserved2');const key='private:123',st=h.getSocialV2State(key);st.bootstrapSent=true;
   h.appendSocialV2Message(key,'fixture','first','first',false,false,'101',[],'123');const sid=await h.ensureSession(key);
   await h.deliverPrompt(key,'',{wakeReason:'private'});await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/start',data:{turn:1}}}});
   server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
   const request=async(route,body,token=st.agentToken)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+route,{method:body?'POST':'GET',headers:{'x-console-token':'fixture-console-token','x-agent-token':token,'x-agent-call':'1',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return r.json();};
   if(kind==='cap')assert.equal((await request('/api/socialV2/send-message',{key,messages:'first answer'})).sent,1);
   const f=await guardFixture(),{describeSendRejection}=await import(rejectionURL);
   for(let n=0;n<2;n++){
    const failure=await request('/api/socialV2/send-message',{key,messages:'attempt'+n},kind==='token'?'invalid-fixture-token':st.agentToken);
    assert.equal(failure.ok,false);assert.match(failure.error,kind==='token'?/令牌/:kind==='cap'?/最多发送 0 条/:/网络超时/);
    const rejection=describeSendRejection(failure.error);f.failure('mcp__snowluma__qq_send_message','发送失败：'+(rejection?serializeModelData({...rejection,error:failure.error}):failure.error));
   }
   assert.equal((await f.step()).decision.kind,'reject');
   h.appendSocialV2Message(key,'fixture','second','second',false,false,'102',[],'123',[],undefined,false,{bodyComplete:kind!=='incomplete-network'});
   const read=await request('/api/socialV2/unread?key='+key+'&afterSeq=1');assert.equal(read.ok,true);assert.equal(read.messages[0].bodyComplete,kind!=='incomplete-network');
   f.emit('tool/call',{turn:1,callId:'actual-read',name:'mcp__snowluma__qq_get_unread_messages',arguments:JSON.stringify({key,afterSeq:1})});
   f.emit('tool/result',{turn:1,message:{toolCallId:'actual-read',isError:false,content:[{type:'text',text:serializeModelData(read)}]}});
   assert.equal((await f.step()).decision.kind,'reject','reading input does not prove that the send failure was repaired');
  }finally{if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}await h.close();}
 });
});

test('the actual preset composer installs and composes the guard before context rewriting',async()=>{
 const {apply}=await import('../plugins/qq-agent-presets/context-composer.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'send-guard-composer-')),handlers=new Map();
 try{
  apply({on(name,fn){const rows=handlers.get(name)||[];rows.push(fn);handlers.set(name,rows);}},{root});
  const session={id:'isolated'};let seq=0;
  for(const callId of ['one','two'])for(const event of [{type:'tool/call',data:{turn:1,callId,name:'mcp__snowluma__qq_reply'}},{type:'tool/result',data:{turn:1,message:{toolCallId:callId,isError:true,content:[{type:'text',text:'本轮发送额度已用完'}]}}}])for(const fn of handlers.get('session/event')||[])fn(session,{...event,seq:++seq});
  let paidRequests=0;
  const chain=handlers.get('agent/pre-step').reduceRight((next,fn)=>()=>fn({agent:{session},turn:1,step:3,messages:[]},next),async()=>{paidRequests++;return {kind:'enter',messages:[]};});
  assert.equal((await chain()).kind,'reject');assert.equal(paidRequests,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('two identical token/network send errors stop blind retries, while fresh user input really resets the streak',async()=>{
 const f=await guardFixture();f.failure('mcp__snowluma__qq_reply','agent token 无效');f.failure('mcp__snowluma__qq_reply','agent token 无效');assert.equal((await f.step()).decision.kind,'reject');
 await f.step([{id:'fresh',role:'user',content:[{type:'text',text:'新的问题'}]}]);assert.equal((await f.step()).decision.kind,'enter');
 f.failure('mcp__snowluma__qq_reply','网络超时');f.failure('mcp__snowluma__qq_reply','网络超时');await f.step([{role:'tool',toolCallId:'tool-result',content:[]}]);assert.equal((await f.step()).decision.kind,'reject','tool results do not impersonate new human input');
});
