import test from 'node:test';
import assert from 'node:assert/strict';
import {createMilkMonitor} from '../monitor.mjs';
import {validateMilkPolicy,selectedStock,stockChange} from '../milk-stock.mjs';
const account=(total,available=true,currency='CNY')=>({ok:true,is_available:available,balance_infos:[{currency,total_balance:String(total),granted_balance:'0',topped_up_balance:String(total)}]});
function fixture(config={},seed={}){
 let state=structuredClone(seed),now=10000000,result=account('10.00'),requests=0;const notices=[],caps={getOwnerQQ:()=>123,sendNotificationDetailed:async(key,text,meta)=>{notices.push({key,text,meta});return {ok:true,receiptStatus:'sent'};}};
 const ctx={config,state:{get:()=>state,set:p=>state={...state,...p}},capabilities:caps};
 const monitor=createMilkMonitor(ctx,{query:async()=>{requests++;return result;},clock:()=>now});
 return {monitor,ctx,notices,state:()=>state,requests:()=>requests,next(value,minutes=5){result=value;now+=minutes*60000;},now:()=>now};
}
test('ordinary use stays quiet; crossing low/critical/empty and replenishment report without a model',async()=>{
 const f=fixture();await f.monitor.tick();assert.equal(f.notices.length,0);
 f.next(account('9.99'));await f.monitor.tick();assert.equal(f.notices.length,0);
 f.next(account('4.50'));await f.monitor.tick();assert.match(f.notices.at(-1).text,/余额.*偏少/);
 f.next(account('0.50'));await f.monitor.tick();assert.match(f.notices.at(-1).text,/见底/);
 f.next(account('0',false));await f.monitor.tick();assert.match(f.notices.at(-1).text,/余额.*空/);
 f.next(account('20'));await f.monitor.tick();assert.match(f.notices.at(-1).text,/补充|恢复/);assert.equal(f.notices.at(-1).key,'private:123');
 const count=f.notices.length;f.next(account('20'));await f.monitor.tick();assert.equal(f.notices.length,count);
});
test('periodic interval, toggle and cached manual reads avoid repeated network calls',async()=>{
 const f=fixture({checkIntervalMin:5});await f.monitor.tick();f.next(account('9'),1);await f.monitor.tick();assert.equal(f.requests(),1);
 f.ctx.config.monitorEnabled=false;f.next(account('8'),10);await f.monitor.tick();assert.equal(f.requests(),1);
 await Promise.all([f.monitor.query(),f.monitor.query()]);assert.equal(f.requests(),2);
});
test('errors keep the last successful amount, back off, and cannot masquerade as empty milk',async()=>{
 const f=fixture();await f.monitor.tick();f.next({ok:false,error:'network'});await f.monitor.tick();assert.equal(f.monitor.status().lastSuccess.balance_infos[0].total_balance,'10.00');assert.equal(f.monitor.status().fresh,false);assert.equal(f.notices.length,0);
 const requests=f.requests();await f.monitor.tick();assert.equal(f.requests(),requests);assert.doesNotMatch(f.monitor.context({key:'private:123'}),/存量为零|调用额度空了/);
});
test('exact amounts are owner-only, public context is staged, and unavailable positive funds are not empty',async()=>{
 const f=fixture();await f.monitor.tick();assert.match(f.monitor.context({key:'private:123'}),/CNY 10.00/);assert.doesNotMatch(f.monitor.context({key:'group:123'}),/CNY|10.00/);assert.doesNotMatch(f.monitor.context({key:'private:124'}),/CNY|10.00/);
 f.next(account('8',false));await f.monitor.tick();assert.match(f.notices.at(-1).text,/账户.*不可用/);assert.doesNotMatch(f.notices.at(-1).text,/调用额度空了/);
 f.next(account('8'),60);assert.match(f.monitor.context({key:'private:123'}),/过期|未核实/);
});

test('owner context requests fresh verification for current stock and claimed refills even before a first sample',async()=>{
 const f=fixture();
 for(const text of [f.monitor.context({key:'private:123'}),await (async()=>{await f.monitor.tick();return f.monitor.context({key:'private:123'});})()]){
  assert.match(text,/主动调用deepseek_balance核对/);
  assert.match(text,/充值|补可用额度/);
  assert.match(text,/旧快照.*不能.*本轮.*查询/);
  assert.match(text,/失败.*不重试/);
  assert.match(text,/普通闲聊.*不.*查询/);
 }
 assert.doesNotMatch(f.monitor.context({key:'private:124'}),/CNY|10.00/);
});
test('held alerts are superseded on recovery; unknown delivery is never blindly replayed',async()=>{
 const f=fixture();await f.monitor.tick();f.ctx.capabilities.sendNotificationDetailed=async()=>({ok:false,reason:'quiet'});
 f.next(account('0',false));await f.monitor.tick();assert(f.state().milk.pendingAlert);
 f.ctx.capabilities.sendNotificationDetailed=async(key,text,meta)=>{f.notices.push({key,text,meta});return {ok:false,receiptStatus:'uncertain'};};
 f.next(account('12'));await f.monitor.tick();assert.match(f.notices.at(-1).text,/补充|恢复/);assert.doesNotMatch(f.notices.at(-1).text,/调用额度空了/);
 const count=f.notices.length;f.next(account('12'));await f.monitor.tick();assert.equal(f.notices.length,count);
});
test('different currencies and invalid amounts cannot become invented low-stock or refill events',async()=>{
 const f=fixture();await f.monitor.tick();f.next(account('0',true,'USD'));await f.monitor.tick();assert.equal(f.notices.length,0);
 f.next(account('not-money'));await f.monitor.tick();assert.equal(f.notices.length,0);
});
test('three failed checks send one diagnostic and later recovery reports a fresh verified amount',async()=>{
 const f=fixture();await f.monitor.tick();for(let n=0;n<3;n++){f.next({ok:false,error:'network'},30);await f.monitor.tick();}
 assert.equal(f.notices.length,1);assert.match(f.notices[0].text,/未核实/);f.next(account('10'),30);await f.monitor.tick();assert.match(f.notices.at(-1).text,/查询恢复/);
});
test('a late query after deactivation cannot save a balance or emit a notice',async()=>{
 let release,state={},sent=0;const controller=new AbortController(),ctx={config:{},signal:controller.signal,state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{getOwnerQQ:()=>123,sendNotificationDetailed:()=>{sent++;return {ok:true};}}};
 const monitor=createMilkMonitor(ctx,{query:()=>new Promise(r=>release=r)}),pending=monitor.query();controller.abort();release(account('0',false));await pending;assert.equal(monitor.status().lastSuccess,undefined);assert.equal(sent,0);
});
test('a queued alert loses its physical expiry on recovery, and querying is not blocked behind delivery',async()=>{
 const f=fixture();await f.monitor.tick();let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);let sent=0;
 f.ctx.capabilities.sendNotificationDetailed=async(_key,_text,meta)=>{entered();await gate;if(meta.expiresAt<=f.now())return {ok:false,reason:'expired'};sent++;return {ok:true};};
 f.next(account('0',false));const waiting=f.monitor.tick();await ready;f.next(account('12'));const result=await f.monitor.query();assert.equal(result.balance_infos[0].total_balance,'12');release();await waiting;assert.equal(sent,0);
});
test('deactivation revokes the expiry of a queued notification before physical delivery',async()=>{
 let release,entered,meta;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r),controller=new AbortController();
 const ctx={config:{},signal:controller.signal,capabilities:{getOwnerQQ:()=>123,sendNotificationDetailed:async(_key,_text,value)=>{meta=value;entered();await gate;return {ok:meta.expiresAt>0};}}};
 const monitor=createMilkMonitor(ctx,{query:async()=>account('0',false)}),waiting=monitor.tick();await ready;controller.abort();assert.equal(meta.expiresAt,0);release();await waiting;
});
test('partial replenishment reports both the increase and the remaining low-stock condition',async()=>{
 const f=fixture();await f.monitor.tick();f.next(account('0',false));await f.monitor.tick();f.next(account('0.50'));await f.monitor.tick();assert.match(f.notices.at(-1).text,/补充/);assert.match(f.notices.at(-1).text,/仍处于见底/);
});
test('monitor policy rejects invalid amounts, intervals, currencies and reversed thresholds',()=>{
 for(const patch of [{lowBalance:-1},{lowBalance:1e-7},{criticalBalance:9},{checkIntervalMin:0},{notificationCooldownMin:1.5},{currency:'EUR'}])assert.equal(validateMilkPolicy(patch).ok,false);
 assert.equal(validateMilkPolicy({lowBalance:5.29,criticalBalance:1.01}).ok,true);
});
test('three configurable money thresholds distinguish abundant, low and critical stock',()=>{
 const config={abundantBalance:50,lowBalance:10,criticalBalance:2};
 assert.equal(selectedStock(account('50.00'),config).stage,'super_abundant');assert.equal(selectedStock(account('9.00'),config).stage,'low');assert.equal(selectedStock(account('2.00'),config).stage,'critical');
 assert.equal(validateMilkPolicy({...config,abundantBalance:9}).ok,false);assert.equal(validateMilkPolicy({...config,reminderScope:'nobody'}).ok,false);
});
test('scope selects admin/private/all conversational reminders; different tiers and refill reopen the event',async()=>{
 for(const [scope,expected]of [['admin',['private:123']],['private',['private:123','private:124']],['all',['private:123','private:124','group:456']]]){
  const f=fixture({reminderScope:scope});await f.monitor.tick();
  for(const amount of ['4.00','0.50','0','30.00']){f.next(account(amount,amount!=='0'));await f.monitor.tick();assert.deepEqual(['private:123','private:124','group:456'].filter(key=>f.monitor.context({key})),expected);for(const key of expected){assert.match(f.monitor.context({key}),/这次可说/);f.monitor.sent({key,success:true,messages:['调用额度这次有变化啦']});assert.doesNotMatch(f.monitor.context({key}),/这次可说/);}}
 }
});
test('replenishment provides actual before/after and relative net change without scripting its emotional response',()=>{
 const e=stockChange(account('0.60'),account('12.60'));assert.equal(e.before.amount,'0.60');assert.equal(e.stock.amount,'12.60');assert.equal(e.delta,'12.00');assert.equal(e.relativeChange.percent,'2000.00');
 const zero=stockChange(account('0'),account('1.00'));assert.equal(zero.relativeChange.baseline,'zero_or_below');assert.equal(zero.relativeChange.percent,null);
 assert.equal(selectedStock(account('20.01'),{abundantBalance:20}).stage,'super_abundant');assert.equal(selectedStock(account('-0.01')).stage,'empty');
});
test('edited thresholds immediately reclassify cached balances without inventing a recharge',async()=>{
 const f=fixture();await f.monitor.query();f.ctx.config.abundantBalance=6;
 assert.equal((await f.monitor.queryFor({key:'private:123'})).milk.stock.stage,'super_abundant');assert.match(f.monitor.context({key:'private:123'}),/超级富足/);assert.equal(f.requests(),1);
 f.next(account('10.00'));assert.equal((await f.monitor.query()).milk.change,null);
});
