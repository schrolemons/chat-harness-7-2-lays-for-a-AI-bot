import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createPlugin as createScheduler} from '../plugins/qq-components/life-scheduler/index.js';
import {createPlugin as createBubble} from '../plugins/qq-components/life-proactive-time-bubble/index.js';
import {createProactive} from '../plugins/qq-components/life-wake-reasons/proactive.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {createPlugin as createAvailability} from '../plugins/qq-components/life-user-availability/index.js';

const start=Date.parse('2026-11-02T07:59:00+08:00');
function clock(){
 let ready=true;
 const runtime={},refreshed=[],greetings=[];
 const ctx={runtime,config:{},isActive:()=>true,isPluginEnabled:()=>true,
  capabilities:{getTransportReadiness:()=>({ready}),listConversationKeys:()=>['private:123'],
   refreshTimeBubble:({key})=>refreshed.push(key),refreshStartupGreeting:({key})=>greetings.push(key)}};
 const p=createScheduler(ctx);
 return {p,s:p.services.scheduler,runtime,ctx,refreshed,greetings,setReady:v=>{ready=v;}};
}

test('resume waits for healthy transport before dispatching overdue proactive work',async()=>{
 const h=clock();let runs=0;
 await h.p.hooks.onTick({now:start});
 h.s.schedule({id:'proactive:private:123',type:'proactive',requiresTransport:true,at:start+60000,run:()=>runs++});
 h.setReady(false);
 const resumed=start+2*3600000;
 await h.p.hooks.onTick({now:resumed});
 assert.equal(runs,0,'offline wake must stay queued');
 assert.equal(h.s.status().pending,1);
 h.setReady(true);
 await h.p.hooks.onTick({now:resumed+1000});
 assert.equal(runs,0,'a fresh healthy observation is not yet stable');
 await h.p.hooks.onTick({now:resumed+16000});
 assert.equal(runs,0,'recovery grace must not dispatch prematurely');
 await h.p.hooks.onTick({now:resumed+31000});
 assert.equal(runs,1);
 await h.p.hooks.onTick({now:resumed+32000});
 assert.equal(runs,1,'no duplicate dispatch');
 assert.deepEqual(h.greetings,['private:123'],'one greeting opportunity per resume');
});

test('reload repairs future bubbles without manufacturing a resume greeting',async()=>{
 const h=clock();await h.p.hooks.onTick({now:start});
 await h.p.hooks.onTick({now:start+30000});
 assert.deepEqual(h.refreshed,['private:123']);assert.deepEqual(h.greetings,[]);
 const fresh=createScheduler(h.ctx);
 await fresh.hooks.onTick({now:start+31000});
 assert.deepEqual(h.refreshed,['private:123','private:123']);assert.deepEqual(h.greetings,[]);
});

test('expired bubble is skipped and its next occurrence is rearmed through the real component',async()=>{
 let refreshed=0,dispatched=0;
 const bubble=createBubble({config:{},runtime:{},registerTool(){},state:{get:()=>({}),set(){}},
  capabilities:{refreshTimeBubble:({key})=>{assert.equal(key,'private:123');refreshed++;}}});
 const p=createScheduler({runtime:{},config:{}}),st={},key='private:123';
 const source=fs.readFileSync(new URL('../src/bridge.js',import.meta.url),'utf8');
 const begin=source.indexOf('  function scheduleForcedTask(key,field,run,delay) {');
 const end=source.indexOf('\n  taskCaps.readBiliSharePlan',begin);
 const c={Date:{now:()=>start},Number,Math,Infinity,forcedOwners:{timeBubbleTimer:'life-proactive-time-bubble'},
  socialV2:{conversations:new Map([[key,st]])},pluginHost:{callService:(name,method,payload)=>{
   if(name==='scheduler')return p.services.scheduler[method](payload);
   return bubble.services?.[name]?.[method]?.(payload);
  }}};
 vm.createContext(c);vm.runInContext(source.slice(begin,end),c);
 st.timeBubbleTimer=c.scheduleForcedTask(key,'timeBubbleTimer',()=>dispatched++,60000);
 await p.hooks.onTick({now:start+2*3600000});
 assert.equal(dispatched,0);assert.equal(st.timeBubbleTimer,null);
 assert.equal(refreshed,1,'expiry must continue the bubble schedule without replaying the missed slot');
});

test('expiry and maintenance still run while transport is offline',async()=>{
 const h=clock();let expired=0,maintained=0,sent=0;h.setReady(false);
 h.s.schedule({id:'old',at:start,expiresAt:start+1000,requiresTransport:true,run:()=>sent++,onExpire:()=>expired++});
 h.s.schedule({id:'health',at:start,run:()=>maintained++});
 await h.p.hooks.onTick({now:start+2000});
 assert.equal(expired,1);assert.equal(maintained,1);assert.equal(sent,0);
});

test('transport block does not consume a proactive opportunity or restart its waiting interval',async()=>{
 let state={proactiveByKey:{'private:123':{phase:'scheduled',stage:0,nextAt:start,availabilityVersion:1,willingness:60}}};
 const jobs=new Map();let wakes=0;
 const facts={allowed:true,transportReady:false,budgetAllowed:true,rateAllowed:true};
 const p=createProactive({config:{curfewEnabled:false},state:{get:()=>state,set:patch=>state={...state,...patch}},
  scheduler:{schedule:j=>jobs.set(j.id,j),cancel:id=>jobs.delete(id)},
  capabilities:{getProactiveFacts:()=>facts,requestProactiveWake:()=>{wakes++;return true;}}});
 const result=p.refresh({key:'private:123',now:start,random:()=>0});
 assert.equal(result.reason,'transport');assert.equal(jobs.size,0);assert.equal(wakes,0);
 assert.equal(state.proactiveByKey['private:123'].nextAt,start);
 facts.transportReady=true;p.refresh({key:'private:123',now:start+30000,random:()=>0});
 await jobs.get('proactive:private:123').run({now:start+30000});
 assert.equal(wakes,1);
});

test('host readiness requires fresh QQ packets and fresh DSH probe, not cached connection flags',()=>{
 const source=fs.readFileSync(new URL('../src/bridge.js',import.meta.url),'utf8');
 const begin=source.indexOf('  taskCaps.getTransportReadiness =');
 assert.ok(begin>0,'host exposes transport facts for the scheduler');
 const end=source.indexOf('  taskCaps.getProactiveFacts=',begin);
 const c={taskCaps:{},Date:{now:()=>start},dshReady:true,lastDshReadyAt:start,
  snowlumaHealthSnapshot:()=>({connected:true,accountOnline:true,good:true,lastPacketAgoMs:0})};
 vm.createContext(c);vm.runInContext(source.slice(begin,end),c);
 assert.equal(c.taskCaps.getTransportReadiness().ready,true);
 c.snowlumaHealthSnapshot=()=>({connected:true,accountOnline:true,good:true,lastPacketAgoMs:7200000});
 assert.equal(c.taskCaps.getTransportReadiness().ready,false);
 c.snowlumaHealthSnapshot=()=>({connected:true,accountOnline:true,good:true,lastPacketAgoMs:0});
 c.lastDshReadyAt=start-7200000;assert.equal(c.taskCaps.getTransportReadiness().ready,false);
});

test('a small backwards clock correction does not invent a sleep-resume greeting',async()=>{
 const h=clock();await h.p.hooks.onTick({now:start});await h.p.hooks.onTick({now:start+30000});
 await h.p.hooks.onTick({now:start+29000});await h.p.hooks.onTick({now:start+59000});
 assert.deepEqual(h.greetings,[]);
});

test('real host expires missed morning bubble and retains a future noon timer while offline',async()=>{
 let now=start;
 class FixtureDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const h=await bridgeHarness({globals:{Date:FixtureDate},files:{'state/time-bubbles.json':{'private:123':[
  {id:'morning',hour:8,minute:0,label:'morning',enabled:true},
  {id:'noon',hour:12,minute:10,label:'noon',enabled:true}]}}});
 try{
  h.setMode('reserved2');h.taskCaps.getTransportReadiness=()=>({ready:false});
  const st=h.getSocialV2State('private:123');h.taskCaps.refreshTimeBubble({key:'private:123'});
  const before=st.timeBubbleTimer;assert.ok(before);
  now=Date.parse('2026-11-02T10:13:00+08:00');await h.pluginHost.tick(now);
  assert.ok(st.timeBubbleTimer,'the real continuation creates a future timer');
  assert.ok(st.timeBubbleTimer.generation>before.generation);
  assert.equal(st.pendingTimeBubble??null,null,'missed morning slot is not replayed');
  assert.equal(h.calls.sent.length,0);
 }finally{await h.close();}
});

test('real reminder and scheduled-conversation capabilities refuse offline dispatch before side effects',async()=>{
 const h=await bridgeHarness();
 try{
  h.setMode('reserved2');h.taskCaps.getTransportReadiness=()=>({ready:false});
  h.pluginHost.callService('scheduler','transportReady');
  const key='private:123',st=h.getSocialV2State(key);
  assert.equal(h.taskCaps.requestReminderWake(key,[{id:'fixture',text:'reminder',dueAt:Date.now()}]),false);
  assert.equal(st.pendingReminderItems?.length||0,0);
  assert.equal(h.taskCaps.scheduledContactReady({key}),false);
  const result=await h.taskCaps.requestScheduledConversation(key,{id:'event',key,reason:'milkStock',plugin:'tool-deepseek-balance',expiresAt:Date.now()+60000});
  assert.equal(result.ok,false);assert.equal(result.reason,'transport');
  assert.equal(h.calls.prompts.length,0);assert.equal(h.calls.sent.length,0);
 }finally{await h.close();}
});

test('catchup bubble stays queued instead of invoking DSH while offline',async()=>{
 const now=Date.parse('2026-11-02T08:05:00+08:00');
 class FixtureDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const h=await bridgeHarness({globals:{Date:FixtureDate},files:{'state/time-bubbles.json':{'private:123':[
  {id:'morning',hour:8,minute:0,label:'morning',enabled:true}]}}});
 try{
  h.setMode('reserved2');h.taskCaps.getTransportReadiness=()=>({ready:false});
  h.pluginHost.setEnabled('ctx-memory-store',false);
  h.getSocialV2State('private:123');h.taskCaps.refreshTimeBubble({key:'private:123'});
  await h.pluginHost.tick(now);await new Promise(r=>setImmediate(r));
  assert.equal(h.calls.prompts.length,0,'catchup must obey the transport gate');
  assert.ok(h.pluginHost.callService('scheduler','status').types.includes('time-bubble-catchup'));
 }finally{await h.close();}
});

test('a later-contact plan remains pending offline and dispatches once after stable recovery',async()=>{
 const h=clock();let state={},contacts=0;
 const p=createAvailability({config:{},state:{get:()=>state,set:patch=>state={...state,...patch}},scheduler:h.s,
  capabilities:{scheduledContactReady:()=>true,requestScheduledContact:async()=>contacts++}});
 p.services.availability.setPlan({key:'private:123',kind:'later',now:start,contactISO:new Date(start+60000).toISOString()});
 h.setReady(false);await h.p.hooks.onTick({now:start+60000});
 assert.equal(contacts,0);assert.equal(state.plans['private:123'].finished,undefined);
 h.setReady(true);await h.p.hooks.onTick({now:start+61000});await h.p.hooks.onTick({now:start+91000});
 assert.equal(contacts,1);assert.equal(state.plans['private:123'].finished,'triggered');
});

test('offline notifications do not claim an uncertain delivery receipt before transport exists',async()=>{
 const h=await bridgeHarness();
 try{
  h.setMode('reserved2');h.taskCaps.getTransportReadiness=()=>({ready:false});
  h.pluginHost.callService('scheduler','transportReady');
  const meta={id:'offline-notice',sourceAt:Date.now(),expiresAt:Date.now()+60000};
  const result=await h.taskCaps.sendNotificationDetailed('private:123','fixture',meta);
  assert.equal(result.reason,'transport');assert.equal(h.calls.sent.length,0);
  assert.equal(h.taskCaps.deliveryStatus(meta.id).status,'absent');
 }finally{await h.close();}
});
