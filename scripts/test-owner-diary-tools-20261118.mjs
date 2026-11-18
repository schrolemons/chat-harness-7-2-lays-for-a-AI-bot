import test from 'node:test';import assert from 'node:assert/strict';
import {declareReplyContents} from '../src/console/reply-contents.mjs';
import {createReplyContentCarrier} from '../src/mcp-content-carrier.mjs';
import {createPlugin as createShape} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
import {createOutboundTransport} from '../src/outbound-context.js';
import {createMoodLedger} from '../plugins/qq-components/ctx-user-mood/ledger.mjs';
import {moodPolicy} from '../plugins/qq-components/ctx-user-mood/policy.mjs';
import {createPlugin as createAck} from '../plugins/qq-components/life-message-ack/index.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';

test('22:52 diary-history source is classified and admitted before the same send, without guessing chat/task',async()=>{
 const key='private:10001',messages=[{seq:692,messageId:'diary-question',text:'请读取本会话已经保存的日记历史。',bodyComplete:true}];let state={},admissions=0,sends=0;
 const reply=createShape({config:{},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{},isPluginEnabled:()=>false}).services.replyPlan;
 const plan=reply.resolve({key,turnId:'owner-diary',incomingText:messages[0].text}),envelope={key,reason:'private',replyPlan:plan,taskSources:{692:{eligible:true,kind:'read'}}};
 const carrier=createReplyContentCarrier({declareContents:async input=>{
  const out=await declareReplyContents({key,sourceKey:key,envelope,groups:input.groups,messages,allowed:true,
   callService:(s,m,p)=>s==='replyPlan'?reply[m](p):{eligible:true,kind:'read'},
   admitTaskContents:async({contents})=>{admissions++;for(const c of contents)reply.claimTaskGroup({key,groupId:c.id,plan});return {ok:true};}});return out.body;
 }});
 const send=carrier.decorate('qq_send_message',['send',{},async()=>{sends++;return {content:[{type:'text',text:'{"ok":true}'}]};}])[2];
 await send({key,token:'isolated',sourceSeqs:[692],messages:'先读取已保存日记。'});assert.equal(admissions,1);assert.equal(sends,1);
});

test('normal follow-up delivery starts the mood clock; independent diary/notification delivery does not',()=>{
 let data={};const ctx={state:{get:()=>data,set:p=>data={...data,...p}}},mood=createMoodLedger(ctx,()=>moodPolicy({noReplyAfterMinutes:20,noReplyPenalty:5,minimumScore:60,dailyFloor:100}));
 const transport=createOutboundTransport({callService:(s,m,p)=>s==='mood'?mood[m]?.(p):s==='conversationDrive'&&m==='sent'?{isProactive:p.conversationIntent==='followup',episodeId:p.proactiveId}:null});
 const key='private:123',at=Date.now();
 transport.reportDelivered({key,sourceKey:key,origin:'conversation',originReason:'private',wakeReason:'message',conversationIntent:'followup',success:true,deliveryId:'followup',proactiveId:'episode1',sentAt:at});
 transport.reportDelivered({key,sourceKey:key,origin:'purpose',originReason:'dailyDiary',wakeReason:'dailyDiary',success:true,deliveryId:'diary',proactiveId:'diary1',sentAt:at});
 mood.settle({now:at+21*60000});assert.equal(mood.read({key,now:at+21*60000}).score,95);assert.equal(Object.keys(data.mood.waits).length,1);
});

test('two wait notices retain their configured order even with inverted console delays',()=>{
 const plan=createAck({config:{privateWait:{delayMs:60000,lines:['first']},privateApology:{delayMs:30000,lines:['second']}}}).services.messageAck.plan({key:'private:123'});
 assert(plan.apology.delayMs>plan.wait.delayMs);assert(plan.wait.enabled&&plan.apology.enabled);
});

test('a stale general-memory flag cannot disable diary buttons or invent a running diary job',async t=>{
 const h=await bridgeHarness();h.setMode('reserved2');const key='private:123',st=h.getSocialV2State(key);st.pendingMemoryWrite=true;st.diaryRequestedAt=Date.now();
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 t.after(async()=>{server.closeAllConnections?.();await new Promise(r=>server.close(r));await h.close();});
 const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/daily-diary',{headers:{'x-console-token':'fixture-console-token'}});assert.equal(r.status,200);
 const entry=(await r.json()).conversations.find(c=>c.key===key);assert.equal(entry.diaryPending,false);assert.equal(entry.diaryJob.status,'idle');assert.equal(h.calls.sent.length,0);
});
