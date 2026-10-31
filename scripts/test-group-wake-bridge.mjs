import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness,fixtureReplyTurn} from './audit-bridge-harness.mjs';
async function fixture(run,files={}){const h=await bridgeHarness({files,config:{socialV2:{wake:{preSleepWaitEnabled:false,maxWakePerMinute:0,maxWakePerHour:0}}}});try{h.setMode('reserved2');h.pluginHost.setConfig('life-wake-reasons',{initialProbability:0,probabilityStep:0,probabilityMax:1,groupAtBonus:0,groupNameBonus:0,groupQuestionBonus:0,groupPokeBonus:0,groupNames:'AI助手',curfewEnabled:false});await h.pluginHost.reload('life-wake-reasons');await run(h);}finally{await h.close();}}
const event=(id,kind='group',text='普通来信')=>({post_type:'message',message_type:kind,self_id:999,user_id:123,group_id:kind==='group'?456:undefined,message_id:id,message:[{type:'text',data:{text}}],sender:{nickname:'fixture'},raw_message:text});
test('first group arrival cannot bypass a zero probability; private still wakes',async()=>fixture(async h=>{await h.handleIncoming('group',456,event('one'),h.cfg);await new Promise(r=>setTimeout(r,100));assert.equal(h.getSocialV2State('group:456').bootstrapSent,false);await h.handleIncoming('private',123,event('two','private'),h.cfg);assert.equal(h.getSocialV2State('private:123').bootstrapSent,true);}));

test('awake group receives follow-up without another lottery; closed wait immediately restores opening probability',async()=>fixture(async h=>{
 const key='group:456',sid=await fixtureReplyTurn(h,key);assert.equal(h.taskCaps.getProactiveFacts(key).conversationAwake,true);
 await h.handleIncoming('group',456,event('followup','group','接着说刚才的事'),h.cfg);const awake=h.pluginHost.callService('proactive','preview',{key}).lastIncomingDecision;assert.equal(awake.phase,'conversation');assert.equal(awake.accepted,true);assert.equal(awake.probability,1);
 const envelope=h.activeTurnEnvelopes.get(sid);envelope.waitRoundClosed=true;envelope.cancelled=true;
 assert.equal(h.taskCaps.getProactiveFacts(key).conversationAwake,false,'pending cancellation is not an open conversation');
 await h.handleIncoming('group',456,event('after-close','group','普通群聊来信'),h.cfg);const closed=h.pluginHost.callService('proactive','preview',{key}).lastIncomingDecision;assert.equal(closed.phase,'initiation');assert.equal(closed.probability,0);assert.equal(closed.accepted,false);
}));
test('group incoming ignores old per-session triggers',async()=>fixture(async h=>{const key='group:456',st=h.getSocialV2State(key);st.wakeConfig.triggers={anyMessage:true,probability:1};await h.handleIncoming('group',456,event('one'),h.cfg);assert.equal(st.bootstrapSent,false);const result=h.pluginHost.callService('proactive','preview',{key});assert.equal(result.stage,0);}));

test('real incoming uses stage probability plus wake bonus only when opening a conversation',async()=>fixture(async h=>{
 const key='group:456';h.pluginHost.setConfig('life-wake-reasons',{initialProbability:.2,probabilityStep:.1,groupNameBonus:1});await h.pluginHost.reload('life-wake-reasons');
 await h.handleIncoming('group',456,event('stage','group','AI助手你好'),h.cfg);
 const p=h.pluginHost.callService('proactive','preview',{key});assert.equal(p.stage,0);assert.equal(p.lastIncomingDecision.extraProbability,1);assert.equal(p.lastIncomingDecision.probability,1);assert.equal(p.lastIncomingDecision.accepted,true);assert.equal(h.getSocialV2State(key).bootstrapSent,true);
},{'state/plugins/life-wake-reasons.json':{proactiveByKey:{'group:456':{stage:3,willingness:100}}},'state/plugins/ctx-user-mood.json':{}}));
test('first poke obeys probability, adds q only for bot target, and does not fake a text mood recovery',async()=>fixture(async h=>{
 const poke=(id,target)=>({sub_type:'poke',self_id:999,sender_id:123,target_id:target,group_id:456,message_id:id});
 await h.handlePokeNotice(poke('other',888));assert.equal(h.getSocialV2State('group:456').bootstrapSent,false);
 h.pluginHost.setConfig('life-wake-reasons',{groupPokeBonus:1});await h.pluginHost.reload('life-wake-reasons');
 await h.handlePokeNotice(poke('bot',999));assert.equal(h.getSocialV2State('group:456').bootstrapSent,true);assert.equal(h.pluginHost.callService('proactive','preview',{key:'group:456'}).lastIncomingDecision.extraProbability,1);
}));
test('retired global and tool-level triggers are rejected; new q validates through real host',async()=>fixture(async h=>{
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 const post=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token'},body:JSON.stringify(body)});await r.json();return r.status;};
 try{assert.equal(await post('/api/socialV2/config',{wake:{recommendedProbability:1}}),400);assert.equal(await post('/api/socialV2/wake-config',{key:'group:456',config:{triggers:{anyMessage:true}}}),400);assert.equal(h.pluginHost.setConfig('life-wake-reasons',{groupAtBonus:1.01}).ok,false);}
 finally{server.closeAllConnections?.();await new Promise(r=>server.close(r));}
}));

test('rendered nickname of another mentioned member cannot masquerade as an admin bot name',async()=>fixture(async h=>{
 h.pluginHost.setConfig('life-wake-reasons',{groupNameBonus:1});await h.pluginHost.reload('life-wake-reasons');h.bot.getGroupMemberInfo=async()=>({nickname:'AI助手'});
 const e=event('other-mention','group','午饭好');e.message.unshift({type:'at',data:{qq:888}});await h.handleIncoming('group',456,e,h.cfg);
 assert.equal(h.getSocialV2State('group:456').bootstrapSent,false);assert.equal(h.pluginHost.callService('proactive','preview',{key:'group:456'}).lastIncomingDecision.extraProbability,0);
}));
