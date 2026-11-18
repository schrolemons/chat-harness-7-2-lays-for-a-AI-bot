import test from'node:test';import assert from'node:assert/strict';
import{createPlugin as scheduler}from'../plugins/qq-components/life-scheduler/index.js';
import{createPlugin as lifecycle}from'../plugins/qq-components/ctx-context-lifecycle/index.js';
import{buildWakeGuidance}from'../plugins/qq-components/life-wake-reasons/guidance.js';
import{pruneObservedWakeBacklog}from'../plugins/qq-components/life-history-context/wake-backlog.mjs';
import{REFRESH_MODULE_IDS}from'../plugins/qq-components/obs-context-assembly/refill.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('admitted immediate wakes run without waiting for a timer tick, exactly once',async()=>{
 const p=scheduler({runtime:{},config:{},isActive:()=>true}),s=p.services.scheduler;let count=0;
 s.schedule({id:'bridge:pendingWakeTimer:private:1',type:'pendingWakeTimer',at:Date.now(),run:()=>count++});
 await flush();assert.equal(count,1);await p.hooks.onTick({now:Date.now()+1000});await flush();assert.equal(count,1);
});
test('microtask dispatch still observes cancellation, replacement, owner and expiration',async()=>{
 const warnings=[],p=scheduler({runtime:{},config:{},isActive:()=>true,isPluginEnabled:id=>id!=='disabled',warn:s=>warnings.push(s)}),s=p.services.scheduler,ran=[];
 const spec=(id,extra={})=>({id,type:'pendingWakeTimer',at:Date.now(),run:()=>ran.push(id),...extra});
 const h=s.schedule(spec('cancel'));s.cancel(h);
 s.schedule(spec('replace',{run:()=>ran.push('old')}));s.schedule(spec('replace',{run:()=>ran.push('new')}));
 s.schedule(spec('disabled',{owner:'disabled'}));s.schedule(spec('expired',{expiresAt:Date.now()-1,onExpire:()=>ran.push('expired-cleanup')}));
 await flush();assert.deepEqual(ran.sort(),['expired-cleanup','new']);assert.equal(warnings.length,0);
});
test('transport warmup, host retirement, future jobs and resume guard cannot be bypassed',async()=>{
 let ready=false,active=true,count=0;const runtime={lastTickAt:Date.now(),transportReadySince:Date.now()-31000};
 const ctx={runtime,config:{},isActive:()=>active,capabilities:{getTransportReadiness:()=>({ready})}},p=scheduler(ctx),s=p.services.scheduler;
 s.schedule({id:'blocked',type:'pendingWakeTimer',at:Date.now(),requiresTransport:true,run:()=>count++});await flush();assert.equal(count,0);assert(s.inspect({id:'blocked'}));
 ready=true;await p.hooks.onTick({now:Date.now()});await flush();assert.equal(count,0,'fresh connectivity must remain stable for 30s');
 await p.hooks.onTick({now:Date.now()+31000});await flush();assert.equal(count,1);
 s.schedule({id:'future',type:'pendingWakeTimer',at:Date.now()+10000,run:()=>count++});await flush();assert.equal(count,1);
 s.schedule({id:'retired',type:'pendingWakeTimer',at:Date.now(),run:()=>count++});active=false;await flush();assert.equal(count,1);active=true;
 runtime.lastTickAt=Date.now()-61000;s.schedule({id:'resume',type:'pendingWakeTimer',at:Date.now(),run:()=>count++});await flush();assert.equal(count,1,'sleep recovery must first pass the central tick');
});
test('observed optional context and completed required input do not start another stale wake',()=>{
 const optional={seq:1,seenAt:10,replyDisposition:'history',text:'群友闲聊'},complete={seq:2,seenAt:10,repliedAt:20,replyRequirement:'required',text:'已答问题'};
 const st={lastUnreadSeq:2,recentMessages:[optional,complete],unread:[optional],pendingWakeReasons:[{reason:'message',seq:1},{reason:'atMention',seq:2},{reason:'reminder',seq:1}]};
 assert.equal(pruneObservedWakeBacklog(st),2);assert.deepEqual(st.pendingWakeReasons,[{reason:'reminder',seq:1}]);assert.equal(st.unread.length,1);assert.equal(optional.repliedAt,undefined);assert.equal(complete.repliedAt,20);
});
test('unseen optional arrivals, uncompleted required input and filtered views retain their wake',()=>{
 for(const message of[{seq:1,replyDisposition:'history'},{seq:1,seenAt:10,replyRequirement:'required'},{seq:1,quotaAdmission:'pending',replyDisposition:'history',seenAt:10}]){
  const st={lastUnreadSeq:1,unread:[message],recentMessages:[],pendingWakeReasons:[{reason:'message',seq:1}]};assert.equal(pruneObservedWakeBacklog(st),0);
 }
 const st={lastUnreadSeq:2,recentMessages:[{seq:1,seenAt:1,repliedAt:2}],pendingWakeReasons:[{reason:'message',seq:1}]};assert.equal(pruneObservedWakeBacklog(st),0,'hidden newer ingress must not be retired by the filtered model view');
});
test('active prompt omits program-only probability derivations and refreshes real elapsed quiet time',()=>{
 const blocks=[],w={maxWakePerMinute:7,maxWakePerHour:31,recommendedHint:'管理员要求：简洁但认真'},payload={st:{wakeConfig:{infinite:true},lastIncomingAt:Date.now()-12000},wakeConfig:w,replyTiming:{quietMs:8000,remainingQuietMs:3000}};
 const p=lifecycle({config:{},addPromptBlock:t=>blocks.push(t)});p.hooks.beforePrompt(payload);const text=blocks.join('\n');
 assert(text.includes('还差约 0 秒'));assert(!text.includes('min(1,p+q)'));assert(!text.includes('每小时最多'));assert(text.includes(w.recommendedHint));assert(text.includes('必答以入栈tag为准'));assert(text.includes('收到新消息立即接住'));
 assert(buildWakeGuidance(w).includes('每小时最多 31 次'),'Console still explains actual configured numeric rules');
 assert(REFRESH_MODULE_IDS.includes('ctx-context-lifecycle'));assert(REFRESH_MODULE_IDS.includes('life-history-context'));
 assert(text.length<1000,'the active control text must remain compact');
});
