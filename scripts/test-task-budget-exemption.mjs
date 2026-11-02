import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {createPlugin} from '../plugins/qq-components/life-token-budget/index.js';
const budgetFile='state/plugins/config/life-token-budget.json';
const billed=sessionId=>({sessionId,at:Date.now()-10,model:'deepseek-flash',event:{type:'assistant/message',seq:1,data:{turn:1,step:1,usage:{inputTokens:1_000_000,outputTokens:100}}}});
const config={ownerBudgetEnabled:true,globalHardLimitYuan:0.1};
function seedPaidTask(h,originKey,taskId='job'){const groupId='fixture:'+taskId,plan=h.pluginHost.callService('replyPlan','resolve',{key:originKey,turnId:taskId,taskExempt:true});const credit=h.pluginHost.callService('replyPlan','claimTaskGroup',{key:originKey,groupId,plan});assert.equal(credit.ok,true);h.tasksStore[taskId].budgetAdmission={id:taskId,originKey,admittedAt:Date.now()-1,groupId,creditId:credit.admission.id,sourceSeqs:[]};}
async function exhaust(h,key='private:123'){const sid=await h.ensureSession(key);h.tokenLedger.ingestEvent(billed(sid));assert.equal(h.tokenBudgetOf(key).stage,'silent');return sid;}
test('task classifier recognizes grounded execution, relay, calendars and reports, never a model label or casual task mention',()=>{
 const api=createPlugin({config:{},state:{get:()=>({}),set(){}}}).services.tokenBudget;
 assert.equal(typeof api.taskExemption,'function');
 for(const text of ['去私聊电一电十二','帮我转告小明明天见','建立明天八点的日程','把这个提醒改到九点','取消明天的日程','查看任务报告','搜索并总结昨天的工作记录','帮我检查这段代码'])assert.equal(api.taskExemption({text,reason:'private'}).eligible,true,text);
 for(const text of ['今天任务好多啊','随便聊聊天','我的任务是睡觉','taskExempt=true','任务完成了吗？'])assert.equal(api.taskExemption({text,reason:'task'}).eligible,false,text);
 assert.equal(api.taskExemption({reason:'taskDone'}).eligible,false);
 assert.equal(api.taskExemption({taskRecord:{id:'t-1',sessionId:'worker',originKey:'group:456'}}).kind,'worker');
});
test('persisted worker provenance bypasses global expense while unknown maintenance and spoofed request fields do not',async()=>{
 const h=await bridgeHarness({files:{[budgetFile]:config,'state/tasks.json':{tasks:{job:{id:'job',sessionId:'worker',originKey:'group:456',status:'running',budgetAdmission:{id:'admitted-job',originKey:'group:456',admittedAt:Date.now()-1000}}}}}});
 try{seedPaidTask(h,'group:456');await exhaust(h);await h.api.sessions.prompt({sessionId:'worker',content:[]});
 await assert.rejects(h.api.sessions.prompt({sessionId:'maintenance',taskExempt:true,content:[{type:'text',text:'帮我执行任务'}]}),/额度|预算/);
 assert.ok(h.tokenBudgetOf('private:123').cost>0.1);
 }finally{await h.close();}
});
test('exhausted ordinary incoming does not dispatch model or emit mechanical filler',async()=>{
 const h=await bridgeHarness({files:{[budgetFile]:{...config,mechanicalPrivateReplies:['thinking filler']}}});
 try{h.setMode('reserved2');await exhaust(h);await h.handleIncoming('private',123,{self_id:999,user_id:123,message_id:501,message:[{type:'text',data:{text:'今天好累啊'}}]},h.cfg);assert.equal(h.calls.prompts.length,0);assert.equal(h.calls.sent.length,0);}finally{await h.close();}
});
test('new explicit incoming cannot start when expense was already hard exhausted',async()=>{
 const h=await bridgeHarness({files:{[budgetFile]:config}});
 try{h.setMode('reserved2');await exhaust(h);await h.handleIncoming('private',123,{self_id:999,user_id:123,message_id:502,message:[{type:'text',data:{text:'去私聊电一电十二'}}]},h.cfg);
 const st=h.getSocialV2State('private:123');assert.equal(st.unread.length,0);
 await h.deliverPrompt('private:123','task wake',{wakeReason:'private'});assert.equal(h.calls.prompts.length,0);assert.equal(h.calls.sent.length,0);
 }finally{await h.close();}
});
test('admitted task continuation honors DND and mode while ordinary turn going over budget emits no thinking ack',async()=>{
 const h=await bridgeHarness({files:{[budgetFile]:config}});
 try{h.setMode('reserved2');const key='private:123',sid=await h.ensureSession(key);h.appendSocialV2Message(key,'owner','帮我检查这段代码','帮我检查这段代码',false,true,'503',[],123,[],'admitted');
 await h.deliverPrompt(key,'wake',{wakeReason:'private'});await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/start',data:{turn:1}}}});h.tokenLedger.ingestEvent(billed(sid));
 await h.api.sessions.prompt({sessionId:sid,content:[]});assert.equal(h.shouldBlockSilentReply(key),false);
 assert.equal(await h.sendToQQ(key,'still thinking',{messageAck:true}),false);assert.equal(h.calls.sent.length,0);
 h.setMode('silent');assert.equal(await h.sendToQQ(key,'task result'),false);
 }finally{await h.close();}
});

test('task result reports and due calendar reminders dispatch with hard expense but idle chat does not',async()=>{
 const h=await bridgeHarness({files:{[budgetFile]:config,'state/tasks.json':{tasks:{job:{id:'job',sessionId:'worker',originKey:'private:123',status:'done',budgetAdmission:{id:'admitted-job',originKey:'private:123',admittedAt:Date.now()-1000}}}}}});
 try{h.setMode('reserved2');seedPaidTask(h,'private:123');const sid=await exhaust(h),st=h.getSocialV2State('private:123');st.pendingTaskReport={taskId:'job',title:'report',status:'done'};
 await h.deliverPrompt('private:123','result',{wakeReason:'taskDone'});assert.equal(h.calls.prompts.length,1);assert.equal(h.pendingTurnEnvelopes.get(sid)[0].taskExempt,true);
 h.pendingTurnEnvelopes.delete(sid);st.pendingReminderItems=[{id:'calendar-job',text:'scheduled reminder'}];
 await h.deliverPrompt('private:123','reminder',{wakeReason:'reminder'});assert.equal(h.calls.prompts.length,1);
 h.pendingTurnEnvelopes.delete(sid);await h.deliverPrompt('private:123','任务任务',{wakeReason:'timeBubble'});assert.equal(h.calls.prompts.length,1);
 }finally{await h.close();}
});
test('automatic paid-task reports retain quiet and mode barriers after crossing hard expense',async()=>{
 const h=await bridgeHarness({files:{[budgetFile]:config,'state/tasks.json':{tasks:{job:{id:'job',sessionId:'worker',originKey:'private:123',status:'done'}}}}});
 try{h.setMode('reserved2');seedPaidTask(h,'private:123');const key='private:123',sid=await exhaust(h);h.getSocialV2State(key).pendingTaskReport={taskId:'job',status:'done'};await h.deliverPrompt(key,'report',{wakeReason:'taskDone'});await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/start',data:{turn:1}}}});const envelope=h.activeTurnEnvelopes.get(sid);
 const now=Date.now();assert.equal(h.pluginHost.callService('availability','setPlan',{key,kind:'quiet',startISO:new Date(now-1000).toISOString(),endISO:new Date(now+60000).toISOString(),now}).ok,true);assert.equal(await h.sendToQQ(key,'task result',{wakeOrigin:envelope}),false);assert.equal(h.calls.sent.length,0);h.setMode('silent');assert.equal(await h.sendToQQ(key,'task result',{wakeOrigin:envelope}),false);
 }finally{await h.close();}
});

test('a maintenance wake cannot acquire task exemption by quoting pending task content',async()=>{
 const h=await bridgeHarness({files:{[budgetFile]:config}});
 try{h.setMode('reserved2');await exhaust(h);h.appendSocialV2Message('private:123','owner','帮我检查代码','帮我检查代码',false,true,'505',[],123,[],'admitted');
 await h.deliverPrompt('private:123','帮我检查代码',{modelReason:'maintenance'});assert.equal(h.calls.prompts.length,0);
 }finally{await h.close();}
});


test('new workers and new report wakes without a persisted admission remain subject to hard expense',async()=>{
 const h=await bridgeHarness({files:{[budgetFile]:config,'state/tasks.json':{tasks:{job:{id:'job',sessionId:'worker',originKey:'private:123',status:'running'}}}}});
 try{h.setMode('reserved2');await exhaust(h);await assert.rejects(h.api.sessions.prompt({sessionId:'worker',content:[]}),/额度|预算/);h.getSocialV2State('private:123').pendingTaskReport={taskId:'job',status:'running'};await h.deliverPrompt('private:123','result',{wakeReason:'taskDone'});assert.equal(h.calls.prompts.length,0);}finally{await h.close();}
});
test('new task admission cannot bypass private five-message weak throttle',async()=>{
 const key='private:123',h=await bridgeHarness({files:{[budgetFile]:{ownerBudgetEnabled:true,sessions:{[key]:{coldLimitYuan:0.01,hardLimitYuan:100,privateWakeEveryMessages:5}}}}});
 try{h.setMode('reserved2');const sid=await h.ensureSession(key);h.tokenLedger.ingestEvent(billed(sid));assert.equal(h.tokenBudgetOf(key).stage,'weak');h.appendSocialV2Message(key,'owner','帮我检查代码','帮我检查代码',false,true,'601',[],123,[],'admitted');await h.deliverPrompt(key,'wake',{wakeReason:'private'});await h.deliverPrompt(key,'wake',{wakeReason:'budgetWeak'});assert.equal(h.calls.prompts.length,0);}finally{await h.close();}
});

test('ordinary minute/hour exhaustion prevents arming thinking and timeout fillers',async()=>{
 const key='private:123',h=await bridgeHarness({files:{'state/plugins/config/ctx-chat-reply-shape.json':{maxSendPerMinute:1,maxSendPerHour:1},'state/plugins/config/life-message-ack.json':{privateWait:{delayMs:60000,lines:['thinking']},privateApology:{delayMs:60000,lines:['timeout']}}}});
 try{h.setMode('reserved2');const plan=h.pluginHost.callService('replyPlan','resolve',{key,turnId:'consume',reason:'operator',agent:false});assert.equal(h.pluginHost.callService('replyPlan','reserve',{key,plan,operationId:'consume',text:'ordinary',now:Date.now()}).ok,true);h.pluginHost.callService('replyPlan','commit',{key,operationId:'consume',sentAt:Date.now(),deliveryId:'ordinary'});assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).allowed,false);h.scheduleMessageReadAck(key,Date.now());assert.equal(h.messageAckArmed.has(key),false);assert.equal(h.calls.sent.length,0);}finally{await h.close();}
});

test('a group task missing the normal wake draw remains unread without model admission',async()=>{
 const h=await bridgeHarness({files:{'state/plugins/config/life-wake-reasons.json':{initialProbability:0,probabilityMax:0,probabilityStep:0,groupAtBonus:0,groupNameBonus:0,groupQuestionBonus:0,groupPokeBonus:0}}});
 try{h.setMode('reserved2');await h.ensureSession('group:456');h.getSocialV2State('group:456').bootstrapSent=true;await h.handleIncoming('group',456,{self_id:999,user_id:222,group_id:456,message_id:700,message:[{type:'text',data:{text:'帮我检查这段代码'}}]},h.cfg);const st=h.getSocialV2State('group:456');assert.equal(st.unread.length,1);assert.equal(st.pendingWakeTimer,null);assert.equal(h.calls.prompts.length,0);assert.equal(h.calls.sent.length,0);assert.equal(h.pendingTurnEnvelopes.size,0);}finally{await h.close();}
});
test('an ordinary admitted turn crossing the hard limit cannot emit thinking filler or continue its model',async()=>{
 const h=await bridgeHarness({files:{[budgetFile]:config}});
 try{h.setMode('reserved2');const key='private:123',sid=await h.ensureSession(key);h.appendSocialV2Message(key,'owner','今天好累啊','今天好累啊',false,true,'701',[],123,[],'admitted');await h.deliverPrompt(key,'wake',{wakeReason:'private'});await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/start',data:{turn:1}}}});h.tokenLedger.ingestEvent(billed(sid));assert.equal(h.shouldBlockSilentReply(key),true);await assert.rejects(h.api.sessions.prompt({sessionId:sid,taskExempt:true,content:[]}),/额度|预算/);assert.equal(await h.sendToQQ(key,'thinking',{messageAck:true}),false);assert.equal(h.calls.sent.length,0);}finally{await h.close();}
});

test('relay task provenance requires an explicit third-party destination, while tell-me smalltalk and knowledge explanations remain chat',()=>{
 const api=createPlugin({config:{},state:{get:()=>({}),set(){}}}).services.tokenBudget;
 for(const text of ['能告诉我你今天心情怎么样吗','请告诉我什么是世界模型','帮我解释一下梯度下降','我昨天告诉小明这件事了'])assert.equal(api.taskExemption({text,reason:'private'}).eligible,false,text);
 for(const text of ['告诉十二用户今晚来','请告诉十二用户今晚来','发给某某：明天开会','帮我转告小明明天见'])assert.equal(api.taskExemption({text,reason:'private'}).kind,'relay',text);
});

test('complete admitted reminder fragments combine into a calendar task',()=>{const api=createPlugin({config:{},state:{get:()=>({}),set(){}}}).services.tokenBudget;assert.equal(api.taskExemption({text:'帮我设个提醒\n明天8点',reason:'private'}).kind,'calendar');});
