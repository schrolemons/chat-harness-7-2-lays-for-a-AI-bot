import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {recordEvidence,secretFor} from '../plugins/qq-components/obs-context-assembly/store.mjs';
import {decodePacket} from '../plugins/qq-components/obs-context-assembly/packet.mjs';
import {refreshContextPacket} from '../plugins/qq-agent-presets/context-refresh.mjs';
import {messageAdmitted}from'../src/outbound-context.js';

test('an active normal chat refresh receives admitted live ingress locally without replying or spending wake quota',async()=>{
 const h=await bridgeHarness();try{
  h.setMode('reserved2');const key='private:123',sessionId=await h.ensureSession(key),st=h.getSocialV2State(key);
  h.appendSocialV2Message(key,'用户','现在说乌龙茶，不再聊预算池','现在说乌龙茶，不再聊预算池',false,false,'fresh-topic');
  for(const m of[...st.unread,...st.recentMessages]){m.quotaAdmission='admitted';m.bodyComplete=true;}
  const envelope={key,sessionId,reason:'message',actionId:'live-test',replyPlan:h.pluginHost.callService('replyPlan','resolve',{key,turnId:'live-test',agent:true})};
  h.activeTurnEnvelopes.set(sessionId,envelope);const wakeCount=st.wakeConfig.wakeCount;
  const r=h.taskCaps.refreshContextModules({key,sessionId,scene:'message',moduleIds:[]});
  assert(r.snapshot.messages.some(m=>m.text.includes('乌龙茶')));assert(messageAdmitted(envelope,st.unread[0]));assert(st.unread[0].seenAt>0);assert(!st.unread[0].repliedAt);assert.equal(st.wakeConfig.wakeCount,wakeCount);assert.equal(h.calls.sent.length,0);
  envelope.cancelled=true;const closed=h.taskCaps.refreshContextModules({key,sessionId,scene:'message',moduleIds:[]});assert.equal(closed.snapshot,undefined);
 }finally{await h.close();}
});

test('real bridge refresh route is signed, session-bound, read-only and does not grant Console access',async()=>{
 const h=await bridgeHarness();let server;try{
  h.setMode('reserved2');const key='private:123',sessionId=await h.ensureSession(key);
  recordEvidence(h.temp,sessionId,'consumer',{sessionId,pid:process.pid});
  h.getSocialV2State(key).pendingTimeBubble={label:'隔离测试时段'};h.buildWakePromptV2(key,'timeBubble');
  const quotaFile=path.join(h.temp,'state/plugins/life-proactive-time-bubble.json'),quotaBefore=fs.readFileSync(quotaFile,'utf8');
  h.appendSocialV2Message(key,'用户','真实正文','真实正文',false,false,'m1');const st=h.getSocialV2State(key),seq=st.lastUnreadSeq;
  const compose=()=>h.pluginHost.callService('contextAssembly','compose',{key,sessionId,scene:'timeBubble',modules:[{id:'role-card',text:'保持原始角色'},{id:'wake-action',text:'测试任务'},{id:'ctx-context-dynamics',text:'旧心情'},{id:'message-snapshot',text:JSON.stringify({key,messages:[{seq,text:'真实正文',receiptState:'unseen'}],recent:[]})}],fallback:'fallback'});
  const envelope=compose();assert.notEqual(envelope,'fallback');
  server=h.startConsoleServer();if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const post=(body,extra={})=>fetch(url+'/api/context/refresh',{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(body)});
  assert.equal((await post({sessionId,envelope:envelope.replace('保持原始角色','伪造')})).status,403);
  assert.equal((await post({sessionId:'other',envelope})).status,403);
  assert.equal((await post({sessionId,envelope},{origin:'https://external.invalid'})).status,403);
  assert.equal((await fetch(url+'/api/context/preview')).status,401,'exception cannot access management');
  for(const row of[...st.unread,...st.recentMessages])if(row.seq===seq){row.seenAt=101;row.repliedAt=102;}st.lastReadThroughSeq=seq;
  const response=await post({sessionId,envelope});assert.equal(response.status,200);
  const result=await response.json(),packet=decodePacket(result.envelope,secretFor(h.temp),sessionId);
  assert.equal(packet.key,key);const role=packet.modules.find(row=>row.id==='role-card');
  assert.equal(role.chatExpressionBaseText,'保持原始角色');assert.equal(role.parts.find(part=>part.id==='role-card:original').text,'保持原始角色');assert(role.text.startsWith('保持原始角色\n\n'));assert.match(role.text,/当前形态/,'selected live voice joins the original role without rewriting it');
  assert(!packet.modules.some(row=>row.id==='ctx-context-dynamics'&&row.text==='旧心情'),'uses live owner hooks, not stale capture');
  const snapshot=JSON.parse(packet.modules.find(row=>row.id==='message-snapshot').text);assert.equal(snapshot.receiptIndex[0].seq,seq);assert.equal(snapshot.receiptIndex[0].seenAt,101);assert.equal(snapshot.receiptIndex[0].repliedAt,102);assert.equal(snapshot.receiptIndex[0].text,undefined);assert.equal(snapshot.messages[0].text,'真实正文');assert.equal(st.unread[0].seenAt,101,'read-only refresh does not acknowledge messages');
  const latest=compose();assert.equal((await post({sessionId,envelope})).status,403,'superseded batch cannot refresh');
  fs.writeFileSync(path.join(h.temp,'config.json'),JSON.stringify({consolePort:server.address().port}));
  const refreshed=await refreshContextPacket({root:h.temp,sessionId,envelope:latest,secret:secretFor(h.temp)});assert.equal(refreshed.key,key);
  assert.equal(fs.readFileSync(quotaFile,'utf8'),quotaBefore,'reading context must not consume proactive send quota');
 }finally{if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}await h.close();}
});
