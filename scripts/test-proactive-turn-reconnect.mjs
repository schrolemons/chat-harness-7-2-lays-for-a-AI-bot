import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';

async function setup(t,reason='startupGreeting') {
  const h=await bridgeHarness({config:{sendDelayMs:0},files:{
    'state/plugins/config/life-wake-reasons.json':{curfewEnabled:false},
    'state/plugins/config/ctx-chat-reply-shape.json':{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0}
  }});
  h.setMode('reserved2');const key='private:123',st=h.getSocialV2State(key);st.bootstrapSent=true;
  const sid=await h.ensureSession(key),server=h.startConsoleServer();
  if(!server.listening)await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await h.close();});
  const post=async text=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/send-message',{
    method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-call':'1','x-agent-token':st.agentToken},
    body:JSON.stringify({key,messages:text})});return r.json();};
  const event=(type,data)=>h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type,data}}});
  const snapshot=records=>h.queueDshEnvelope({payload:{type:'session/snapshot',sessionId:sid,snapshot:{records}}});
  await h.deliverPrompt(key,'synthetic scheduled opportunity',{wakeReason:reason});
  return {h,key,sid,post,event,snapshot};
}
const start={type:'turn/start',data:{turn:1}},end={type:'turn/end',data:{turn:1,reason:{kind:'completed'}}};

for(const reason of ['startupGreeting','proactiveCheck','timeBubble'])test(reason+' retains its original grant and cumulative cap across stream reconnect',async t=>{
  const {h,key,sid,post,event,snapshot}=await setup(t,reason);
  await event(start.type,start.data);const before=h.activeTurnEnvelopes.get(sid),id=before.replyPlan.turnId;
  const cap=before.replyPlan.maxMessages;assert.equal((await post('before reconnect')).ok,true);
  await h.disconnectMux();await snapshot([start]);
  assert.equal(h.activeTurnEnvelopes.get(sid)?.replyPlan?.turnId,id,'reconnect must preserve the dispatch grant');
  for(let i=1;i<cap;i++)assert.equal((await post('after reconnect '+i)).ok,true);
  assert.match((await post('over cap')).error,/turn_limit|最多发送 0 条/);
  assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).successful,cap);
});
test('accepted dispatch whose start was missed binds once from the open-turn snapshot',async t=>{
  const {h,key,sid,post,snapshot}=await setup(t);
  const id=h.pendingTurnEnvelopes.get(sid)[0].replyPlan.turnId;
  await h.disconnectMux();await snapshot([start]);
  assert.equal(h.activeTurnEnvelopes.get(sid)?.replyPlan?.turnId,id);
  await snapshot([start]);assert.equal((await post('one greeting')).ok,true);
  assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).successful,1);
});
test('terminal snapshot revokes the old grant without replaying historical output',async t=>{
  const {h,sid,post,event,snapshot}=await setup(t);
  await event(start.type,start.data);await h.disconnectMux();
  await snapshot([start,{type:'assistant/message',data:{turn:1,message:{content:[{type:'text',text:'must not replay'}]}}},end]);
  assert.equal(h.activeTurnEnvelopes.has(sid),false);assert.equal(h.calls.sent.length,0);
  assert.match((await post('late stale greeting')).error,/turn_required/);
});
test('snapshot without a bridge dispatch never manufactures a grant',async t=>{
  const {h,sid,post,snapshot}=await setup(t);h.pendingTurnEnvelopes.delete(sid);
  await h.disconnectMux();await snapshot([start]);
  assert.match((await post('orphan')).error,/turn_required/);assert.equal(h.calls.sent.length,0);
});
test('replayed start cannot consume the next dispatch or refresh the current grant',async t=>{
  const {h,key,sid,event,snapshot}=await setup(t);
  await event(start.type,start.data);const first=h.activeTurnEnvelopes.get(sid);
  await h.deliverPrompt(key,'next synthetic task',{wakeReason:'proactiveCheck'});
  const queued=h.pendingTurnEnvelopes.get(sid)[0];
  await h.disconnectMux();await snapshot([start]);await event(start.type,start.data);
  assert.equal(h.activeTurnEnvelopes.get(sid),first);
  assert.equal(h.pendingTurnEnvelopes.get(sid)[0],queued);
});
test('an old terminal snapshot does not revoke the newer live turn',async t=>{
  const {h,key,sid,event,snapshot}=await setup(t);
  await event(start.type,start.data);
  await h.deliverPrompt(key,'new synthetic task',{wakeReason:'timeBubble'});
  await event('turn/start',{turn:2});const current=h.activeTurnEnvelopes.get(sid);
  await h.disconnectMux();await snapshot([start,end,{type:'turn/start',data:{turn:2}}]);
  assert.equal(h.activeTurnEnvelopes.get(sid),current);assert.equal(current.cancelled,false);
});
