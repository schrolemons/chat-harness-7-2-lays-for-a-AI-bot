// Real bridge/plugin/send-ledger integration with fake QQ/DSH and temporary state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {createMilkMonitor} from '../plugins/qq-components/tool-deepseek-balance/monitor.mjs';
import {createOutboundTransport} from '../src/outbound-context.js';
const key='private:123';
async function open(t){
 const h=await bridgeHarness({config:{sendDelayMs:0},files:{
  'state/plugins/config/life-wake-reasons.json':{curfewEnabled:false},
  'state/plugins/life-wake-reasons.json':{proactiveByKey:{[key]:{stage:4,willingness:60,source:'default',phase:'idle',availabilityVersion:1,activeConversationCount:0}}},
  'state/plugins/config/ctx-chat-reply-shape.json':{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0,maxMessagesNormal:1,maxMessagesCasual:1,maxMessagesSerious:1,maxSendPerMinute:1,maxSendPerHour:1}
 }});t.after(()=>h.close());h.setMode('reserved2');h.getSocialV2State(key).bootstrapSent=true;
 const sid=await h.ensureSession(key);return {h,sid};
}
function event(extra={}){return {key,id:'milk-test',plugin:'tool-deepseek-balance',reason:'milkStock',sourceAt:Date.now(),expiresAt:Date.now()+60000,allowedKinds:['text'],...extra};}

function fillSendWindow(h){
 const call=h.pluginHost.callService.bind(h.pluginHost),plan=call('replyPlan','resolve',{key,turnId:'baseline',autonomousSource:{id:'baseline-admission',kind:'directMessage'}});
 assert.equal(call('replyPlan','reserve',{key,plan,operationId:'baseline'}).ok,true);
 call('replyPlan','commit',{key,operationId:'baseline',deliveryId:'baseline'});
}

test('real milk admission and physical send both use a one-off timer slot after minute and hour saturation',async t=>{
 const {h,sid}=await open(t);fillSendWindow(h);
 assert.equal(h.taskCaps.getProactiveFacts(key).rateAllowed,false);
 assert.equal((await h.taskCaps.requestScheduledConversation(key,event())).ok,true);
 const envelope=h.pendingTurnEnvelopes.get(sid)[0];assert.equal(envelope.replyPlan.scheduledGrant.ids.length,1);
 assert.equal(await h.sendToQQ(key,'API预算提醒',{wakeOrigin:envelope,conversationReply:true}),true);
 assert.equal(await h.sendToQQ(key,'不得重复',{wakeOrigin:envelope,conversationReply:true}),false);
 assert.equal(h.calls.sent.length,1);
});

test('real reminder envelope carries independent persisted event slots without changing the content part policy',async t=>{
 const {h,sid}=await open(t);fillSendWindow(h);const now=Date.now();
 h.getSocialV2State(key).pendingReminderItems=['a','b','c'].map(id=>({id,text:'待办'+id,dueAt:now+60000,requestedAt:now}));
 await h.deliverPrompt(key,'',{silent:true,wakeReason:'reminder'});
 const envelope=h.pendingTurnEnvelopes.get(sid)[0];
 assert.equal(envelope.replyPlan.scheduledGrant?.ids.length,3);assert.equal(envelope.replyPlan.maxMessages,1);
 for(const text of ['提醒a','提醒b','提醒c'])assert.equal(await h.sendToQQ(key,text,{wakeOrigin:envelope,conversationReply:true}),true);
 assert.equal(await h.sendToQQ(key,'不得多发',{wakeOrigin:envelope,conversationReply:true}),false);
});

test('claimed fixed timer notifications share the same temporary overflow and still deduplicate receipts',async t=>{
 const {h}=await open(t);fillSendWindow(h);const now=Date.now();
 const meta={id:'claimed-fixed',sourceAt:now,expiresAt:now+60000};
 assert.equal((await h.taskCaps.sendNotificationDetailed(key,'固定定时通知',meta)).ok,true);
 assert.equal((await h.taskCaps.sendNotificationDetailed(key,'不得重复',meta)).ok,false);
 assert.equal((await h.taskCaps.sendNotificationBatch(key,[{id:'batch-a',sourceAt:now,expiresAt:now+60000,text:'通知a'},{id:'batch-b',sourceAt:now,expiresAt:now+60000,text:'通知b'}])).sent,true);
 assert.equal(h.calls.sent.length,2);
});

test('milk alarms, calendar reminders and time bubbles all count as active conversation on real delivery',()=>{
 const facts=[],transport=createOutboundTransport({callService:(s,m,p)=>{if(s==='proactive'&&m==='observe')facts.push(p);}});
 for(const originReason of ['milkStock','reminder','timeBubble'])transport.reportDelivered({key,success:true,originReason,wakeReason:originReason,deliveryId:originReason,sentAt:Date.now()});
 assert.equal(facts.length,3);assert(facts.every(f=>f.isProactive===true));
});

test('milk event dispatches a real LLM turn without probability draw and preserves unrelated receipts',async t=>{
 const {h,sid}=await open(t);let state={},callbacks=0;
 const monitor=createMilkMonitor({config:{},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{...h.taskCaps,getOwnerQQ:()=>123,requestScheduledConversation:async(k,e)=>{const receipt=e.onDelivered;e.onDelivered=f=>{callbacks++;receipt(f);};return h.taskCaps.requestScheduledConversation(k,e);}}},{query:async()=>({ok:true,is_available:false,balance_infos:[{currency:'CNY',total_balance:'0'}]})});
 // Use the real registered milk component's event data for its owned wakeTail.
 const plugin=h.pluginHost.get('tool-deepseek-balance');
 const original=h.pluginHost.collectWakeTails;
 h.pluginHost.collectWakeTails=p=>[original(p),monitor.wakeTail(p)].filter(Boolean).join('\n');
 const observe=h.pluginHost.callService.bind(h.pluginHost),facts=[];
 h.pluginHost.callService=(s,m,p)=>{if(s==='proactive'&&m==='observe')facts.push(p);return observe(s,m,p);};
 assert.equal(observe('proactive','preview',{key}).stage,4);
 await monitor.tick();assert.equal(h.calls.prompts.length,1);assert.equal(observe('proactive','preview',{key}).stage,4,'Admission must not reset the model before delivery');
 const text=JSON.stringify(h.calls.prompts[0]);assert.match(text,/定时主动会话：API预算告警/);assert.doesNotMatch(text,/【本次消息快照】|双戳窗口回查/);
 const envelope=h.pendingTurnEnvelopes.get(sid)[0];assert.equal(envelope.reason,'milkStock');assert.equal(envelope.replyPlan.maxMessages,1);
 assert.equal(facts.filter(f=>f.kind==='sent').length,0);assert.equal(callbacks,0);assert.equal(state.milk.scheduledNotice.status,'accepted');
 const grant=observe('replyPlan','forMessages',{key,actionId:envelope.actionId,currentPlan:envelope.replyPlan,messages:[{seq:999,text:'新消息'}],reason:'milkStock'});assert.equal(grant.changed,false);
 await h.sendToQQ(key,'API预算见底了，有点舍不得喝。',{wakeOrigin:envelope,conversationReply:true});
 assert.equal(callbacks,1);assert.equal(state.milk.scheduledNotice.status,'sent');assert.equal(facts.at(-1).isProactive,true);assert.equal(facts.at(-1).reason,'milkStock');
 assert.equal(observe('proactive','preview',{key}).stage,0);
 assert.equal(h.pluginHost.get('life-wake-reasons').state.proactiveByKey[key].activeConversationCount,1);
 assert.equal(Object.keys(h.pluginHost.get('ctx-user-mood').state.mood?.waits||{}).length,0);
 assert.equal(await h.sendToQQ(key,'再说一句',{wakeOrigin:envelope,conversationReply:true}),false);
 assert.equal(callbacks,1);assert.equal(plugin.id,'tool-deepseek-balance');
});

test('scheduled dispatch respects pause/offline/busy/expiry and does not call the model on a blocked event',async t=>{
 const {h}=await open(t);
 for(const [set,reset,reason] of [
  [()=>h.socialV2.paused=true,()=>h.socialV2.paused=false,'paused'],
  [()=>h.setReady(false),()=>h.setReady(true),'unavailable']
 ]){set();assert.equal((await h.taskCaps.requestScheduledConversation(key,event())).reason,reason);reset();}
 assert.equal((await h.taskCaps.requestScheduledConversation(key,event({expiresAt:1}))).ok,false);
 const originalFacts=h.taskCaps.getProactiveFacts;
 for(const flag of ['budgetAllowed','rateAllowed']){h.taskCaps.getProactiveFacts=k=>({...originalFacts(k),[flag]:false});assert.equal((await h.taskCaps.requestScheduledConversation(key,event())).reason,'budget_or_rate');}
 h.taskCaps.getProactiveFacts=originalFacts;
 h.pluginHost.setEnabled('tool-deepseek-balance',false);assert.equal((await h.taskCaps.requestScheduledConversation(key,event())).ok,false);h.pluginHost.setEnabled('tool-deepseek-balance',true);await h.pluginHost.reload('tool-deepseek-balance');
 assert.equal(h.calls.prompts.length,0);
 const admitted=await h.taskCaps.requestScheduledConversation(key,event());assert.equal(admitted.ok,true,JSON.stringify(admitted));
 assert.equal((await h.taskCaps.requestScheduledConversation(key,event({id:'another'}))).reason,'busy');assert.equal(h.calls.prompts.length,1);
});

test('event expiry, component deactivation and target/media restriction stop physical sends',async t=>{
 const {h,sid}=await open(t);const e=event();assert.equal((await h.taskCaps.requestScheduledConversation(key,e)).ok,true);
 const envelope=h.pendingTurnEnvelopes.get(sid)[0];
 assert.equal(await h.sendToQQ('group:456','不得转发',{wakeOrigin:envelope,conversationReply:true}),false);
 const c=h.outboundContext(key,{wakeOrigin:envelope});
 const {outboundScope}=await import('../src/outbound-context.js');
 await assert.rejects(outboundScope.run(c,()=>h.onebotHttpAction('send_poke',{user_id:123})),/消息类型/);
 e.expiresAt=0;assert.equal(await h.sendToQQ(key,'过期告警',{wakeOrigin:envelope,conversationReply:true}),false);
 assert.equal(h.calls.sent.length,0);
});

test('known model refusal is retryable and failed physical delivery never resets proactive state or confirms the alert',async t=>{
 const {h,sid}=await open(t),originalPrompt=h.api.sessions.prompt;
 h.api.sessions.prompt=async()=>({result:{ok:false,error:{code:'fixture_refused',message:'fixture'}}});
 assert.equal((await h.taskCaps.requestScheduledConversation(key,event())).ok,false);assert.equal(h.pendingTurnEnvelopes.get(sid),undefined);
 h.api.sessions.prompt=originalPrompt;let receipts=0;
 assert.equal((await h.taskCaps.requestScheduledConversation(key,event({onDelivered:()=>receipts++}))).ok,true);
 const envelope=h.pendingTurnEnvelopes.get(sid)[0];h.bot.sendPrivateMessage=async()=>{throw Object.assign(Error('fixture_failed'),{knownFailed:true});};
 assert.equal(await h.sendToQQ(key,'API预算提醒',{wakeOrigin:envelope}),false);assert.equal(receipts,0);
 assert.equal(h.pluginHost.callService('proactive','preview',{key}).stage,4);
 h.pluginHost.setEnabled('tool-deepseek-balance',false);
 assert.equal(await h.sendToQQ(key,'停用后不得发',{wakeOrigin:envelope}),false);
});

test('ordinary successful chat cancels an already admitted milk turn at the real physical-send guard',async t=>{
 const {h,sid}=await open(t);let state={};
 const monitor=createMilkMonitor({config:{},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{...h.taskCaps,getOwnerQQ:()=>123}},{query:async()=>({ok:true,is_available:false,balance_infos:[{currency:'CNY',total_balance:'0'}]})});
 // Feed the real route's afterSend dispatch to the isolated monitor instance.
 const emit=h.pluginHost.emitSent.bind(h.pluginHost);
 h.pluginHost.emitSent=payload=>{emit(payload);monitor.sent(payload);};
 await monitor.tick();const envelope=h.pendingTurnEnvelopes.get(sid)[0];
 const ordinary=await h.sendAgentReplyV2(key,'预算池空了，这会儿舍不得喝。');
 assert.equal(ordinary.sent,1);assert.equal(state.milk.scheduledNotice.status,'covered');
 assert.equal(await h.sendToQQ(key,'重复的预算池提醒',{wakeOrigin:envelope,conversationReply:true}),false);
 assert.equal(h.calls.sent.length,1);
});

test('milk coverage arriving during transport delay is rechecked before the physical send',async()=>{
 let state={},meta,entered,release,sends=0;
 const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const monitor=createMilkMonitor({config:{},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{getOwnerQQ:()=>123,requestScheduledConversation:async(_key,e)=>{meta=e;return {ok:true};}}},{query:async()=>({ok:true,is_available:false,balance_infos:[{currency:'CNY',total_balance:'0'}]})});
 await monitor.tick();
 const transport=createOutboundTransport({sleep:async()=>{entered();await gate;},guard:()=>()=>{if(meta.expiresAt<Date.now())throw Error('定时事件已失效');},callService:(s,m)=>s==='replyPlan'&&m==='reserve'?{ok:true,waitMs:1}:s==='replyPlan'&&m==='authorize'?{ok:true}:undefined});
 const waiting=transport.perform({key,context:transport.capture({key,envelope:{reason:'milkStock',scheduledEvent:meta,replyPlan:{maxMessageChars:500}}}),text:'重复预算池提醒',send:async()=>{sends++;}});
 await ready;monitor.sent({key,success:true,messages:['预算池空了']});release();
 await assert.rejects(waiting,/定时事件已失效/);assert.equal(sends,0);
});

test('a server-owned balance notice is independent of the conversation topic cooldown',async()=>{
 let writes=0,topicChecks=0;
 const transport=createOutboundTransport({callService:(service,method)=>{
  if(service==='conversationDrive'&&method==='reserve'){topicChecks++;return {ok:false,reason:'new_topic_cooldown'};}
  if(service==='replyPlan'&&method==='reserve')return {ok:true,waitMs:0};
  if(service==='replyPlan'&&method==='authorize')return {ok:true};
 }});
 const envelope={key,reason:'milkStock',scheduledEvent:{key,allowedKinds:['text']},replyPlan:{maxMessageChars:500,scheduledGrant:{ids:['balance']}}};
 const context=transport.capture({key,envelope,agent:true,conversationIntent:'newTopic'});
 await transport.perform({key,context,text:'测试余额恢复',send:async()=>{writes++;}});
 assert.equal(writes,1);assert.equal(topicChecks,0);
 const chat=transport.capture({key,envelope:{key,replyPlan:{maxMessageChars:500}},conversationIntent:'newTopic'});
 await assert.rejects(transport.perform({key,context:chat,text:'测试普通新话题',send:async()=>{writes++;}}),/new_topic_cooldown/);
 assert.equal(writes,1);
});
