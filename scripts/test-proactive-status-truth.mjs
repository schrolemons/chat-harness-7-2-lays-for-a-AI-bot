import test from 'node:test';
import assert from 'node:assert/strict';
import {createProactive} from '../plugins/qq-components/life-wake-reasons/proactive.mjs';
import {createPlugin as createScheduler} from '../plugins/qq-components/life-scheduler/index.js';
import {availabilityReviewText} from '../plugins/qq-components/life-wake-reasons/availability-evidence.mjs';
import {effectiveProactiveStage,normalizeProactivePolicy} from '../plugins/qq-components/life-wake-reasons/proactive-policy.mjs';
import {renderProactivePreview} from '../console/layers/L/proactive-preview.js';
const now=Date.parse('2026-11-12T21:30:00+08:00'),key='private:10001',minute=60000;
function fixture(config={}){
 let data={},quiet=false,wakes=0,facts={allowed:true,transportReady:true,budgetAllowed:true,rateAllowed:true,busy:false,conversationAwake:false,mood:{score:60}};
 const scheduler=createScheduler({runtime:{},config:{}}).services.scheduler;
 const ctx={config:{curfewEnabled:false,...config},state:{get:()=>data,set:p=>data={...data,...p}},scheduler,
  capabilities:{getProactiveFacts:()=>facts,requestProactiveWake:()=>{wakes++;return {accepted:true};}},
  callService:(s,m,p)=>s==='scheduler'?scheduler[m]?.(p):s==='availability'?{quietNow:quiet}:s==='profileStore'?{wake:[],work:[]}:null};
 return {p:createProactive(ctx),scheduler,state:()=>data,facts:p=>facts={...facts,...p},quiet:v=>quiet=v,wakes:()=>wakes};
}
const html=p=>renderProactivePreview([{key,proactive:p}]);

test('1 current session uses live host facts; private input never draws group wake probability',()=>{
 const f=fixture({initialProbability:0});let p=f.p.preview({key,now});
 assert.equal(p.conversationAwake,false);assert.equal(p.incomingRoute,'direct');assert.match(html(p),/私聊来信直接进入处理/);
 assert.equal(f.p.incoming({key,random:()=>{throw Error('private must not draw');}}).accepted,true);
 f.facts({conversationAwake:true});assert.equal(f.p.preview({key,now}).conversationAwake,true);
 const group='group:40001';assert.equal(f.p.incoming({key:group,eventId:'active',at:now,random:()=>{throw Error('active group must not draw');}}).probability,1);
});
test('2 stage resets only on real activity; late timestamps update facts without rewinding the plan',()=>{
 const f=fixture();f.state().proactiveByKey={[key]:{stage:3,willingness:60,source:'default',phase:'scheduled',nextAt:now+minute,lastActivityAt:now}};
 f.p.observe({key,at:now+1,kind:'sent',reason:'thinkingAck'});assert.equal(f.p.preview({key,now}).stage,3);
 f.p.observe({key,at:now-1000,kind:'incoming',hasText:true,eventId:'late'});
 let p=f.p.preview({key,now});assert.equal(p.stage,3);assert.equal(p.nextAt,now+minute);assert.equal(p.lastIncomingAt,now-1000);
 f.p.observe({key,at:now+2,kind:'incoming',hasText:true,eventId:'fresh'});assert.equal(f.p.preview({key,now}).stage,0);
});
test('3 displayed probability and interval use the same formula as the scheduled check',()=>{
 const f=fixture({initialProbability:.65});f.p.refresh({key,now,random:()=>.5});const p=f.p.preview({key,now});
 const effective=effectiveProactiveStage(normalizeProactivePolicy({initialProbability:.65}),0,60,{score:60});
 assert.equal(p.effectiveProbability,effective.effectiveProbability);assert.deepEqual(p.effectiveInterval,effective.effectiveInterval);
 assert.equal(f.state().proactiveByKey[key].scheduledProbability,p.effectiveProbability);
});
test('4 both stale low and stale high availability expire to the configured neutral value',()=>{
 for(const value of [15,90]){const f=fixture({initialWillingness:60});f.p.setWillingness({key,value,reason:'昨天临时忙闲',assessment:{kind:'other'},now:now-25*60*minute});
  const before=structuredClone(f.state()),p=f.p.preview({key,now});assert.equal(p.willingness,60);assert.equal(p.source,'evidence-expired');assert.deepEqual(f.state(),before);
  f.p.refresh({key,now});assert.equal(f.state().proactiveByKey[key].willingness,60);assert.equal(f.state().proactiveByKey[key].source,'evidence-expired');
 }
});
test('5 last AI date is historical evidence, not the page refresh date; real new assessment replaces it',()=>{
 const f=fixture(),old=Date.parse('2026-11-11T18:51:30+08:00');f.p.setWillingness({key,value:55,reason:'今天他没来信',now:old});
 let p=f.p.preview({key,now});assert.equal(p.lastAI.at,old);assert.match(html(p),/上次 AI 评估（历史）/);assert.match(html(p),/2026\/11\/11/);
 const prompt=availabilityReviewText(f.p.availability({key,now}));assert.doesNotMatch(prompt,/今天他没来信/);assert.match(prompt,/正文发送成功后.*qq_set_wake_config/);
 f.p.setWillingness({key,value:80,reason:'本人刚说现在有空',assessment:{kind:'available'},now});p=f.p.preview({key,now});assert.equal(p.lastAI.at,now);assert.equal(p.willingness,80);assert.equal(p.review,null);
});
test('6 actual private incoming invalidates a sleep assumption; explicit quiet remains protected',()=>{
 const f=fixture();f.p.setWillingness({key,value:20,reason:'本人准备睡觉',assessment:{kind:'sleep'},now:now-minute});
 f.facts({lastIncomingAt:now});const p=f.p.preview({key,now});assert.equal(p.willingness,60);assert.equal(p.source,'incoming-after-sleep');
 f.quiet(true);assert.equal(f.p.preview({key,now}).willingness,20);
});
test('7 interval display rounds floating artifacts without changing scheduling arithmetic',()=>{
 const f=fixture(),p={...f.p.preview({key,now}),effectiveInterval:{minMinutes:6.6000000000000005,maxMinutes:13.200000000000001}};
 assert.match(html(p),/6\.6–13\.2 分钟/);assert.doesNotMatch(html(p),/0000000000/);
});
test('8 next check distinguishes a stored plan from the actual scheduler job and never rerolls on preview',()=>{
 const f=fixture();f.p.refresh({key,now,random:()=>.5});let p=f.p.preview({key,now}),before=structuredClone(f.state());
 assert.equal(p.scheduledJob.at,p.nextAt);assert.equal(p.scheduledJob.id,'proactive:'+key);
 f.facts({mood:{score:100}});p=f.p.preview({key,now:now+minute});assert.notDeepEqual(p.scheduledInterval,p.effectiveInterval);assert.equal(p.nextAt,before.proactiveByKey[key].nextAt);assert.deepEqual(f.state(),before);
 f.scheduler.cancel('proactive:'+key);p=f.p.preview({key,now});assert.equal(p.scheduledJob,null);assert.match(html(p),/保留计划.*当前未排队/);
});
test('9 blockers use current gate facts, not stale remembered blockers; blocked refresh cancels only its own job',()=>{
 const f=fixture();f.p.refresh({key,now});f.scheduler.schedule({id:'other',at:now+minute,run(){}});f.facts({busy:true});
 f.p.refresh({key,now});let p=f.p.preview({key,now});assert.equal(p.blockedReason,'busy');assert.equal(p.scheduledJob,null);assert(f.scheduler.inspect({id:'other'}));
 f.facts({busy:false});p=f.p.preview({key,now});assert.equal(p.blockedReason,'');assert.match(html(p),/持有计划，当前未排队/);
});
test('10 current phase and historical no-send reason are separate facts with separate timestamps',()=>{
 const f=fixture();f.state().proactiveByKey={[key]:{stage:0,willingness:60,phase:'accepted'}};
 f.p.finished({key,now:now-minute});f.p.refresh({key,now});const p=f.p.preview({key,now}),view=html(p);
 assert.equal(p.phase,'scheduled');assert.equal(p.lastFinishedReason,'no-send');assert.equal(p.lastFinishedAt,now-minute);
 assert.match(view,/<dt>当前状态<\/dt><dd>等待主动检查<\/dd>/);assert.match(view,/<dt>上轮结束原因/);assert.equal(p.observedAt,now);
 assert.doesNotMatch(view,/evidence-expired|scheduled · proactiveCheck · no-send/);
});
