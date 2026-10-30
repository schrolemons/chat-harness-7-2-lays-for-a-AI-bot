import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/ctx-chat-reply-shape/index.js';

const key='private:123', now=1_000_000;
function fixture(config={}, seed={}) {
  let state=structuredClone(seed);
  const ctx={config, state:{get:()=>structuredClone(state),set:p=>{state={...state,...structuredClone(p)};}},callService:()=>null,capabilities:{},isPluginEnabled:()=>false};
  const plugin=createPlugin(ctx);
  return {svc:plugin.services?.replyPlan,plugin,state:()=>state,ctx};
}
const mood={enabled:true,mode:'normal',replyCeiling:3,detailLevel:'expanded',welcomeBurstActive:true};
test('one frozen welcome plan serves prompt and all multipart entrances',()=>{
  const {svc,plugin}=fixture(); assert.ok(svc,'replyPlan service');
  const plan=svc.resolve({key,turnId:'turn1',incomingText:'你好',mood,now});
  assert.equal(plan.maxMessages,3); assert.equal(plan.detailLevel,'expanded');
  assert.equal(plugin.hooks.beforePrompt({replyPlan:plan}),plan.line);
  for(const [i,kind] of ['text','image','voice'].entries()){
    assert.equal(svc.reserve({key,plan,operationId:`p${i}`,kind,now}).ok,true);
    assert.equal(svc.commit({key,operationId:`p${i}`,sentAt:now+i,deliveryId:`d${i}`}).ok,true);
  }
  assert.equal(svc.reserve({key,plan,operationId:'fourth',kind:'sticker',now}).reason,'turn_limit');
  assert.equal(svc.reserve({key:'private:456',plan,operationId:'cross-target',kind:'text',now}).reason,'turn_limit');
});
test('serious and phi caps survive welcome; mood ceiling and exact zero timing apply',()=>{
  const {svc}=fixture({intervalMinMs:0,intervalMaxMs:0});assert.ok(svc);
  assert.equal(svc.resolve({key,turnId:'a',incomingText:'修复代码',mood,now}).maxMessages,1);
  assert.equal(svc.resolve({key,turnId:'b',incomingText:'你好',mood,phiMode:'knowledge',now}).maxMessages,1);
  const plan=svc.resolve({key,turnId:'c',incomingText:'你好',mood:{...mood,welcomeBurstActive:false,replyCeiling:1},now});
  assert.equal(plan.maxMessages,1);assert.equal(plan.minIntervalMs,0);
});
test('reservations serialize concurrent media and release only known failure',()=>{
  const {svc}=fixture({maxSendPerMinute:2,maxSendPerHour:3});assert.ok(svc);
  const plan=svc.resolve({key,turnId:'a',incomingText:'你好',mood,now});
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
  const plan=f.svc.resolve({key,turnId:'a',incomingText:'你好',mood,now});
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
