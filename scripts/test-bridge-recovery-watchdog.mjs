import test from 'node:test';
import assert from 'node:assert/strict';
import * as launcher from './start-da-feiyu.mjs';
import {normalizeBridgeRecovery} from './bridge-recovery-policy.mjs';

const epoch=Date.parse('2026-11-02T08:00:00+08:00');
const good=()=>({reachable:true,ok:true,status:200,data:{mode:'reserved2',dshReady:true,socialV2Paused:false,
 snowluma:{connected:true,accountOnline:true,good:true,lastPacketAgoMs:1000,silent:false}}});
const bad=()=>{const p=good();p.data.snowluma.good=false;return p;};
function make(options={}){
 assert.equal(typeof launcher.createBridgeRecovery,'function','launcher exposes the real transport recovery policy');
 let saved;
 const policy=launcher.createBridgeRecovery({...options,save:value=>{saved=structuredClone(value);}});
 return {policy,get saved(){return saved;},poll:(ms,probe=bad())=>policy.observe({now:epoch+ms,probe})};
}

test('invalid configuration fails closed and null state cannot crash policy construction',()=>{
 for(const config of [null,false,'false',[],{enabled:'false'}])assert.equal(normalizeBridgeRecovery(config).enabled,false);
 assert.equal(normalizeBridgeRecovery().enabled,true);
 assert.equal(make({state:null}).poll(0).action,'none');
});

test('deliberate pause survives console loss and guardian recreation until an authoritative resume',()=>{
 for(const data of [{socialV2Paused:true},{mode:'closed-agent'}]){
  const h=make();h.poll(0,{...good(),data:{...good().data,...data}});
  const next=make({state:h.saved});
  for(let ms=10000;ms<=200000;ms+=10000)assert.equal(next.poll(ms,{reachable:false,status:0}).action,'none');
  assert.equal(next.saved.attempts.length,0);
  next.poll(210000,good());next.poll(220000);
  for(let ms=230000;ms<310000;ms+=10000)assert.equal(next.poll(ms).action,'none');
  assert.equal(next.poll(310000).action,'restart');
 }
});

test('restart effects cannot affect a replacement child after asynchronous discovery or requests',async()=>{
 let current=false,requests=0,kills=0;
 const child={exitCode:null,signalCode:null,kill(){kills++;}};
 const opts={child,isCurrent:()=>current,sleep:async()=>{},requestGraceful:async()=>{requests++;current=false;return false;}};
 assert.equal(await launcher.restartBridgeChild(opts),false);assert.equal(requests,0);
 current=true;await launcher.restartBridgeChild(opts);assert.equal(requests,1);assert.equal(kills,0);
});

test('quiet but healthy bridge never restarts; healthy DSH alone does not mask a broken QQ transport',()=>{
 const h=make();assert.equal(h.poll(0,good()).action,'none');
 for(let ms=10000;ms<=120000;ms+=10000)assert.equal(h.poll(ms,good()).action,'none');
 assert.equal(h.poll(130000).action,'none');
 for(let ms=140000;ms<220000;ms+=10000)assert.equal(h.poll(ms).action,'none');
 assert.equal(h.poll(220000).action,'restart');
});

test('persistent failure restarts at 90 seconds once and reserves its budget before side effects',()=>{
 const h=make();assert.equal(h.poll(0).action,'none');
 for(let ms=10000;ms<90000;ms+=10000)assert.equal(h.poll(ms).action,'none');
 const action=h.poll(90000);assert.equal(action.action,'restart');assert.equal(action.target,'bridge');
 assert.equal(h.saved.attempts.length,1);assert.equal(h.poll(90001).action,'none');
});

test('sleep gap resets the recovery deadline instead of counting hours asleep as failed recovery',()=>{
 const h=make();h.poll(0);h.poll(10000);
 const resume=2*3600000;assert.equal(h.poll(resume).action,'none');
 assert.equal(h.saved.failureSince,epoch+resume);
 for(let ms=resume+10000;ms<resume+90000;ms+=10000)assert.equal(h.poll(ms).action,'none');
 assert.equal(h.poll(resume+90000).action,'restart');
});

test('at most two restarts per ten minutes and the budget survives guardian recreation',()=>{
 const h=make();h.poll(0);
 for(let ms=10000;ms<=90000;ms+=10000)h.poll(ms);
 for(let ms=100000;ms<190000;ms+=10000)assert.equal(h.poll(ms).action,'none');
 assert.equal(h.poll(190000).action,'restart');
 const fresh=make({state:h.saved});fresh.poll(200000);
 for(let ms=210000;ms<290000;ms+=10000)assert.equal(fresh.poll(ms).action,'none');
 assert.equal(fresh.poll(290000).action,'blocked');assert.equal(fresh.saved.attempts.length,2);
 assert.equal(fresh.poll(300000).action,'none','budget warning does not repeat every poll');
});

test('authentication failure, insufficient evidence and deliberate pause do not cause restart loops',()=>{
 for(const probe of [{reachable:true,ok:false,status:401},{reachable:true,ok:false,status:403},
  {reachable:true,ok:true,status:200,data:{}},
  {...bad(),data:{...bad().data,socialV2Paused:true}},
  {...bad(),data:{...bad().data,mode:'closed-agent'}}]){
  const h=make();for(let ms=0;ms<200000;ms+=10000)assert.equal(h.poll(ms,probe).action,'none');
  assert.equal(h.saved.attempts.length,0);
 }
});

test('unresponsive local console can recover without requiring an answered HTTP request',()=>{
 const h=make();const probe={reachable:false,ok:false,status:0};
 h.poll(0,probe);for(let ms=10000;ms<90000;ms+=10000)h.poll(ms,probe);
 assert.equal(h.poll(90000,probe).action,'restart');
});

test('clock correction and disabled recovery cannot fabricate an overdue restart',()=>{
 const h=make();h.poll(20000);h.poll(30000);assert.equal(h.poll(10000).action,'none');
 assert.equal(h.saved.failureSince,epoch+10000);
 const off=make({enabled:false});for(let ms=0;ms<=200000;ms+=10000)assert.equal(off.poll(ms).action,'none');
 assert.equal(off.saved.attempts.length,0);
});

test('a shorter sleep also resets the deadline of an already failing connection',()=>{
 const h=make();h.poll(0);h.poll(10000);assert.equal(h.poll(50000).action,'none');
 assert.equal(h.saved.failureSince,epoch+50000);
});

test('bridge child restart prefers a persisted graceful exit and falls back only on that child',async()=>{
 assert.equal(typeof launcher.restartBridgeChild,'function');let now=0,kills=0,requests=0;
 const child={exitCode:null,signalCode:null,kill(){kills++;this.exitCode=1;}};
 await launcher.restartBridgeChild({child,now:()=>now,sleep:async ms=>{now+=ms;if(now===200)child.exitCode=0;},requestGraceful:async()=>{requests++;return true;}});
 assert.equal(requests,1);assert.equal(kills,0);
 child.exitCode=null;now=0;
 await launcher.restartBridgeChild({child,now:()=>now,sleep:async ms=>{now+=ms;},requestGraceful:async()=>true,timeoutMs:500});
 assert.equal(kills,1);assert.equal(now,500);
});

test('restart cannot kill a finished child or spin while the console is unresponsive',async()=>{
 let kills=0,requests=0;const child={exitCode:0,signalCode:null,kill(){kills++;}};
 const options={child,sleep:async()=>{},requestGraceful:async()=>{requests++;throw Error('not responding');}};
 assert.equal(await launcher.restartBridgeChild(options),false);assert.equal(requests,0);
 child.exitCode=null;assert.equal(await launcher.restartBridgeChild(options),true);
 assert.equal(kills,1);assert.equal(requests,1);
});
