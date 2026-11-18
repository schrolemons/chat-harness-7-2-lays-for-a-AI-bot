import test from 'node:test';import assert from 'node:assert/strict';
import{createUpstreamAvailability}from'../plugins/qq-components/obs-cost-policy/upstream-availability.mjs';
import{bridgeHarness}from'./audit-bridge-harness.mjs';
const error='422: {"message":"ExceededBudget: Key over 12h budget. Spend=$70.2950, Limit=$70.00","type":"budget_exceeded","code":"422"}';
test('upstream quota is an observed provider-wide cooldown, not a local bill or a promised reset',()=>{
 let data={};const state={get:()=>data,set:p=>data={...data,...p}},s=createUpstreamAvailability({state}),at=Date.now();
 assert.equal(s.observeError({provider:'ustc',error:'422 invalid arguments',at}).recorded,false);assert.equal(s.observeError({provider:'ustc',error,at:at-3600000}).recorded,false);
 assert.equal(s.observeError({provider:'ustc',error,at}).recorded,true);const status=s.status({provider:'ustc',now:at});assert.equal(status.blocked,true);assert.equal(status.limit,70);assert.equal(status.spend,70.295);assert.equal(status.windowHours,12);assert.equal(status.retryAt-at,15*60000);
 assert.equal(s.status({provider:'deepseek-official',now:at}).blocked,false);assert.equal(s.status({provider:'ustc',now:status.retryAt}).blocked,false);assert.equal(s.status({provider:'ustc',now:status.retryAt}).reason,'retry_allowed');
 assert.equal(data.cost,undefined);assert.equal(s.observeError({provider:'ustc',error,at}).duplicate,true);
 s.observeError({provider:'deepseek-official',error:'Insufficient Balance (request_id: fixture)',at});assert.equal(s.status({provider:'deepseek-official',now:at}).reason,'upstream_balance');assert.equal(s.status({provider:'deepseek-official',now:at}).blocked,true);
});
test('real ingress keeps message bodies while unavailable model suppresses new inference and delayed filler',async()=>{
 const h=await bridgeHarness({config:{socialV2:{proactive:{enabled:false},curfew:{enabled:false}}}});
 try{h.setMode('reserved2');const key='private:123';await h.ensureSession(key);h.taskCaps.getModelAvailability=()=>({blocked:true,provider:'ustc'});
  h.pluginHost.callService('modelAvailability','observeError',{provider:'ustc',error});
  const before=h.calls.prompts.length;
  await h.handleIncoming('private',123,{message_id:'upstream-limit',user_id:123,time:Math.floor(Date.now()/1000),raw_message:'还在吗',message:[{type:'text',data:{text:'还在吗'}}]},h.cfg);
  assert.equal(h.calls.prompts.length,before);assert(h.getSocialV2State(key).recentMessages.some(m=>String(m.messageId)==='upstream-limit'));assert.equal(h.calls.sent.length,0);
  assert.equal(h.pluginHost.callService('proactive','allowsReason',{key,reason:'private',hasPendingHuman:true}).reason,'model_budget');
 }finally{await h.close();}
});
