import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOutboundTransport,reportHumanIncoming,outboundScope} from '../src/outbound-context.js';
import {createPlugin} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';
function fixture() {
  let state={};const svc=createPlugin({config:{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},state:{get:()=>structuredClone(state),set:p=>{state={...state,...p};}},capabilities:{},isPluginEnabled:()=>false}).services.replyPlan;
  const facts=[];const transport=createOutboundTransport({callService:(s,m,p)=>s==='replyPlan'?svc[m](p):(facts.push({s,m,p}),s==='mood'&&m==='read'?{replyCeiling:3}:null),sleep:async()=>{},clock:()=>1000});
  const plan=svc.resolve({key:'private:1',turnId:'turn',incomingText:'你好',mood:{replyCeiling:3},now:1000});
  const context=transport.capture({key:'private:1',envelope:{key:'private:1',actionId:'round',reason:'proactiveCheck',replyPlan:plan},origin:'conversation',agent:true});
  return {transport,context,facts,svc};
}
test('partial successes and all media share one frozen envelope and receipts',async()=>{
  const {transport,context,facts,svc}=fixture();
  for(const [i,kind] of ['text','image','sticker','voice','poke','file'].entries()){
    if(i===1){await assert.rejects(transport.perform({key:'private:1',context,kind,send:async()=>{throw Object.assign(Error('rejected'),{knownFailed:true});}}));continue;}
    if(i>3){await assert.rejects(transport.perform({key:'private:1',context,kind,send:async()=>({message_id:i})}),/turn_limit/);continue;}
    await transport.perform({key:'private:1',context,kind,send:async()=>({message_id:i})});
  }
  const sent=facts.filter(x=>x.s==='mood'&&x.m==='sent');assert.equal(sent.length,3);
  assert.ok(sent.every(x=>x.p.proactiveId==='round'&&x.p.expectsReply));assert.equal(new Set(sent.map(x=>x.p.deliveryId)).size,3);
  assert.equal(svc.preview({key:'private:1',now:1000}).successful,3);
});
test('unknown outcome never reports success and retains reservation',async()=>{
  const {transport,context,facts,svc}=fixture();
  await assert.rejects(transport.perform({key:'private:1',context,kind:'voice',send:async()=>{throw Error('timeout');}}));
  assert.equal(facts.filter(x=>x.m==='sent').length,0);assert.equal(svc.preview({key:'private:1',now:1000}).inflight,1);
});
test('async scope retains source turn across awaits and later active changes',async()=>{
  const {transport,context,facts}=fixture();
  await outboundScope.run(context,async()=>{await Promise.resolve();await transport.perform({key:'private:1',send:async()=>({message_id:1})});});
  assert.equal(facts.find(x=>x.s==='mood'&&x.m==='sent').p.proactiveId,'round');
});
test('human metadata dispatch precedes quota caller and passes true episode reengagement',()=>{
  const calls=[];reportHumanIncoming((s,m,p)=>{calls.push({s,m,p});return {reengaged:true};},{key:'group:1',messageId:'q',hasImage:true,hasText:false,isSelf:false,directedAtBot:false,at:1000});
  assert.deepEqual(calls.map(x=>x.s+'.'+x.m),['proactive.observe','mood.incoming','proactive.refresh']);
  assert.equal(calls[1].p.reengaged,true);assert.equal(calls[1].p.directedAtBot,false);assert.equal('text' in calls[1].p,false);
});
test('real bridge initializes canonical services and freezes before prompt construction',async t=>{
  const h=await bridgeHarness({files:{'state/plugins/config/ctx-chat-reply-shape.json':{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0}}});
  t.after(()=>h.close());h.setMode('reserved2');
  const key='private:123',st=h.getSocialV2State(key);st.bootstrapSent=true;
  await h.deliverPrompt(key,'hello',{wakeReason:'private'});
  assert.ok(h.calls.prompts.length);
  assert.match(JSON.stringify(h.calls.prompts.at(-1)),/全部文字、图片、语音和表情合计/);
  assert.equal(typeof h.taskCaps.getProactiveFacts,'function');
  assert.equal(h.taskCaps.getProactiveFacts(key).busy,true,'accepted envelope is busy before turn/start');
});
async function httpFixture(t,extra={}) {
  const h=await bridgeHarness({config:{allow:{private:['123','124'],groups:['456']},sendDelayMs:0,...extra},files:{
    'state/plugins/config/ctx-chat-reply-shape.json':{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},
    'state/plugins/config/life-wake-reasons.json':{curfewEnabled:false}}});
  h.setMode('reserved2');const key='private:123',st=h.getSocialV2State(key);st.bootstrapSent=true;
  const sid=await h.ensureSession(key);
  const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await h.close();});
  const post=async(route,body,token=st.agentToken)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token',...(token?{'x-agent-call':'1','x-agent-token':token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  function turn(reason='private',cap=3) {
    const actionId='turn-'+Math.random(),mood={replyCeiling:cap,enabled:true,mode:'normal',welcomeBurstActive:true};
    const replyPlan=h.pluginHost.callService('replyPlan','resolve',{key,turnId:actionId,incomingText:'你好',mood});
    const envelope={key,sessionId:sid,reason,actionId,replyPlan,mood};
    h.activeTurnEnvelopes.set(sid,envelope);return envelope;
  }
  const get=async route=>{const r=await fetch('http://127.0.0.1:'+server.address().port+route,{headers:{'x-console-token':'fixture-console-token','x-agent-token':st.agentToken}});return {status:r.status,body:await r.json()};};
  return {h,key,st,sid,post,get,turn};
}
test('real tools share cumulative cap across text/poke, reject absent turn, preserve actual fact IDs',async t=>{
  const {h,key,post,turn}=await httpFixture(t);
  let r=await post('/api/socialV2/send-message',{key,messages:'no turn'});assert.equal(r.body.ok,false);
  const e=turn('proactiveCheck');
  for(const i of [1,2]){r=await post('/api/socialV2/send-message',{key,messages:'part'+i,conversationIntent:i===2?'newTopic':'followup',topicId:'topic'});assert.equal(r.body.ok,true,JSON.stringify(r));}
  r=await post('/api/socialV2/send-poke',{key});assert.equal(r.body.ok,true,JSON.stringify(r));
  r=await post('/api/socialV2/send-message',{key,messages:'fourth'});assert.equal(r.body.ok,false);
  const ledger=h.pluginHost.get('ctx-user-mood').state.mood;
  assert.equal(Object.keys(ledger.waits||{}).length,1);
  assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).successful,3);
  assert.equal(h.pluginHost.callService('proactive','preview',{key}).stage,0);
  assert.ok(e.replyPlan.maxMessages===3);
});
test('mood and willingness require exact current session token; willingness-only leaves read/wake state intact',async t=>{
  const {h,key,st,post}=await httpFixture(t);h.getSocialV2State('private:124');
  let r=await post('/api/socialV2/mood',{key:'private:124',action:'add',value:1,reason:'test'});assert.equal(r.status,403);
  for(const reason of [undefined,'   ',12,'x'.repeat(501)]){r=await post('/api/socialV2/mood',{key,action:'add',value:1,reason});assert.equal(r.status,400);}
  r=await post('/api/socialV2/mood',{key,action:'add',value:1,reason:'context'});assert.equal(r.body.ok,true,JSON.stringify(r));
  const before=JSON.stringify(st.wakeConfig);
  r=await post('/api/socialV2/wake-config',{key,chatWillingness:0,reason:'closing'});assert.equal(r.body.ok,true,JSON.stringify(r));assert.equal(JSON.stringify(st.wakeConfig),before);
  assert.equal(h.pluginHost.callService('proactive','preview',{key}).willingness,0);
  r=await post('/api/socialV2/wake-config',{key:'private:124',chatWillingness:100});assert.equal(r.status,403);
  h.cfg.socialV2.tools.mood=false;
  r=await post('/api/socialV2/mood',{key,action:'dec',value:1,reason:'context'});assert.equal(r.status,403);
});


test('real OneBot leaf shares file/image/poke cap and reports successes exactly once',async t=>{
 const {h,key,turn}=await httpFixture(t);const envelope=turn('proactiveCheck');
 const c=h.outboundContext(key,{wakeOrigin:envelope});
 await outboundScope.run(c,async()=>{
  await h.onebotHttpAction('upload_private_file',{user_id:123,file:'fixture.pdf',name:'fixture.pdf'});
  await h.onebotHttpAction('send_private_msg',{user_id:123,message:[{type:'image',data:{file:'fixture.png'}}]});
  await h.onebotHttpAction('send_poke',{user_id:123});
  await assert.rejects(h.onebotHttpAction('send_custom_face',{user_id:123,emoji_id:'fixture'}),/turn_limit/);
 });
 assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).successful,3);
 const m=h.pluginHost.get('ctx-user-mood').state.mood;
 assert.equal(Object.keys(m.waits).length,1);assert.equal(Object.keys(m.deliveries).length,3);
});
test('raw image while paused does not trigger an extra daily recovery or model delivery',async t=>{
 const {h,key}=await httpFixture(t);h.setSelfIdentity('bot','9');
 for(let i=0;i<3;i++)h.pluginHost.callService('mood','adjust',{key,action:'dec',value:20,reason:'fixture'});
 assert.equal(h.pluginHost.callService('mood','read',{key}).score,0);
 h.socialV2.paused=true;
 await h.handleIncoming('private',123,{message_id:'raw-image',user_id:123,self_id:9,sender:{nickname:'person'},message:[{type:'image',data:{file:'fixture-image'}}]},h.cfg);
 assert.equal(h.pluginHost.callService('mood','read',{key}).score,0);
 assert.equal(h.calls.prompts.length,0);
});
test('observation-only timeout cannot send without actual incoming; queued pause rejects physical send',async t=>{
 const {h,key,turn,post}=await httpFixture(t);turn('timeout');
 assert.equal((await post('/api/socialV2/send-message',{key,messages:'unprompted'})).body.ok,false);
 turn('private');h.socialV2.paused=true;
 assert.equal((await post('/api/socialV2/send-poke',{key})).body.ok,false);
 assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).successful,0);
});
test('informational notices do not create waits; direct conversational time bubble does',async t=>{
 const {h,key}=await httpFixture(t),now=Date.now();
 assert.equal((await h.taskCaps.sendNotificationDetailed(key,'notice',{id:'notice',sourceAt:now,expiresAt:now+60000,reason:'reminder'})).ok,true);
 assert.equal(Object.keys(h.pluginHost.get('ctx-user-mood').state.mood?.waits||{}).length,0);
 assert.equal((await h.taskCaps.sendNotificationDetailed(key,'checking in',{id:'bubble',sourceAt:now,expiresAt:now+60000,reason:'timeBubble'})).ok,true);
 assert.equal(Object.keys(h.pluginHost.get('ctx-user-mood').state.mood.waits).length,1);
});


test('actual turn/end releases accepted proactive opportunity even with no output',async t=>{
 const {h,key,sid}=await httpFixture(t);const call=h.pluginHost.callService.bind(h.pluginHost),finished=[];
 h.pluginHost.callService=(service,method,args)=>{if(service==='proactive'&&method==='finished')finished.push(args);return call(service,method,args);};
 await h.deliverPrompt(key,'',{wakeReason:'proactiveCheck'});
 const event=(type,data)=>({payload:{type:'session/event',sessionId:sid,event:{type,data}}});
 await h.queueDshEnvelope(event('turn/start',{turn:71}));
 await h.queueDshEnvelope(event('turn/end',{turn:71,reason:{kind:'completed'}}));
 assert.equal(finished.length,1);assert.equal(finished[0].key,key);
 assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).successful,0);
 assert.equal(Object.keys(h.pluginHost.get('ctx-user-mood').state.mood?.waits||{}).length,0);
});
test('real voice and sticker success points report once each despite shared gateway queries',async t=>{
 const h=await bridgeHarness({globals:{inspectAudio:async()=>({ok:true,size:100,duration:1,codec:'pcm',warnings:[]})},
 files:{'state/plugins/config/ctx-chat-reply-shape.json':{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},'state/plugins/config/life-wake-reasons.json':{curfewEnabled:false}}});
 t.after(()=>h.close());h.setMode('reserved2');const key='private:123';
 const replyPlan=h.pluginHost.callService('replyPlan','resolve',{key,turnId:'media-turn',incomingText:'hi',mood:{replyCeiling:3,welcomeBurstActive:true}});
 const envelope={key,actionId:'media-turn',reason:'proactiveCheck',replyPlan};const c=h.outboundContext(key,{wakeOrigin:envelope});
 h.bot.request=async action=>action==='fetch_custom_face_detail'?{status:'ok',retcode:0,data:[{emoji_id:'fixture-sticker',resId:'fixture-sticker',url:'https://public.invalid/sticker'}]}:{status:'ok',retcode:0,data:{}};
 await outboundScope.run(c,async()=>{
  await h.sendVoiceV2(key,'fixture.wav',{guard:true,audit:false});
  await h.sendStickerV2(key,'fixture-sticker');
 });
 assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).successful,2);
 const m=h.pluginHost.get('ctx-user-mood').state.mood;assert.equal(Object.keys(m.deliveries).length,2);assert.equal(Object.keys(m.waits).length,1);
 assert.equal(h.calls.http.filter(x=>x.url.endsWith('/send_private_msg')||x.url.endsWith('/send_custom_face')).length,2);
});


test('obsolete independent voice quotas are rejected by configuration API',async t=>{
 const h=await bridgeHarness();t.after(()=>h.close());const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/config',{method:'POST',headers:{'x-console-token':'fixture-console-token','content-type':'application/json'},body:JSON.stringify({voice:{maxPerMinute:2,maxPerHour:10}})});
 assert.equal(r.status,400);assert.equal('maxPerMinute' in h.cfg.socialV2.voice,false);
});


test('physical text length cannot exceed the frozen maximum even for an atomic long URL',async()=>{
 const {transport,context,svc}=fixture();
 await assert.rejects(transport.perform({key:'private:1',context,kind:'text',text:'https://example.invalid/'+ 'x'.repeat(600),send:async()=>({message_id:1})}),/message_length/);
 assert.equal(svc.preview({key:'private:1',now:1000}).successful,0);
});


test('direct notice rechecks expiry after shared spacing wait immediately before SDK send',async t=>{
 const {h,key}=await httpFixture(t);
 assert.equal(h.pluginHost.setConfig('ctx-chat-reply-shape',{intervalMinMs:120,intervalMaxMs:120,longGapProbability:0}).ok,true);await h.pluginHost.reload('ctx-chat-reply-shape');
 let now=Date.now();assert.equal((await h.taskCaps.sendNotificationDetailed(key,'first',{id:'spacing-first',sourceAt:now,expiresAt:now+60000})).ok,true);
 now=Date.now();const second=await h.taskCaps.sendNotificationDetailed(key,'expired',{id:'spacing-expired',sourceAt:now,expiresAt:now+30});
 assert.equal(second.ok,false);assert.equal(h.calls.sent.length,1);
});


test('relay does not claim delivery when its SDK text write failed',async t=>{
 const {h}=await httpFixture(t);h.bot.sendGroupMessage=async()=>{throw Object.assign(Error('rejected'),{knownFailed:true});};
 const result=await h.taskCaps.relaySend({fromKey:'private:123',targetKey:'group:456',body:'fixture relay'});
 assert.equal(result.ok,false);assert.equal(h.pluginHost.callService('replyPlan','preview',{key:'group:456'}).successful,0);
});


for(const targetKind of ['mention','quote','poke'])test('group actual '+targetKind+' target can answer without mentioning bot; other users cannot',async t=>{
 const {h,post}=await httpFixture(t);h.setSelfIdentity('bot','9');const key='group:456',sid=await h.ensureSession(key),st=h.getSocialV2State(key);
 const actionId='target-'+targetKind,replyPlan=h.pluginHost.callService('replyPlan','resolve',{key,turnId:actionId,incomingText:'hi',mood:{replyCeiling:3,welcomeBurstActive:true}});
 h.activeTurnEnvelopes.set(sid,{key,sessionId:sid,actionId,reason:'proactiveCheck',replyPlan});
 h.bot.getGroupMemberList=async()=>[{user_id:123},{user_id:222}];
 h.bot.getMessage=async id=>({message_id:id,group_id:456,user_id:123,sender:{user_id:123,nickname:'person'},message:[{type:'text',data:{text:'hello'}}]});
 const body=targetKind==='poke'?{key,targetUserId:'123'}:{key,messages:'how are you?',...(targetKind==='mention'?{atUserId:'123'}:{replyToMessageId:'987'})};
 const sent=await post(targetKind==='poke'?'/api/socialV2/send-poke':'/api/socialV2/send-message',body,st.agentToken);assert.equal(sent.body.ok,true,JSON.stringify(sent));
 const readWait=()=>Object.values(h.pluginHost.get('ctx-user-mood').state.mood.waits).find(x=>x.key===key);
 assert.equal(readWait().targetUserId,'123');
 const incoming=async user=>h.handleIncoming('group',456,{message_id:'target-'+targetKind+'-'+user,user_id:user,self_id:9,sender:{nickname:'person'},message:[{type:'text',data:{text:'plain response'}}]},h.cfg);
 await incoming(222);assert.equal(readWait().answeredAt,null);
 await incoming(123);assert.ok(readWait().answeredAt>0);
});
test('optional mood and proactive owners may be disabled at startup without disabling reply transport',async t=>{
 const h=await bridgeHarness({files:{'state/plugins/registry.json':{disabled:['ctx-user-mood','life-wake-reasons']}}});t.after(()=>h.close());h.setMode('reserved2');
 await h.deliverPrompt('private:123','ordinary');assert.equal(h.calls.prompts.length,1);
});


test('real multipart group send acquires only its first explicit target after the target part succeeds',async t=>{
 const {h,post}=await httpFixture(t);h.setSelfIdentity('bot','9');const key='group:456',sid=await h.ensureSession(key),st=h.getSocialV2State(key),actionId='multipart-target';
 const replyPlan=h.pluginHost.callService('replyPlan','resolve',{key,turnId:actionId,incomingText:'hi',mood:{replyCeiling:3,welcomeBurstActive:true}});
 h.activeTurnEnvelopes.set(sid,{key,sessionId:sid,actionId,reason:'proactiveCheck',replyPlan});
 const send=async extra=>{const result=await post('/api/socialV2/send-message',{key,messages:'hello',...extra},st.agentToken);assert.equal(result.body.ok,true,JSON.stringify(result));};
 const readWait=()=>Object.values(h.pluginHost.get('ctx-user-mood').state.mood.waits).find(x=>x.key===key);
 const incoming=async(user,id)=>h.handleIncoming('group',456,{message_id:id,user_id:user,self_id:9,sender:{nickname:'person'},message:[{type:'text',data:{text:'ordinary response'}}]},h.cfg);
 await send({});assert.equal(readWait().targetUserId,null);
 await incoming(123,'before-target');await new Promise(resolve=>setTimeout(resolve,5));
 await send({atUserId:'123'});assert.equal(readWait().targetUserId,'123');assert.equal(readWait().answeredAt,null);
 const targetFromAt=readWait().targetFromAt;
 await send({atUserId:'222'});assert.equal(readWait().targetUserId,'123');assert.equal(readWait().targetFromAt,targetFromAt);
 await incoming(222,'other-target');assert.equal(readWait().answeredAt,null);
 await incoming(123,'right-target');assert.ok(readWait().answeredAt>=targetFromAt);
 assert.equal(readWait().deliveryIds.length,3);
});


test('prompt inspection has explicit absent plan and canonical topic config, and obsolete gap mode is rejected',async t=>{
 const {h,key,get,post,turn}=await httpFixture(t);
 let result=await get('/api/socialV2/prompt?key='+encodeURIComponent(key));assert.equal(result.status,200);assert.equal(result.body.replyShape,null);
 assert.deepEqual(result.body.conversationDrive,h.pluginHost.get('ctx-chat-topic-drive').config);
 const envelope=turn();result=await get('/api/socialV2/prompt?key='+encodeURIComponent(key));assert.deepEqual(result.body.replyShape,{kind:envelope.replyPlan.kind,maxMessages:envelope.replyPlan.maxMessages});
 result=await post('/api/socialV2/send-message',{key,messages:'fixture',gapMode:'byLength'});assert.equal(result.status,400);assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).successful,0);
});


for(const addressedBy of ['name','at','quote'])test('review1: group wait ignores second-person/model/owner chatter and accepts actual '+addressedBy,async t=>{
 const {h,post}=await httpFixture(t);h.setSelfIdentity('AI助手','9');const key='group:456',sid=await h.ensureSession(key),st=h.getSocialV2State(key),actionId='direct-evidence-'+addressedBy;
 const replyPlan=h.pluginHost.callService('replyPlan','resolve',{key,turnId:actionId,incomingText:'hi',mood:{replyCeiling:3}});
 h.activeTurnEnvelopes.set(sid,{key,sessionId:sid,actionId,reason:'proactiveCheck',replyPlan});
 const sent=await post('/api/socialV2/send-message',{key,messages:'hello group'},st.agentToken);assert.equal(sent.body.ok,true,JSON.stringify(sent));
 h.socialV2.paused=true;
 const read=()=>Object.values(h.pluginHost.get('ctx-user-mood').state.mood.waits).find(x=>x.key===key);
 const incoming=async(message,user=222,id=String(Math.random()))=>h.handleIncoming('group',456,{message_id:id,user_id:user,self_id:9,sender:{nickname:'human'},message},h.cfg);
 for(const [text,user] of [['你有空吗',222],['你是人类还是AI',222],['ChatGPT比Claude强吗',222],['回我',222],['普通群聊',123]]){
   await incoming([{type:'text',data:{text}}],user);assert.equal(read().answeredAt,null,text);
 }
 h.bot.getMessage=async id=>({message_id:id,group_id:456,user_id:9,sender:{user_id:9,nickname:'AI助手'},message:[{type:'text',data:{text:'my previous message'}}]});
 const message=addressedBy==='name'?[{type:'text',data:{text:'AI助手，下午好'}}]:addressedBy==='at'?[{type:'at',data:{qq:'9'}},{type:'text',data:{text:'下午好'}}]:[{type:'reply',data:{id:'900'}},{type:'text',data:{text:'下午好'}}];
 await incoming(message);assert.ok(read().answeredAt>0);assert.equal(h.calls.prompts.length,0);
});

test('review1: enabled slang submit route stores two candidates then enforces its independent minute cap',async t=>{
 const {h,key,post}=await httpFixture(t);h.cfg.slang={...h.cfg.slang,enabled:true,autoResearch:false};
 for(const content of ['隔离词甲','隔离词乙']){const result=await post('/api/socialV2/slang/submit',{key,content,context:'isolated fixture'});assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.entry.content,content);}
 const limited=await post('/api/socialV2/slang/submit',{key,content:'隔离词丙'});assert.equal(limited.status,429);assert.equal(h.calls.prompts.length,0);
});

test('review1: console test-send sends to private and group with shared physical accounting',async t=>{
 const {h,post}=await httpFixture(t);
 for(const [kind,id] of [['private',123],['group',456]]){
   const result=await post('/api/test-send',{kind,id,message:'isolated operator fixture'},'');assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.ok,true);
   assert.equal(h.pluginHost.callService('replyPlan','preview',{key:kind+':'+id}).successful,1);
 }
 assert.equal(h.calls.sent.length,2);assert.equal(Object.keys(h.pluginHost.get('ctx-user-mood').state.mood?.waits||{}).length,0);
});

test('review1: hot enabling a startup-disabled send owner restores proactive scheduling without restart',async t=>{
 const h=await bridgeHarness({files:{'state/plugins/registry.json':{disabled:['ctx-chat-reply-shape']},'state/plugins/config/life-wake-reasons.json':{curfewEnabled:false}}});t.after(()=>h.close());h.setMode('reserved2');
 const key='private:123';h.getSocialV2State(key);assert.equal(h.taskCaps.getProactiveFacts(key).allowed,false);
 assert.equal(h.pluginHost.setEnabled('ctx-chat-reply-shape',true).ok,true);await h.pluginHost.reload('ctx-chat-reply-shape');
 assert.equal(h.pluginHost.hasService('replyPlan','reserve'),true);assert.equal(h.taskCaps.getProactiveFacts(key).allowed,true);
 const preview=h.pluginHost.callService('proactive','preview',{key});assert.ok(Number.isFinite(preview.nextAt),'host-change callback reschedules automatically');
 const refreshed=h.pluginHost.callService('proactive','refresh',{key});assert.equal(refreshed.allowed,true,JSON.stringify(refreshed));
 h.pluginHost.setEnabled('ctx-chat-reply-shape',false);await h.pluginHost.reload('ctx-chat-reply-shape');assert.equal(h.taskCaps.getProactiveFacts(key).allowed,false);
});

test('review1: actual wake prompt renders reason tail and daily Bilibili branch from shared facts',async t=>{
 const {h,key,st}=await httpFixture(t);
 const tail=h.buildWakePromptV2(key,'replyCheck');assert.match(tail,/【回复检查】/);assert.match(tail,/你刚刚发送过消息/);
 h.cfg.socialV2.dailyNews={...h.cfg.socialV2.dailyNews,keywords:['fixture科学'],maxItems:1};
 st.pendingBiliShare={items:[{bvid:'BV1xx411c7mD',title:'fixture视频',uploader:'fixture作者',description:'fixture简介'}]};
 const news=h.buildWakePromptV2(key,'newsShare');assert.match(news,/【每日 B 站视频推荐】/);assert.match(news,/fixture视频/);assert.match(news,/fixture作者/);assert.match(news,/BV1xx411c7mD/);assert.match(news,/每个推荐名额已独立抽签/);assert.doesNotMatch(news,/必须调用 bili_search|本轮唯一任务：哔站/);
 const collect=h.pluginHost.collectWakeTails;h.pluginHost.collectWakeTails=()=>{throw Error('fixture wake assembly error');};
 try{assert.doesNotThrow(()=>h.buildWakePromptV2(key,'replyCheck'));}finally{h.pluginHost.collectWakeTails=collect;}
 assert.match(fs.readFileSync(path.join(h.temp,'state/bridge.log'),'utf8'),/唤醒尾巴装配失败.*fixture wake assembly error/);
 assert.equal(h.calls.prompts.length,0);
});
