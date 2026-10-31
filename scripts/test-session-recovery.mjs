import test from 'node:test';
import assert from 'node:assert/strict';
import {observeRecovery,recoveryDecision} from '../plugins/qq-components/obs-session-recovery/policy.mjs';
import {createPlugin} from '../plugins/qq-components/obs-session-recovery/index.js';
const KEY='group:11006',BASE=10_000_000;
const good=()=>({sessionId:'old',allowed:true,pendingCount:2,budgetStage:'normal',busy:false,quiet:false,muted:false,paused:false,transportReady:true});
function failed(record={},turn=1,now=BASE,extra={}){
 record=observeRecovery(record,{key:KEY,sessionId:'old',seq:turn*10,type:'turn/start',turn,chatTurn:true,now});
 return observeRecovery(record,{key:KEY,sessionId:'old',seq:turn*10+1,type:'turn/end',turn,chatTurn:true,now,failure:{code:'INVALID_REQUEST',status:400,message:'DeepSeek Messages request failed (400)'},...extra});
}
function candidate(){let r={};for(let t=1;t<=3;t++)r=failed(r,t,BASE+(t-1)*60000);return r;}
test('require three independent failed chat turns spanning two minutes, not one request retry',()=>{
 let r=failed();assert.equal(recoveryDecision(r,good(),BASE).recover,false);
 r=observeRecovery(r,{key:KEY,sessionId:'old',seq:11,type:'turn/end',turn:1,chatTurn:true,now:BASE+120000,failure:{code:'INVALID_REQUEST',status:400}});
 assert.equal(r.failures.length,1);assert.equal(recoveryDecision(candidate(),good(),BASE+120000).recover,true);
 let fast={};for(let t=1;t<=3;t++)fast=failed(fast,t,BASE+t);assert.equal(recoveryDecision(fast,good(),BASE+120000).recover,false);
});
test('a rapid failure loop retains its first failure time even after its bounded event list fills',()=>{
 let r={};for(let turn=1;turn<=31;turn++)r=failed(r,turn,BASE+(turn-1)*5000);
 assert(r.failures.length<=10);assert.equal(recoveryDecision(r,good(),BASE+150000).recover,true);
});
test('normal model output, tool calls, deliberate silence and non-chat turns break the failure streak',()=>{
 for(const type of ['assistant/message','tool/call']){let r=failed({},1);r=observeRecovery(r,{key:KEY,sessionId:'old',seq:12,type,turn:2,chatTurn:true,progress:true,now:BASE+60000});r=failed(r,2,BASE+120000);assert.equal(recoveryDecision(r,good(),BASE+120000).recover,false);}
 assert.equal(failed(candidate(),4,BASE+180000,{failure:null}).failures.length,0);
 assert.equal(failed({},1,BASE,{chatTurn:false}).failures.length,0);
});
test('quota, rate-limit, authentication, transport and unknown errors never authorize recovery',()=>{
 for(const failure of [{code:'QUOTA_EXCEEDED',status:400},{code:'INVALID_REQUEST',status:429},{code:'INVALID_CREDENTIAL',status:401},{code:'TRANSPORT',status:500},{code:'TIMEOUT',status:408},{code:'INVALID_REQUEST',status:400,message:'insufficient balance'},{code:'INVALID_REQUEST',status:400,message:'额度不足'},{}]){
  assert.equal(failed(candidate(),4,BASE+180000,{failure}).failures.length,0);
 }
});
test('explicit context overflow mentioning token counts qualifies; invalid session tokens do not',()=>{
 let r={};for(let turn=1;turn<=3;turn++)r=failed(r,turn,BASE+(turn-1)*60000,{failure:{code:'CONTEXT_WINDOW_EXCEEDED',status:400,message:'maximum context length is 131072 tokens; requested 132000 tokens'}});
 assert.equal(recoveryDecision(r,good(),BASE+120000).recover,true);
 assert.equal(failed(candidate(),4,BASE+180000,{failure:{code:'INVALID_REQUEST',status:400,message:'invalid session token'}}).failures.length,0);
});
test('authoritative restrictions and stale or replaced sessions prevent destructive action',()=>{
 for(const patch of [{budgetStage:'weak'},{budgetStage:'silent'},{budgetStage:'unknown'},{pendingCount:0},{busy:true},{quiet:true},{muted:true},{paused:true},{allowed:false},{transportReady:false},{sessionId:'new'}])assert.equal(recoveryDecision(candidate(),{...good(),...patch},BASE+120000).recover,false,JSON.stringify(patch));
 assert.equal(recoveryDecision(candidate(),good(),BASE+20*60000).recover,false);
 assert.equal(observeRecovery(candidate(),{key:'private:123',sessionId:'old',type:'turn/end',turn:4,now:BASE+180000}).failures.length,3);
});
test('cooldown, rolling daily limit and unknown interrupted recovery survive restarts',()=>{
 const r=candidate();assert.equal(recoveryDecision({...r,attempts:[BASE]},good(),BASE+120000).recover,false);
 assert.equal(recoveryDecision({...r,attempts:[BASE-7200000,BASE-3600000]},good(),BASE+120000).recover,false);
 assert.equal(recoveryDecision({...r,blocked:true},good(),BASE+120000).recover,false);
 assert.equal(recoveryDecision({...r,recovering:true},good(),BASE+120000).recover,false);
});
function fixture(record=candidate(),options={}){
 let state={groups:{[KEY]:record}},recovered=0,alerts=0;
 const ctx={config:{},signal:new AbortController().signal,state:{get:()=>state,set:patch=>state={...state,...patch}},capabilities:{inspectGroupSessionRecovery:async()=>({...good(),...options.snapshot}),recoverGroupSession:async()=>{recovered++;return options.result??{ok:true,sessionId:'new'};},notifyOwner:async()=>{alerts++;return true;}},log:()=>{}};
 return {ctx,read:()=>state,counts:()=>({recovered,alerts})};
}
test('component persists its attempt before capability execution and single-flights overlapping ticks',async()=>{
 const f=fixture();let release;f.ctx.capabilities.recoverGroupSession=()=>{assert.equal(f.read().groups[KEY].recovering,true);return new Promise(r=>release=r);};
 const p=createPlugin(f.ctx);const a=p.hooks.onTick({now:BASE+120000});await new Promise(r=>setImmediate(r));await p.hooks.onTick({now:BASE+120000});release({ok:true,sessionId:'new'});await a;
 assert.equal(f.read().groups[KEY].sessionId,'new');assert.equal(f.read().groups[KEY].attempts.length,1);assert.equal(f.read().groups[KEY].awaitingRecovery,true);
});
test('a failed fresh session stops and alerts once; real model progress confirms recovery',async()=>{
 const f=fixture(),p=createPlugin(f.ctx);await p.hooks.onTick({now:BASE+120000});
 p.services.sessionRecovery.observe({key:KEY,sessionId:'new',seq:10,type:'turn/start',turn:1,chatTurn:true,now:BASE+180000});
 p.services.sessionRecovery.observe({key:KEY,sessionId:'new',seq:11,type:'turn/end',turn:1,chatTurn:true,now:BASE+180000,failure:{code:'INVALID_REQUEST',status:400}});
 await p.hooks.onTick({now:BASE+180001});await p.hooks.onTick({now:BASE+180002});assert.equal(f.counts().recovered,1);assert.equal(f.counts().alerts,1);assert.equal(f.read().groups[KEY].blocked,true);
 const g=fixture(),q=createPlugin(g.ctx);await q.hooks.onTick({now:BASE+120000});q.services.sessionRecovery.observe({key:KEY,sessionId:'new',seq:12,type:'assistant/message',turn:1,chatTurn:true,progress:true,now:BASE+180000});assert.equal(g.read().groups[KEY].awaitingRecovery,false);
});
test('all safety restrictions are checked before the recovery capability and failures block repetition',async()=>{
 const f=fixture(candidate(),{snapshot:{budgetStage:'silent'}});await createPlugin(f.ctx).hooks.onTick({now:BASE+120000});assert.equal(f.counts().recovered,0);
 const g=fixture(candidate(),{result:{ok:false,error:'stop failed'}}),p=createPlugin(g.ctx);await p.hooks.onTick({now:BASE+120000});await p.hooks.onTick({now:BASE+3600000});assert.equal(g.counts().recovered,1);assert.equal(g.counts().alerts,1);
});
test('configuration rejects fractions and unsafe thresholds; progress during final verification revokes recovery',async()=>{
 const now=Date.now(),record=candidate();record.failures=record.failures.map(f=>({...f,at:now-120000+f.at-BASE}));
 const f=fixture(record),p=createPlugin(f.ctx);
 assert.equal(p.validateConfig({consecutiveFailures:3,minFailureSeconds:120,cooldownMinutes:30,maxRecoveriesPerDay:2}).ok,true);
 assert.equal(p.validateConfig({consecutiveFailures:3.5,minFailureSeconds:120,cooldownMinutes:30,maxRecoveriesPerDay:2}).ok,false);
 assert.equal(p.validateConfig({consecutiveFailures:3,minFailureSeconds:120,cooldownMinutes:30,maxRecoveriesPerDay:3}).ok,false);
 f.ctx.capabilities.recoverGroupSession=async request=>{
  p.services.sessionRecovery.observe({key:KEY,sessionId:'old',type:'assistant/message',seq:32,turn:3,chatTurn:true,progress:true,now});
  assert.equal(p.services.sessionRecovery.confirm({...request,snapshot:good()}).ok,false);
  return {ok:false,skipped:true};
 };
 await p.hooks.onTick({now});assert.equal(f.read().groups[KEY].attempts.length,0);assert.equal(f.read().groups[KEY].failures.length,0);
});
test('confirmed blocking failures and recovery progress are reported to the desktop service without LLM use',async()=>{
 const notes=[],f=fixture(),p=createPlugin({...f.ctx,callService:(service,method,input)=>{notes.push({service,method,...input});return {ok:true};}});
 await p.hooks.onTick({now:BASE+120000});assert.equal(notes[0].service,'desktopNotes');assert.equal(notes[0].phase,'open');
 p.services.sessionRecovery.observe({key:KEY,sessionId:'new',seq:12,type:'assistant/message',turn:1,chatTurn:true,progress:true,now:BASE+180000});
 assert.equal(notes.at(-1).phase,'resolved');assert(notes.at(-1).summary.includes('QQ'));
});
test('a temporarily undeliverable alert remains pending and retries without repeated recovery or notification spam',async()=>{
 const f=fixture(candidate(),{result:{ok:false}}),p=createPlugin(f.ctx);let notifications=0;
 f.ctx.capabilities.notifyOwner=async()=>++notifications>1;
 await p.hooks.onTick({now:BASE+120000});assert.equal(f.read().groups[KEY].alertPending,true);
 await p.hooks.onTick({now:BASE+120001});assert.equal(notifications,1);
 await p.hooks.onTick({now:BASE+181000});assert.equal(notifications,2);assert.equal(f.read().groups[KEY].alertPending,false);assert.equal(f.counts().recovered,1);
});
