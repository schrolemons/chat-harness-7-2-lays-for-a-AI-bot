import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/life-token-budget/index.js';
const key='group:456',groupId='content:task:1';
function fixture(saved={}){
 let state=structuredClone(saved),allowed=false,claimAllowed=false,dispatch={accepted:true},now=1_000_000,claims=0,charged=0,wakes=0;
 const jobs=new Map(),events=[],credits=new Set();
 const ctx={config:{},state:{get:()=>state,set:p=>{state={...state,...p};}},scheduler:{schedule:s=>{jobs.set(s.id,s);return {scheduledId:s.id};},cancel:id=>jobs.delete(typeof id==='string'?id:id.scheduledId)},
 capabilities:{taskAdmissionStatus:async req=>{events.push(['status',req]);return {allowed,reason:allowed?'':'hard_or_throttle',plan:{maxSendPerMinute:1,maxSendPerHour:1}};},requestTaskAdmissionWake:async req=>{wakes++;events.push(['wake',req,state.taskAdmissionQueue[groupId]?.status]);if(dispatch instanceof Error)throw dispatch;return dispatch;}},
 callService:(s,m,p)=>{if(s==='replyPlan'&&m==='claimTaskGroup'){claims++;events.push(['claim',p]);if(!claimAllowed)return {ok:false,reason:'minute_limit'};if(!credits.has(p.groupId)){credits.add(p.groupId);charged++;}return {ok:true,groupId:p.groupId,alreadyClaimed:credits.has(p.groupId)};}},isActive:()=>true};
 const plugin=createPlugin(ctx),api=plugin.services.tokenBudget;
 return {plugin,api,jobs,events,state:()=>structuredClone(state),allowed:v=>allowed=v,claimAllowed:v=>claimAllowed=v,dispatch:v=>dispatch=v,counts:()=>({claims,charged,wakes}),async run(){assert.ok(jobs.size,'a central scheduler job must exist');const [id,job]=jobs.entries().next().value;jobs.delete(id);now=Math.max(now,job.at);await job.run({now});},enqueue:()=>api.queueTaskAdmission({key,groupId,sourceSeqs:[7,8],wakeReason:'atMention',originActionId:'original-wake',messages:[{seq:7,text:'执行任务',plain:'执行任务',bodyComplete:true},{seq:8,text:'任务细节',plain:'任务细节',bodyComplete:true}],now})};
}
test('task admission queue persists a legitimately recognized group and uses only central scheduler callbacks',async()=>{
 const f=fixture();assert.equal(typeof f.api.queueTaskAdmission,'function');assert.equal(f.enqueue().ok,true);const row=f.api.taskAdmissionQueueStatus({groupId});assert.equal(row.status,'waiting');assert.deepEqual(row.sourceSeqs,[7,8]);assert.equal(f.jobs.size,1);await f.run();assert.equal(f.counts().wakes,0);assert.equal(f.counts().claims,0);assert.equal(f.jobs.size,1);assert.equal(f.api.taskAdmissionQueueStatus({groupId}).status,'waiting');
});
test('a full minute/hour budget retains pending source until a single group credit can be claimed',async()=>{
 const f=fixture();f.enqueue();f.allowed(true);await f.run();assert.equal(f.counts().charged,0);assert.equal(f.counts().wakes,0);assert.equal(f.api.taskAdmissionQueueStatus({groupId}).status,'waiting');f.claimAllowed(true);await f.run();assert.equal(f.counts().charged,1);assert.equal(f.counts().wakes,1);assert.equal(f.api.taskAdmissionQueueStatus({groupId}).status,'accepted');assert.equal(f.jobs.size,0);assert.equal(f.events.find(e=>e[0]==='wake')[2],'dispatching','write dispatching before requesting model I/O');
 assert.equal(f.enqueue().duplicate,true);assert.equal(f.counts().charged,1);assert.equal(f.jobs.size,0);
});
test('definite non-admission retries the same paid task group without charging or faking a QQ receipt again',async()=>{
 const f=fixture();f.enqueue();f.allowed(true);f.claimAllowed(true);f.dispatch({accepted:false,notAdmitted:true,reason:'busy'});await f.run();assert.equal(f.api.taskAdmissionQueueStatus({groupId}).status,'creditClaimed');assert.equal(f.counts().charged,1);f.dispatch({accepted:true});await f.run();assert.equal(f.counts().charged,1);assert.equal(f.counts().wakes,2);assert.equal(f.api.taskAdmissionQueueStatus({groupId}).status,'accepted');assert.equal(f.state().sendLedger,undefined,'admission never fabricates a physical QQ receipt');
});
test('unknown model admission is durable and never automatically replays the task',async()=>{
 const f=fixture();f.enqueue();f.allowed(true);f.claimAllowed(true);f.dispatch(new Error('connection closed after submit'));await f.run();assert.equal(f.api.taskAdmissionQueueStatus({groupId}).status,'unknown');assert.equal(f.jobs.size,0);const reopened=fixture(f.state());await reopened.plugin.hooks.onTick();assert.equal(reopened.jobs.size,0);assert.equal(reopened.counts().wakes,0);
});
test('restarting a persisted dispatch-in-progress marks it unknown instead of replaying it',async()=>{
 const f=fixture({taskAdmissionQueue:{[groupId]:{key,groupId,sourceSeqs:[7],wakeReason:'atMention',status:'dispatching',createdAt:100,nextAt:100}}});await f.plugin.hooks.onTick();assert.equal(f.api.taskAdmissionQueueStatus({groupId}).status,'unknown');assert.equal(f.jobs.size,0);
});
test('changing an existing group source binding cannot mint another admission',()=>{
 const f=fixture();f.enqueue();assert.equal(f.api.queueTaskAdmission({key,groupId,sourceSeqs:[9],wakeReason:'atMention'}).ok,false);assert.deepEqual(f.api.taskAdmissionQueueStatus({groupId}).sourceSeqs,[7,8]);assert.equal(f.api.queueTaskAdmission({key,groupId:'unawakened',sourceSeqs:[10],wakeReason:'timeBubble'}).ok,false);
});

test('queued complete messages survive source eviction and caller mutation and are passed to retry with original wake identity',async()=>{
 const f=fixture(),messages=[{seq:9,text:'执行长任务',plain:'执行长任务',bodyComplete:true,media:[{file:'local-ref'}]}];
 assert.equal(f.api.queueTaskAdmission({key,groupId,sourceSeqs:[9],messages,originActionId:'original-model-turn',wakeReason:'atMention',now:1_000_000}).ok,true);messages[0].text='rewritten';messages[0].media[0].file='rewritten';const read=f.api.taskAdmissionQueueStatus({groupId});assert.equal(read.messages[0].text,'执行长任务');assert.equal(read.messages[0].media[0].file,'local-ref');read.messages[0].plain='rewritten';
 f.allowed(true);f.claimAllowed(true);await f.run();const request=f.events.find(e=>e[0]==='wake')[1];assert.equal(request.messages[0].plain,'执行长任务');assert.equal(request.originActionId,'original-model-turn');assert.deepEqual(request.sourceSeqs,[9]);
});
test('task queue rejects clipped or mismatched message snapshots instead of inventing complete task provenance',()=>{
 const f=fixture();for(const messages of [[{seq:9,text:'fragment',truncated:true}],[{seq:9,text:'fragment',bodyComplete:false}],[{seq:10,text:'wrong source',bodyComplete:true}]])assert.equal(f.api.queueTaskAdmission({key,groupId,sourceSeqs:[9],messages,originActionId:'original-wake',wakeReason:'atMention'}).ok,false);assert.equal(f.jobs.size,0);
});

test('known non-admission survives restart and reuses the persisted group credit',async()=>{
 const first=fixture();first.enqueue();first.allowed(true);first.claimAllowed(true);first.dispatch({notAdmitted:true,reason:'busy'});await first.run();const reopened=fixture(first.state());reopened.allowed(true);reopened.claimAllowed(true);await reopened.run();assert.equal(reopened.counts().claims,0);assert.equal(reopened.counts().wakes,1);assert.equal(reopened.api.taskAdmissionQueueStatus({groupId}).status,'accepted');
});
test('a no-longer-pending source cancels its queue without claiming or executing it',async()=>{
 const f=fixture();f.enqueue();const saved=f.state(),jobs=new Map();const plugin=createPlugin({config:{},state:{get:()=>saved,set:p=>Object.assign(saved,p)},scheduler:{schedule:s=>{jobs.set(s.id,s);return {scheduledId:s.id};},cancel:id=>jobs.delete(id)},capabilities:{taskAdmissionStatus:()=>({allowed:false,terminal:true,reason:'already_processed'}),requestTaskAdmissionWake:()=>{throw Error('must not execute');}},callService:()=>{throw Error('must not claim');}});const job=[...jobs.values()][0];jobs.clear();await job.run({now:Date.now()});assert.equal(plugin.services.taskAdmission.get({groupId}).status,'cancelled');assert.equal(jobs.size,0);
});

test('initial model dispatch journals its outcome and never leaves a parallel retry job or replays an unknown outcome',()=>{
 const f=fixture(),spec={key,groupId,sourceSeqs:[7],messages:[{seq:7,text:'执行任务',bodyComplete:true}],originActionId:'original-wake',wakeReason:'atMention',now:1_000_000};assert.equal(typeof f.plugin.services.taskAdmission.beginDispatch,'function');assert.equal(f.plugin.services.taskAdmission.beginDispatch(spec).ok,true);assert.equal(f.jobs.size,0);assert.equal(f.api.taskAdmissionQueueStatus({groupId}).status,'dispatching');f.plugin.services.taskAdmission.finishDispatch({groupId,outcome:'unknown',now:1_000_001});assert.equal(f.api.taskAdmissionQueueStatus({groupId}).status,'unknown');assert.equal(f.plugin.services.taskAdmission.beginDispatch(spec).ok,false);assert.equal(f.jobs.size,0);
});

test('an active model accepting a previously deferred group cancels its retry and prevents a second model dispatch',async()=>{
 const f=fixture();f.enqueue();assert.equal(typeof f.plugin.services.taskAdmission.acceptActive,'function');assert.equal(f.plugin.services.taskAdmission.acceptActive({key,groupId,now:1_000_002}).ok,true);assert.equal(f.api.taskAdmissionQueueStatus({groupId}).status,'accepted');assert.equal(f.jobs.size,0);f.allowed(true);f.claimAllowed(true);await f.plugin.hooks.onTick();assert.equal(f.jobs.size,0);assert.equal(f.counts().wakes,0);
});
