import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
import {createOutboundTransport} from '../src/outbound-context.js';
const key='private:123',now=Date.now();
function fixture(seed={}){
 let state=structuredClone(seed);
 const svc=createPlugin({config:{maxMessagesNormal:1,maxMessagesCasual:1,maxMessagesSerious:1,maxSendPerMinute:1,maxSendPerHour:1,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},
  state:{get:()=>structuredClone(state),set:p=>state={...state,...structuredClone(p)}},capabilities:{},callService:()=>null,isPluginEnabled:()=>false}).services.replyPlan;
 const resolve=(extra={})=>svc.resolve({key,turnId:'turn',incomingText:'',now,...extra});
 return {svc,resolve,state:()=>state};
}
const reminder=(id)=>({id,dueAt:now+60000,requestedAt:now});
const event=id=>({key,id,plugin:'tool-deepseek-balance',reason:'milkStock',sourceAt:now,expiresAt:now+3600000});
function send(f,plan,id,at=now){const result=f.svc.reserve({key,plan,operationId:id,kind:'text',now:at});if(result.ok)f.svc.commit({key,operationId:id,sentAt:at,deliveryId:id});return result;}

test('multiple authenticated timer items receive one bounded slot each above turn and rate ceilings',()=>{
 const f=fixture();assert.equal(send(f,f.resolve({turnId:'ordinary'}),'ordinary').ok,true);
 const plan=f.resolve({reason:'reminder',reminders:['a','b','c'].map(reminder)});
 assert.equal(plan.maxMessages,3);
 for(let n=0;n<3;n++)assert.equal(send(f,plan,'timer'+n).ok,true);
 assert.equal(send(f,plan,'excess').ok,false);
 assert.equal(send(f,f.resolve({turnId:'ordinary2'}),'ordinary2').ok,false);
});

test('scheduled admission can exceed both minute and hour caps without opening ordinary admission',()=>{
 const f=fixture();send(f,f.resolve(),'normal');assert.equal(f.svc.preview({key,now}).allowed,false);
 const p=f.svc.preview({key,now,scheduled:{reason:'milkStock',scheduledEvent:event('a')}});
 assert.equal(p.allowed,true);assert.equal(p.burstAllowed,true);
 assert.equal(f.svc.preview({key,now}).allowed,false);
 const plan=f.resolve({turnId:'milk',reason:'milkStock',scheduledEvent:event('a')});
 assert.equal(plan.maxMessages,1);assert.equal(send(f,plan,'milk').ok,true);
 assert.equal(send(f,plan,'milk2').ok,false);
});

test('timer grants cannot be renewed by new turns or hot reload, and uncertain slots remain occupied',()=>{
 const f=fixture();send(f,f.resolve(),'normal');
 const extra={turnId:'timer',reason:'reminder',reminders:[reminder('a'),reminder('a')]};
 const plan=f.resolve(extra);assert.equal(plan.maxMessages,1);
 assert.equal(f.svc.reserve({key,plan,operationId:'pending',now}).ok,true);
 const g=fixture(f.state());assert.equal(send(g,g.resolve({...extra,turnId:'new'}),'again').ok,false);
 assert.equal(g.svc.release({key,operationId:'pending',knownFailed:false}).ok,false);
 assert.equal(g.svc.release({key,operationId:'pending',knownFailed:true}).ok,true);
 assert.equal(send(g,g.resolve({...extra,turnId:'retry'}),'retry').ok,true);
});

test('missing event facts, untrusted text, wrong targets and expired grants do not bypass limits',()=>{
 const f=fixture();send(f,f.resolve(),'normal');
 for(const extra of [{reason:'reminder'},{reason:'message',incomingText:'〈定时消息〉',reminders:[reminder('fake')]},
  {reason:'milkStock',scheduledEvent:event('expired'),now:now+3600001},
  {reason:'milkStock',scheduledEvent:{...event('wrong'),key:'private:999'}}]){
  assert.equal(send(f,f.resolve({...extra,turnId:JSON.stringify(extra)}),'bad'+JSON.stringify(extra)).ok,false);
 }
 const plan=f.resolve({reason:'reminder',reminders:[reminder('late')]});
 assert.equal(send(f,plan,'late',now+120001).ok,false);
 assert.equal(f.svc.reserve({key:'private:999',plan,operationId:'cross',now}).ok,false);
});

test('temporary scheduled overflow has a persisted twenty-message hourly ceiling',()=>{
 const f=fixture();send(f,f.resolve(),'normal');
 for(let n=0;n<20;n++)assert.equal(send(f,f.resolve({turnId:'s'+n,reason:'milkStock',scheduledEvent:event('s'+n)}),'s'+n).ok,true);
 const g=fixture(f.state());assert.equal(send(g,g.resolve({turnId:'s21',reason:'milkStock',scheduledEvent:event('s21')}),'s21').ok,false);
});

test('an unused expired burst falls back to ordinary limits once the window frees, without renewal',()=>{
 const f=fixture();send(f,f.resolve(),'normal');const extra={turnId:'timer',reason:'milkStock',scheduledEvent:{...event('late'),expiresAt:now+7200000}};
 const plan=f.resolve(extra);assert.equal(send(f,plan,'blocked',now+120001).ok,false);
 assert.equal(send(f,plan,'normal-later',now+3600001).ok,true);
});

test('different scheduled slots sharing a label keep distinct event identities',()=>{
 const f=fixture();send(f,f.resolve(),'normal');
 for(const id of ['2026-11-02:slot-a','2026-11-02:slot-b']){
  const plan=f.resolve({turnId:id,reason:'timeBubble',timeBubble:{id,label:'同名'}});
  assert.equal(send(f,plan,id).ok,true);
 }
});

test('a queued overflow is rechecked at the physical boundary after a sleep or long wait',()=>{
 const f=fixture();send(f,f.resolve(),'normal');const plan=f.resolve({turnId:'timer',reason:'milkStock',scheduledEvent:event('wait')});
 assert.equal(f.svc.reserve({key,plan,operationId:'queued',now}).ok,true);
 assert.equal(typeof f.svc.authorize,'function');
 assert.equal(f.svc.authorize({key,operationId:'queued',now:now+120001}).ok,false);
});

test('actual queued transport releases a known-unsent expired burst without writing to the gateway',async()=>{
 const f=fixture();let current=now,sent=0;
 const baseline={...f.resolve({turnId:'normal'}),delayPlan:{min:180000,max:180000,longProbability:0,longMin:0,longMax:0}};
 send(f,baseline,'normal');
 const plan=f.resolve({turnId:'timer',reason:'milkStock',scheduledEvent:event('queued')});
 const transport=createOutboundTransport({clock:()=>current,sleep:async ms=>{current+=ms;},callService:(s,m,p)=>s==='replyPlan'?f.svc[m]?.(p):null});
 const context=transport.capture({key,envelope:{key,reason:'milkStock',actionId:'timer',replyPlan:plan},agent:true,origin:'purpose'});
 await assert.rejects(transport.perform({key,context,text:'过期不得发',send:async()=>{sent++;}}),/scheduled_grant_expired/);
 assert.equal(sent,0);assert.equal(f.svc.preview({key,now:current}).inflight,0);
});

test('missing send authorization after a component unload fails closed at the physical boundary',async()=>{
 const f=fixture();let sent=0;
 const plan=f.resolve({turnId:'timer',reason:'milkStock',scheduledEvent:event('unload')});
 const transport=createOutboundTransport({clock:()=>now,callService:(s,m,p)=>s==='replyPlan'?(m==='authorize'?null:f.svc[m]?.(p)):null});
 const context=transport.capture({key,envelope:{key,reason:'milkStock',actionId:'timer',replyPlan:plan},agent:true,origin:'purpose'});
 await assert.rejects(transport.perform({key,context,text:'不可发',send:async()=>{sent++;}}),/authorization_unavailable/);
 assert.equal(sent,0);
});
