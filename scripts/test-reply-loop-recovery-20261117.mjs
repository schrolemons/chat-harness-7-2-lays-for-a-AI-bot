import test from 'node:test';import assert from 'node:assert/strict';import {bridgeHarness,fixtureReplyTurn} from './audit-bridge-harness.mjs';
import {validateContextSend} from '../plugins/qq-components/ctx-chat-reply-shape/context-send-policy.mjs';
async function open(t,maxParts=1){const h=await bridgeHarness({config:{sendDelayMs:0,socialV2:{proactive:{enabled:false},wait:{minMs:100,maxMs:200,minQuietAfterNewMs:0}}},files:{'state/plugins/config/ctx-chat-reply-shape.json':{maxMessagesNormal:maxParts,maxMessagesCasual:maxParts,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},'state/plugins/config/life-conversation-wait.json':{endProbabilityPercent:100,probabilityStepPercent:100}}});let server;t.after(async()=>{if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}await h.close();});h.setMode('reserved2');const key='private:123';h.appendSocialV2Message(key,'示例成员甲','这个破助手怎么什么都要插一嘴','这个破助手怎么什么都要插一嘴',false,false,'complaint',[],'123',[],undefined,false,{bodyComplete:true});await fixtureReplyTurn(h,key);server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));const st=h.getSocialV2State(key),base='http://127.0.0.1:'+server.address().port,headers={'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-token':st.agentToken};const call=async(route,body)=>{const r=await fetch(base+route,{headers,...(body?{method:'POST',body:JSON.stringify({key,...body})}:{})});return {status:r.status,body:await r.json()};};assert.equal((await call('/api/socialV2/unread?key='+key)).status,200);return {h,key,st,call,send:text=>call('/api/socialV2/send-message',{messages:text})};}
test('one completed chat content closes only its proven sources before a separate receipt or wait',async t=>{
 const f=await open(t),sent=await f.send('好，这句AI助手收住了。');assert.equal(sent.body.sent,1,JSON.stringify(sent));assert(f.st.recentMessages.find(m=>m.seq===1).repliedAt>0);assert(!f.st.unread.some(m=>m.seq===1));
 const repeat=await f.send('AI助手不插嘴了。');assert.equal(repeat.body.ok,false);assert.equal(f.h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,1);
 const report=await f.call('/api/socialV2/receipt-report',{receipts:[{seq:1,status:'replied'}]});assert.equal(report.status,200);const again=await f.call('/api/socialV2/receipt-report',{receipts:[{seq:1,status:'replied'}]});assert.equal(again.status,200);
 const wait=await f.call('/api/socialV2/wait',{purpose:'messages',timeoutMs:100});assert.equal(wait.status,200,JSON.stringify(wait.body));assert.equal(wait.body.endRound,true);
});
test('a declared multipart answer stays open until its final permitted part and then closes once',async t=>{
 const f=await open(t,2);assert.equal((await f.send('先说明第一点。')).body.sent,1);assert(!f.st.recentMessages.find(m=>m.seq===1).repliedAt);assert.equal((await f.send('再说明另一项必要细节。')).body.sent,1);assert(f.st.recentMessages.find(m=>m.seq===1).repliedAt>0);
});
test('the durable confirmed-send ledger repairs a lost transient receipt marker without resending',async t=>{
 const f=await open(t,2);assert.equal((await f.send('已接住这句明确的反馈。')).body.sent,1);f.st.receiptSendPendingSeqs=[];const report=await f.call('/api/socialV2/receipt-report',{receipts:[{seq:1,status:'replied'}]});assert.equal(report.status,200,JSON.stringify(report.body));assert.equal(f.h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,1);
});
test('same-meaning interleaved inputs may form one group ordered by its first required source',()=>{
 assert.equal(validateContextSend({agent:true,requiredSeqs:[1386,1388,1395],selectedSeqs:[1386,1395]}).ok,true);
 assert.equal(validateContextSend({agent:true,requiredSeqs:[1386,1388,1395],selectedSeqs:[1388]}).ok,false);
});
test('repeating a successful receipt is idempotent after its transient proof was consumed',async t=>{
 const f=await open(t,2);assert.equal((await f.send('这一条反馈已接住。')).body.sent,1);
 for(let i=0;i<3;i++){const r=await f.call('/api/socialV2/receipt-report',{receipts:[{seq:1,status:'replied'}]});assert.equal(r.status,200,JSON.stringify({attempt:i,response:r.body}));}
 assert.equal(f.h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,1);
});
