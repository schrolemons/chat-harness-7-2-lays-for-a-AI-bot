import test from'node:test';import assert from'node:assert/strict';
import{bridgeHarness,fixtureTaskTurn}from'./audit-bridge-harness.mjs';import{createReplyContentCarrier}from'../src/mcp-content-carrier.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQmcAAAAASUVORK5CYII=','base64');
test('a compounded image relay retains its explicit task content through the real bridge and simulated OneBot leaf',async()=>{
 const h=await bridgeHarness({files:{'state/plugins/config/ctx-chat-reply-shape.json':{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0}}});let server;
 try{
  h.setMode('reserved2');const key='private:123';h.getSocialV2State(key).bootstrapSent=true;
  const sid=await fixtureTaskTurn(h,key,'帮我转告group:456，附上这张图片'),st=h.getSocialV2State(key),seq=st.recentMessages.findLast(m=>!m.isSelf).seq;
  const envelope=h.activeTurnEnvelopes.get(sid);
  // A new task can arrive during an existing chat activity. Its explicit
  // per-call content must win over that activity's unbound frozen plan.
  envelope.replyPlan=Object.freeze({...envelope.replyPlan,contentId:undefined,taskExempt:false,taskPending:false,taskGroupId:undefined});
  const asset=h.imageAssetStore.stage({key,source:'qq-incoming',sourceRef:'qq:-10:1',data:png});
  server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  let carrier;const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json','x-console-token':h.cfg.consoleToken,'x-agent-call':'1','x-agent-token':st.agentToken,...Object.fromEntries(carrier.headers({}))},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  carrier=createReplyContentCarrier({declareContents:async input=>(await post('/api/socialV2/reply-contents',input)).body});
  const refused=await post('/api/images/staged',{action:'relay',key,token:st.agentToken,target:'group:456',imageId:asset.imageId});
  assert.equal(refused.status,400);assert.equal(refused.body.delivery,'not_sent','a pre-gateway source refusal is a known non-send, never an unknown delivery');
  assert(!h.calls.sent.some(call=>call.key==='group:456'));assert.equal(h.imageAssetStore.get({key,imageId:asset.imageId}).delivery,null);
  const relay=carrier.decorate('qq_relay_image',['relay',{},async input=>{
   const out=await post('/api/images/staged',{action:'relay',key,token:st.agentToken,target:'group:456',imageId:asset.imageId});
   assert.equal(out.status,200,JSON.stringify(out.body));return{content:[{type:'text',text:JSON.stringify(out.body)}]};
  }])[2];
  const result=await relay({key,token:st.agentToken,sourceSeqs:[seq]});assert.equal(JSON.parse(result.content[0].text).ok,true);
  assert(h.calls.http.some(call=>call.url.endsWith('/send_group_msg')&&call.body.message?.some(m=>m.type==='image')));
  assert.equal(h.imageAssetStore.get({key,imageId:asset.imageId}).delivery,'sent');
  assert.equal(h.activeTurnEnvelopes.get(sid).replyPlan.contentId,undefined,'the original envelope need not be rewritten to retain the per-call grant');
 }finally{if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}await h.close();}
});
