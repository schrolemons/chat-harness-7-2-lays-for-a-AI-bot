import test from 'node:test';
import assert from 'node:assert/strict';
import {createProactive} from '../plugins/qq-components/life-wake-reasons/proactive.mjs';
import {createPlugin} from '../plugins/qq-components/life-wake-reasons/index.js';
import {createPlugin as profilePlugin} from '../plugins/qq-components/ctx-memory-profile-store/index.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {createPlugin as bubblePlugin} from '../plugins/qq-components/life-proactive-time-bubble/index.js';
import {PROFILE_EXTRACTION_POLICY} from '../plugins/qq-components/ctx-memory-profile-facts/extraction-policy.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const at=s=>Date.parse('2026-'+s+'+08:00'),key='private:123';
const sleepAt=at('10-31T21:51:00'),wakeAt=at('11-01T08:30:00');
const routine={wake:[{start:{hour:8,minute:30},text:'每天08:30起床',exact:'固定'}],sleep:[],work:[]};
function fixture({routines=routine,config={},saved={}}={}){
 let state=structuredClone(saved),quiet=false,requests=0;const calls=[],jobs=new Map();
 const ctx={config:{curfewEnabled:false,...config},state:{get:()=>state,set:p=>state={...state,...p}},
 scheduler:{schedule:j=>jobs.set(j.id,j),cancel:id=>jobs.delete(id)},
 capabilities:{getProactiveFacts:()=>({allowed:true,budgetAllowed:true,busy:false,quiet,mood:{score:60}}),requestProactiveWake:()=>{requests++;return true;}},
 callService:(s,m,p)=>{calls.push({s,m,p});if(s==='profileStore'&&m==='availabilityRoutine')return routines;if(s==='availability'&&m==='getPlan')return {ok:true,plan:null,quietNow:quiet};}};
 const service=createProactive(ctx);return {service,ctx,jobs,calls,state:()=>state,quiet:v=>quiet=v,requests:()=>requests};
}
test('confirmed personal wake time retires only the preceding sleep assessment',()=>{
 const f=fixture();f.service.setWillingness({key,value:20,reason:'管理员说准备睡觉，先休息',now:sleepAt});
 assert.equal(f.service.availability({key,now:wakeAt-1}).willingness,20);
 const before=structuredClone(f.state()),v=f.service.availability({key,now:wakeAt});
 assert.equal(v.willingness,60);assert.equal(v.source,'sleep-expired');assert.equal(v.lastAI.value,20);
 assert.deepEqual(f.state(),before,'reading effective availability does not mutate history');
});
test('missing, approximate or conflicting wake evidence does not invent an awake hour',()=>{
 for(const routines of [{wake:[],work:[]},{wake:[{...routine.wake[0],exact:'大致'}],work:[]},{wake:[...routine.wake,{start:{hour:10,minute:0},text:'10点起床'}],work:[]}]){
 const f=fixture({routines});f.service.setWillingness({key,value:20,reason:'准备睡觉',now:sleepAt});
 const v=f.service.availability({key,now:at('11-01T12:00:00')});assert.equal(v.willingness,20);assert.equal(v.review?.required,true);
 }
});
test('new busy evidence and active quiet plans are never overwritten by a routine',()=>{
 const f=fixture();f.service.setWillingness({key,value:20,reason:'准备睡觉',now:sleepAt});
 f.quiet(true);assert.equal(f.service.availability({key,now:wakeAt}).willingness,20);f.quiet(false);
 f.service.setWillingness({key,value:10,reason:'今天开会，暂时没空',now:wakeAt-60000});
 assert.equal(f.service.availability({key,now:wakeAt}).willingness,10);
});
test('explicit user end time overrides ordinary wake schedule, validated at service boundary',()=>{
 const f=fixture();const assessment={kind:'sleep',untilISO:'2026-11-01T11:00:00+08:00'};
 assert.equal(f.service.setWillingness({key,value:20,reason:'今天睡到11点',assessment,now:sleepAt}).ok,true);
 assert.equal(f.service.availability({key,now:wakeAt}).willingness,20);
 assert.equal(f.service.availability({key,now:at('11-01T11:00:00')}).willingness,60);
 assert.equal(f.service.setWillingness({key,value:20,reason:'睡觉',assessment:{kind:'sleep',untilISO:'tomorrow'},now:sleepAt}).ok,false);
});
test('recovery uses configured neutral baseline, preserves silence stage and existing random draw',()=>{
 const f=fixture({config:{initialWillingness:55,checkMinMinutes:60,checkMaxMinutes:120,maxSilenceMinutes:1000}});
 f.service.setWillingness({key,value:20,reason:'准备睡觉',now:sleepAt});
 f.service.observe({key,kind:'incoming',at:sleepAt,hasText:true,eventId:'actual'});
 f.service.refresh({key,now:wakeAt-60000,random:()=>.4});const old=f.state().proactiveByKey[key];
 f.service.refresh({key,now:wakeAt,random:()=>{throw Error('must not reroll');}});
 const s=f.state().proactiveByKey[key];assert.equal(s.willingness,55);assert.equal(s.stage,old.stage);
 assert.equal(s.startAt,old.startAt);assert.equal(s.lastActivityAt,old.lastActivityAt);assert.equal(s.jitter,old.jitter);
 assert.ok(s.nextAt<=old.nextAt);assert.equal(f.requests(),0);
 const reloaded=fixture({config:{initialWillingness:55},saved:f.state()});assert.equal(reloaded.service.availability({key,now:wakeAt+60000}).willingness,55);
});
test('group assessment never reads private routine, and ordinary non-sleep low scores stay intact',()=>{
 const f=fixture();f.service.setWillingness({key:'group:456',value:20,reason:'准备睡觉',now:sleepAt});
 assert.equal(f.service.availability({key:'group:456',now:wakeAt}).willingness,20);
 assert.equal(f.calls.some(c=>c.s==='profileStore'),false);
 f.service.setWillingness({key,value:15,reason:'最近忙论文',now:sleepAt});assert.equal(f.service.availability({key,now:wakeAt}).willingness,15);
});
test('confirmed working interval blocks automatic neutral recovery',()=>{
 const f=fixture({routines:{...routine,work:[{start:{hour:8,minute:0},end:{hour:12,minute:0},exact:'固定',text:'每天8-12工作'}]}});
 f.service.setWillingness({key,value:20,reason:'准备睡觉',now:sleepAt});
 assert.equal(f.service.availability({key,now:wakeAt}).willingness,20);
 assert.equal(f.service.availability({key,now:at('11-01T12:00:00')}).willingness,60);
});
test('actual prompt requests review when old sleep has no confirmed end; no independent model call',()=>{
 const f=fixture({routines:{wake:[],work:[]}});f.service.setWillingness({key,value:20,reason:'准备睡觉',now:sleepAt});
 const p=createPlugin(f.ctx);assert.equal(typeof p.hooks.beforePrompt,'function');
 const text=p.hooks.beforePrompt({key,now:wakeAt});assert.match(text,/复核/);assert.match(text,/不能|不要/);assert.equal(f.requests(),0);
});
test('expiry never lowers an existing high score or expires a later non-sleep assessment',()=>{
 const f=fixture();f.service.setWillingness({key,value:80,reason:'稍微睡一下',assessment:{kind:'sleep'},now:sleepAt});
 assert.equal(f.service.availability({key,now:wakeAt}).willingness,80);
 f.service.setWillingness({key,value:20,reason:'醒了但还是很累',assessment:{kind:'other'},now:wakeAt});
 assert.equal(f.service.availability({key,now:wakeAt+60000}).willingness,20);
});
test('real profile service reads personal evidence without creating files or sharing it with groups',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-sleep-profile-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'state'));const file=path.join(root,'state/person-profiles.json');
 fs.writeFileSync(file,JSON.stringify({profiles:{123:{routine_food:'每天08:30起床；每天23:00睡觉；每天09:00-12:00工作'}},people:{}}));
 const before=fs.readFileSync(file,'utf8');const plugin=profilePlugin({root,config:{},state:{get:()=>({})},registerTool(){},warn(){}});
 const svc=plugin.services.profileStore;assert.equal(svc.availabilityRoutine({key}).wake[0].start.hour,8);
 assert.equal(svc.availabilityRoutine({key:'group:123'}),null);assert.deepEqual(svc.availabilityRoutine({key:'private:999'}).wake,[]);
 assert.equal(fs.readFileSync(file,'utf8'),before);
});
test('real authenticated wake-config API validates and stores structured sleep evidence',async t=>{
 const h=await bridgeHarness();h.setMode('reserved2');const st=h.getSocialV2State(key);
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await h.close();});
 const post=async assessment=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/wake-config',{
 method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-call':'1','x-agent-token':st.agentToken},
 body:JSON.stringify({key,chatWillingness:20,reason:'明确说睡到明早',availabilityAssessment:assessment})});return {status:r.status,body:await r.json()};};
 const assessment={kind:'sleep',untilISO:new Date(Date.now()+8*3600000).toISOString()};
 assert.equal((await post(assessment)).body.ok,true);
 assert.deepEqual(h.pluginHost.callService('proactive','availability',{key}).lastAI.assessment,assessment);
 assert.equal((await post({kind:'sleep',untilISO:'tomorrow'})).status,400);
 assert.deepEqual(h.pluginHost.callService('proactive','availability',{key}).lastAI.assessment,assessment,'invalid update cannot erase evidence');
});
test('bubble and extraction prompts model observed activity without promoting it to confirmed sleep facts',()=>{
 const p=bubblePlugin({config:{},runtime:{},state:{get:()=>({})},registerTool(){}});
 const text=p.hooks.beforePrompt({key,isPrivate:true,hasUnreadNow:true,reason:'private'});
 for(const policy of [text,PROFILE_EXTRACTION_POLICY]){
   assert.match(policy,/chat_activity_pattern/);assert.match(policy,/多天/);
   assert.match(policy,/主动来信/);assert.match(policy,/测试/);assert.match(policy,/起床|睡眠/);
 }
});
test('weekday-specific routines, wake ranges and night-shift hours use Shanghai dates',()=>{
 const f=fixture({routines:{wake:[{start:{hour:7,minute:0},text:'工作日7点起床'},{start:{hour:10,minute:0},end:{hour:11,minute:0},text:'周末10-11点起床'}],work:[]}});
 f.service.setWillingness({key,value:20,reason:'准备睡觉',now:sleepAt});
 assert.equal(f.service.availability({key,now:at('11-01T10:30:00')}).willingness,20);
 assert.equal(f.service.availability({key,now:at('11-01T11:00:00')}).willingness,60);
 const shift=fixture({routines:{wake:[{start:{hour:18,minute:0},text:'每天18点起床'}],work:[]}});
 shift.service.setWillingness({key,value:20,reason:'夜班后去睡',assessment:{kind:'sleep'},now:at('11-01T09:00:00')});
 assert.equal(shift.service.availability({key,now:at('11-01T12:00:00')}).willingness,20);
 assert.equal(shift.service.availability({key,now:at('11-01T18:00:00')}).willingness,60);
});
