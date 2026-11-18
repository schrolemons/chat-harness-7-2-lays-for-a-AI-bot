import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createProactive} from '../plugins/qq-components/life-wake-reasons/proactive.mjs';
import {effectiveProactiveStage,normalizeProactivePolicy} from '../plugins/qq-components/life-wake-reasons/proactive-policy.mjs';
import {createPlugin} from '../plugins/qq-components/ctx-memory-store/index.js';
const key='private:10001',day='2026-11-18',at=hour=>Date.parse(day+'T'+hour+':00+08:00');
function proactiveFixture(){let state={},wakes=0;const jobs=new Map(),facts={allowed:true,transportReady:true,busy:false,budgetAllowed:true};const config={curfewEnabled:false,unansweredAfterMinutes:20,unansweredStepMinutes:60,unansweredPenalty:15,minimumWillingness:1};const api=createProactive({config,state:{get:()=>state,set:p=>state={...state,...p}},scheduler:{schedule:j=>{jobs.set(j.id,j);return j;},cancel:id=>jobs.delete(id)},capabilities:{getProactiveFacts:()=>facts,requestProactiveWake:()=>{wakes++;return true;}}});return {api,jobs,facts,config,wakes:()=>wakes};}
test('unanswered contact keeps a small positive willingness without a three-contact speech ban',()=>{
 const f=proactiveFixture(),start=at('09:00');for(let i=0;i<3;i++)f.api.observe({key,kind:'sent',reason:'proactiveCheck',isProactive:true,episodeId:'e'+i,eventId:'s'+i,at:start+i*60000,success:true});
 assert.equal(f.api.plan({key,now:start+3*60000,facts:f.facts,random:()=>0}).allowed,true);
 for(const reason of ['proactiveCheck','timeBubble','privateFollowup','message'])assert.equal(f.api.allowsReason({key,reason,now:start+12*3600000}).allowed,true);
 const a=f.api.availability({key,now:start+12*3600000});assert.equal(a.willingness,1);assert.equal(a.baseWillingness,60);assert.equal(a.willingnessFactor,1/60);
});
test('probability growth is unchanged and the unanswered willingness is a separate multiplier',()=>{
 const f=proactiveFixture(),start=at('09:00'),p=normalizeProactivePolicy(f.config);
 f.api.observe({key,kind:'sent',reason:'proactiveCheck',isProactive:true,eventId:'s',at:start,success:true});
 const before=f.api.preview({key,now:start+19*60000}),after=f.api.preview({key,now:start+80*60000});
 assert.equal(before.effectiveProbability,effectiveProactiveStage(p,0,60).effectiveProbability);
 assert.equal(after.willingness,30);assert.equal(after.effectiveProbability,before.effectiveProbability*.5);
 assert.deepEqual(after.effectiveInterval,before.effectiveInterval);
});
test('the maximum-silence opportunity still draws the willingness multiplier instead of forcing a monologue',async()=>{
 const f=proactiveFixture(),start=at('09:00');f.api.observe({key,kind:'sent',reason:'proactiveCheck',isProactive:true,eventId:'s',at:start,success:true});
 const now=start+12*3600000;f.api.refresh({key,now,random:()=>.5});const j=f.jobs.get('proactive:'+key);assert(j);await j.run({now});assert.equal(f.wakes(),0);
 const p=f.api.preview({key,now});assert(p.effectiveProbability>0);assert.equal(p.blockedReason,'');
});
function diaryFixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'day-diary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let state={},now=at('09:05'),messages=[],plugin,finalResolve;const prompts=[],sent=[],receipts=new Map();
 const ctx={root,config:{},log(){},warn(){},state:{get:()=>state,set:p=>state={...state,...p}},callService:(s,m,p)=>plugin.services[s]?.[m]?.(p),capabilities:{random:()=>.5,now:()=>now,runtimeStartedAt:at('08:00'),memoryConfig:()=>({enabled:true,updateIntervalMin:60,dailyDiary:{enabled:true,hour:22,minute:0,maxChars:500}}),listConversationKeys:()=>[key],requestMemoryWrite:()=>false,memoryWorkerContext:()=>({role:'第一人称，简短自然',messages}),deliveryStatus:async id=>({ok:true,status:receipts.has(id)?'sent':'absent',finishedAt:receipts.get(id)}),sendDiaryDelivery:async(k,body,meta)=>{sent.push({key:k,body,meta,at:now});receipts.set(meta.id,now);return {ok:true,receiptStatus:'sent'};},runReadOnlyWorker:async p=>{prompts.push(p.prompt);const data=JSON.parse(p.prompt.split('会话资料JSON：')[1].split('\n\n资料结束')[0]);if(now>=at('22:00'))return new Promise(resolve=>finalResolve=()=>resolve({text:'从早上的小程序跑通，到午后的散步，再到晚上踏实地收尾，今天让我记住的是慢慢找到节奏的轻松，也替他高兴。'}));return {text:now<at('12:00')?'早上小程序终于跑通，我也替他高兴。':'午后散步带来轻松，我也记着早上小程序跑通时的高兴。'};}}};plugin=createPlugin(ctx);
 return {m:plugin.services.memory,worker:plugin.services.diaryWorker,prompts,sent,state:()=>state,setMessages:m=>{messages=m;const latest=m.filter(x=>!x.isSelf&&x.at<=now).at(-1);if(latest)ctx.state.set({lastIncomingAt:{[key]:latest.at}});},tick:async value=>{now=value;const latest=messages.filter(x=>!x.isSelf&&x.at<=now).at(-1);if(latest)ctx.state.set({lastIncomingAt:{[key]:latest.at}});await plugin.hooks.onTick({now});},finish:()=>finalResolve?.()};}
test('daytime drafts preserve the whole day and the bell requires a fresh generation before delivery',async t=>{
 const f=diaryFixture(t);f.setMessages([{seq:1,at:at('09:00'),userId:'10001',text:'早上把卡住的小程序修好了。'}]);await f.tick(at('09:05'));await f.worker.whenIdle({key});assert.equal(f.prompts.length,1);assert.equal(f.sent.length,0);assert.equal(f.worker.status({key}).nextDraftAt,at('10:20'),'daytime cadence uses persisted random jitter');
 f.setMessages([{seq:2,at:at('15:00'),userId:'10001',text:'下午散步放松一下。'}]);await f.tick(at('15:05'));await f.worker.whenIdle({key});assert.equal(f.prompts.length,2);assert.equal(f.sent.length,0);
 f.setMessages([{seq:3,at:at('21:58'),userId:'10001',text:'晚上准备休息，今天过得踏实。'},{seq:4,at:at('22:01'),userId:'10001',text:'这是下一窗口的话。'}]);
 await f.tick(at('22:00'));await Promise.resolve();assert.equal(f.prompts.length,3);assert.equal(f.sent.length,0,'do not send an afternoon draft as the final diary');
 const final=f.prompts.at(-1);assert.match(final,/早上小程序终于跑通/);assert.match(final,/午后散步/);assert.doesNotMatch(final,/这是下一窗口的话/);
 f.finish();await f.worker.whenIdle({key});assert.equal(f.sent.length,1);assert.match(f.sent[0].body,/早上的小程序/);assert.equal(f.sent[0].meta.id,'diary:'+key+':'+day+':scheduled');
 await f.tick(at('22:01'));assert.equal(f.prompts.length,3);assert.equal(f.sent.length,1);
});
test('a silent conversation does not acquire a new diary during the day or at the bell',async t=>{
 const f=diaryFixture(t);f.setMessages([{seq:1,at:at('09:00'),isSelf:true,text:'只有机器人自己说话。'}]);await f.tick(at('12:00'));await f.tick(at('22:00'));assert.equal(f.prompts.length,0);assert.equal(f.sent.length,0);
});

 test('diary-only generation saves the direct body without requiring a JSON envelope',async()=>{const {createDiaryWorker}=await import('../plugins/qq-components/ctx-memory-store/diary-worker.mjs');let state={},saved;const now=at('09:05');const worker=createDiaryWorker({state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{now:()=>now,memoryWorkerContext:()=>({messages:[{at:at('09:00'),userId:'10001',text:'小程序修好了。'}]}),runReadOnlyWorker:async()=>({text:'问题终于找到了，我也跟着松了一口气。'})}},{context:()=>({ok:true,day,maxDiaryChars:500,revision:'r',start:day+'T00:00:00+08:00',end:day+'T22:00:00+08:00'}),save:p=>{saved=p;return {ok:true};}});assert.equal(worker.request({key,day,now}),true);await worker.whenIdle({key});assert.equal(worker.status({key}).status,'completed');assert.equal(saved.text,'问题终于找到了，我也跟着松了一口气。');});
