import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin,periodStart} from '../plugins/qq-components/life-token-budget/index.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';
const at=text=>Date.parse(text+'+08:00');
const fixture=config=>createPlugin({config,state:{get:()=>({}),set(){}},capabilities:{}});

test('budget keeps 22:00 by default and changes on the exact Shanghai minute',()=>{
 assert.equal(periodStart(at('2026-10-31T21:59:59')),at('2026-10-30T22:00:00'));
 assert.equal(periodStart(at('2026-10-31T22:00:00')),at('2026-10-31T22:00:00'));
 assert.equal(periodStart(at('2026-10-31T04:29:59'),'04:30'),at('2026-10-30T04:30:00'));
 assert.equal(periodStart(at('2026-10-31T04:30:00'),'04:30'),at('2026-10-31T04:30:00'));
});
test('midnight and month/year rollovers are based on Beijing time',()=>{
 assert.equal(periodStart(at('2027-01-01T00:00:00'),'00:00'),at('2027-01-01T00:00:00'));
 assert.equal(periodStart(at('2027-01-01T00:00:00'),'23:59'),at('2026-12-31T23:59:00'));
 assert.equal(periodStart(at('2026-11-01T00:01:00'),'00:30'),at('2026-10-31T00:30:00'));
});
test('session and global assessment share the configured accounting period',()=>{
 const plugin=fixture({dailyResetTime:'06:45'}),now=at('2026-10-31T06:45:00'),budget=plugin.services.tokenBudget;
 const period=budget.period({now});assert.equal(period.since,now);assert.equal(period.resetAt,now+86400000);
 for(const key of ['private:1','group:2','__global']){const assessment=budget.assess({key,now});assert.equal(assessment.periodStart,period.since);assert.equal(assessment.resetAt,period.resetAt);}
});
test('invalid clock strings are rejected while 00:00 remains a valid reset time',()=>{
 const plugin=fixture({});
 for(const value of ['24:00','22:60','4:30','04:30:00','',null,0])assert.equal(plugin.validateConfig({dailyResetTime:value}).ok,false,String(value));
 for(const value of ['00:00','04:30','23:59'])assert.equal(plugin.validateConfig({dailyResetTime:value}).ok,true,value);
});
test('console save hot reloads the real ledger window without discarding older costs',async()=>{
 const h=await bridgeHarness({config:{allow:{private:['123','124'],groups:['456']}},files:{'state/plugins/config/life-token-budget.json':{dailyResetTime:'06:30'}}});let server;
 try{
  const now=at('2026-10-31T06:45:00'),boundary=at('2026-10-31T06:30:00');
  for(const key of ['private:124','group:456']){
   const sid=await h.ensureSession(key);
   for(const [seq,time] of [[1,boundary-1],[2,boundary+1]])h.tokenLedger.ingestEvent({sessionId:sid,at:time,model:'deepseek-flash',event:{type:'assistant/message',seq,data:{turn:seq,step:1,usage:{inputTokens:1000000,outputTokens:100}}}});
  }
  const old=h.tokenBudgetOf('private:124',now);assert.equal(old.periodStart,boundary);assert.equal(old.turns,1);assert.equal(old.globalTurns,2);
  server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port,headers={'x-console-token':'fixture-console-token','content-type':'application/json'};
  const save=value=>fetch(base+'/api/plugins/config',{method:'POST',headers,body:JSON.stringify({id:'life-token-budget',config:{dailyResetTime:value}})});
  assert.equal((await save('24:00')).status,400);assert.equal((await save('06:00')).status,200);
  const saved=await fetch(base+'/api/plugins/detail?id=life-token-budget',{headers}).then(r=>r.json());assert.equal(saved.plugin.config.dailyResetTime,'06:00');
  for(const key of ['private:124','group:456']){const current=h.tokenBudgetOf(key,now);assert.equal(current.periodStart,at('2026-10-31T06:00:00'));assert.equal(current.turns,2);assert.equal(current.globalTurns,4);assert(current.cost>old.cost);}
  assert.equal((await save('06:30')).status,200);assert.equal(h.tokenBudgetOf('private:124',now).cost,old.cost);
 }finally{if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}await h.close();}
});
