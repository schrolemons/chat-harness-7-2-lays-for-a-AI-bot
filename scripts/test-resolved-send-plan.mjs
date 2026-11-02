import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/ctx-chat-reply-shape/index.js';

const key='private:123', now=1_000_000;
const message=seq=>({seq,messageId:'m'+seq,text:'你好',isSelf:false,bodyComplete:true});
function fixture(config={}, seed={}) {
  let state=structuredClone(seed);
  const ctx={config, state:{get:()=>structuredClone(state),set:p=>{state={...state,...structuredClone(p)};}},callService:()=>null,capabilities:{},isPluginEnabled:()=>false};
  const plugin=createPlugin(ctx);
  return {svc:plugin.services?.replyPlan,plugin,state:()=>state,ctx};
}
const mood={enabled:true,mode:'normal',replyCeiling:3,detailLevel:'expanded',welcomeBurstActive:true};
test('one frozen welcome plan serves prompt and all multipart entrances',()=>{
  const {svc,plugin}=fixture(); assert.ok(svc,'replyPlan service');
  const plan=svc.resolve({key,turnId:'turn1',incomingText:'你好',messages:[message(1)],mood,now});
  assert.equal(plan.maxMessages,3); assert.equal(plan.detailLevel,'expanded');
  assert.ok(plugin.hooks.beforePrompt({replyPlan:plan}).startsWith(plan.line+'\n'));
  assert.match(plugin.hooks.beforePrompt({replyPlan:plan}),/已成功发送 0 条/);
  for(const [i,kind] of ['text','image','voice'].entries()){
    assert.equal(svc.reserve({key,plan,operationId:`p${i}`,kind,now}).ok,true);
    assert.equal(svc.commit({key,operationId:`p${i}`,sentAt:now+i,deliveryId:`d${i}`}).ok,true);
  }
  assert.equal(svc.reserve({key,plan,operationId:'fourth',kind:'sticker',now}).reason,'content_limit');
  assert.equal(svc.reserve({key:'private:456',plan,operationId:'cross-target',kind:'text',now}).reason,'content_limit');
  assert.match(plugin.hooks.beforePrompt({replyPlan:plan}),/已成功发送 3 条/);
  assert.match(plugin.hooks.beforePrompt({replyPlan:plan}),/最多还可发送 0 条/);
});
test('serious and reference contexts retain configured parts despite mood ceilings; exact zero timing applies',()=>{
  const {svc}=fixture({intervalMinMs:0,intervalMaxMs:0});assert.ok(svc);
  assert.equal(svc.resolve({key,turnId:'a',incomingText:'修复代码',mood,now}).maxMessages,3);
  assert.equal(svc.resolve({key,turnId:'b',incomingText:'你好',mood,referenceMode:'knowledge',now}).maxMessages,3);
  const plan=svc.resolve({key,turnId:'c',incomingText:'你好',mood:{...mood,welcomeBurstActive:false,replyCeiling:1},now});
  assert.equal(plan.maxMessages,3);assert.equal(plan.minIntervalMs,0);
});
test('reservations serialize concurrent media and release only known failure',()=>{
  const {svc}=fixture({maxSendPerMinute:2,maxSendPerHour:3});assert.ok(svc);
  const plan=svc.resolve({key,turnId:'a',incomingText:'你好',messages:[message(1)],mood,now});
  assert.equal(svc.reserve({key,plan,operationId:'a',now}).ok,true);
  assert.equal(svc.reserve({key,plan,operationId:'b',now}).ok,true);
  assert.equal(svc.reserve({key,plan,operationId:'c',now}).reason,'minute_limit');
  assert.equal(svc.release({key,operationId:'a',knownFailed:true}).ok,true);
  assert.equal(svc.reserve({key,plan,operationId:'c',now}).ok,true);
  assert.equal(svc.release({key,operationId:'b',knownFailed:false}).ok,false);
});
test('migration and restart preserve real rates and uncertain reservations',()=>{
  const f=fixture({maxSendPerHour:2});assert.ok(f.svc);
  f.svc.initialize({conversations:[{key,sendTimes:[now-1]}],now});
  f.svc.initialize({conversations:[{key,sendTimes:[]}],now});
  const plan=f.svc.resolve({key,turnId:'a',incomingText:'你好',messages:[message(1)],mood,now});
  f.svc.reserve({key,plan,operationId:'unknown',now});
  const restarted=fixture({maxSendPerHour:2},f.state());
  assert.equal(restarted.svc.reserve({key,plan,operationId:'next',now}).reason,'hour_limit');
  assert.equal(restarted.svc.preview({key,now}).successful,1);
});
test('requested delays use the same bounds; no-turn agents fail closed',()=>{
  const {svc}=fixture({intervalMinMs:10,intervalMaxMs:20,longGapProbability:0});assert.ok(svc);
  const plan=svc.resolve({key,turnId:'a',incomingText:'你好',mood,now,random:()=>0});
  assert.equal(svc.delay({plan,requested:0}),10);assert.equal(svc.delay({plan,requested:1000}),20);
  assert.equal(svc.reserve({key,plan:{...plan,turnId:''},operationId:'x',now}).reason,'turn_required');
});

test('cold group independent contents wait at the shared minute rate without any batch parts ceiling',()=>{
 const {svc}=fixture({intervalMinMs:0,intervalMaxMs:0,longGapProbability:0,maxSendPerMinute:8,maxSendPerHour:100});
 const group='group:456',messages=Array.from({length:10},(_,i)=>message(i+1)),plan=svc.resolve({key:group,turnId:'cold-ten',budgetStage:'weak',batchMessageCount:10,messages,mood,now});
 assert.equal(plan.maxMessages,3);
 const declared=svc.declareContents({key:group,plan,messages,groups:messages.map(m=>({seqs:[m.seq],kind:'chat'}))});assert.equal(declared.ok,true);
 let clock=now;
 for(let n=1;n<=10;n++){
  const bound=svc.bindContent({key:group,plan,contentId:declared.contents[n-1].id}).plan,operationId='cold-'+n,r=svc.reserve({key:group,plan:bound,operationId,now:clock});
  assert.equal(r.ok,true);if(n===9)assert.equal(r.waitMs,60001);clock+=r.waitMs;
  svc.commit({key:group,operationId,sentAt:clock,deliveryId:operationId});assert.equal(svc.remaining({key:group,plan:bound}),2);
 }
 assert.equal(svc.preview({key:group,now:clock}).minute,2);
});
