import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPlugin} from '../plugins/qq-components/ctx-context-session/index.js';

test('current identity takes priority over historical self-introductions without rewriting history',()=>{
 const blocks=[];
 createPlugin({config:{},addPromptBlock:t=>blocks.push(t)}).hooks.beforePrompt({roleName:'AI助手',selfName:'DeepSeekAI助手',selfId:'123'});
 assert.match(blocks.join('\n'),/历史.*(?:自称|自我介绍).*不.*(?:身份|角色)/);
 assert.match(blocks.join('\n'),/自我介绍.*当前角色/);
 assert.doesNotMatch(blocks.join('\n'),/通用助手/);
 const other=[];createPlugin({config:{},addPromptBlock:t=>other.push(t)}).hooks.beforePrompt({roleName:'纸鹤',selfName:'纸鹤',selfId:'123'});
 assert.match(other.join('\n'),/纸鹤/);assert.doesNotMatch(other.join('\n'),/AI助手/);
});

const rejectionURL=new URL('../plugins/qq-components/ctx-chat-reply-shape/send-rejection.mjs',import.meta.url);
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
test('reading old or paged history never clears failures; only a newly granted reply batch does once',async()=>{
 const f=await guardFixture();f.failure();f.failure();
 const read=(id,result)=>{f.emit('tool/call',{turn:1,callId:id,name:'mcp__snowluma__qq_get_recent_messages'});f.emit('tool/result',{turn:1,message:{toolCallId:id,content:[{type:'text',text:JSON.stringify(result)}]}});};
 read('old',{ok:true,messages:[{seq:10}]});assert.equal((await f.step()).decision.kind,'reject');
 read('old-page',{ok:true,messages:[{seq:20}]});assert.equal((await f.step()).decision.kind,'reject');
 const batch={renewed:true,id:'action:batch:21',throughSeq:21};read('new',{ok:true,messages:[{seq:21}],replyBatch:batch});assert.equal((await f.step()).decision.kind,'enter');
 f.failure();f.failure();read('reread',{ok:true,messages:[{seq:21}],replyBatch:batch});assert.equal((await f.step()).decision.kind,'reject');
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
