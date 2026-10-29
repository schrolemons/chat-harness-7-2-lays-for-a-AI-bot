import test from 'node:test';import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
test('token budget blocks DSH prompt and outgoing reply after a billed round',async()=>{
 for(const scope of ['session','global']){
  const config=scope==='session'
   ? {sessions:{'private:123':{coldLimitYuan:0,hardLimitYuan:0.1,weakMinIntervalMin:30}},globalHardLimitYuan:0}
   : {sessions:{},globalHardLimitYuan:0.1};
  const h=await bridgeHarness({files:{'state/plugins/config/life-token-budget.json':config}});
  try{
   h.setMode('reserved2');
   const sid=await h.ensureSession('private:123');
   const billedAt=Date.now();
   assert.equal(h.tokenLedger.ingestEvent({sessionId:sid,at:billedAt,model:'deepseek-flash',event:{type:'assistant/message',seq:1,data:{turn:1,step:1,usage:{inputTokens:1_000_000,outputTokens:100}}}}),true);
   assert.equal(h.tokenBudgetOf('private:123',billedAt).stage,'silent');
   assert.equal(h.shouldBlockSilentReply('private:123'),true);
   const result=await h.deliverPrompt('private:123','MUST_NOT_REACH_DSH');
   assert.equal(result.skipped,true);
   assert.equal(h.calls.prompts.length,0);
  }finally{await h.close();}
 }
});
test('one real wake preserves reminder and unmute data through actual DSH delivery',async()=>{
 const h=await bridgeHarness({config:{socialV2:{curfew:{enabled:false},wake:{maxWakePerHour:100},proactive:{enabled:false}}}});
 try{h.setMode('reserved2');const st=h.getSocialV2State('private:123');st.pendingReminderItems=[{text:'FIXTURE_REMINDER'}];st.mutedJustCleared=true;await h.sendWakePromptV2('private:123','reminder');assert.equal(h.calls.prompts.length,1);const text=JSON.stringify(h.calls.prompts[0].content);assert.ok(text.includes('FIXTURE_REMINDER'));assert.ok(text.includes('刚解除静音'));assert.ok(text.includes('会话令牌'));}finally{await h.close();}
});
test('cost routing applies to first session, maintenance resets, unplug returns safe default',async()=>{
 const h=await bridgeHarness({config:{dsh:{authToken:'fixture-only',model:'deepseek-flash',reasoningEffort:'low'}}});const selected=[];h.api.sessions.selectModel=async p=>{selected.push(p);return {result:{ok:true,value:{selected:p}}};};
 try{h.setMode('reserved2');h.pluginHost.emitIncoming({key:'private:123',text:'请重构代码并修复并发死锁'});await h.ensureSession('private:123');assert.equal(selected.at(-1).model,'deepseek-v4-pro');await h.ensureSession('private:123',{reason:'memoryWrite'});assert.equal(selected.at(-1).model,'deepseek-flash');assert.equal(selected.at(-1).reasoningEffort,'low');h.pluginHost.setEnabled('obs-cost-policy',false);await h.ensureSession('private:123');assert.equal(selected.at(-1).model,'deepseek-flash');}finally{await h.close();}
});
test('disabling context layer retains protocol token; disabling memory update blocks inference',async()=>{
 const h=await bridgeHarness();try{h.setMode('reserved2');h.pluginHost.setEnabled('ctx-context-session',false);const st=h.getSocialV2State('private:123');assert.ok(h.buildWakePromptV2('private:123','message').includes(st.agentToken));h.pluginHost.setEnabled('ctx-memory-update',false);await h.sendWakePromptV2('private:123','memoryWrite');assert.equal(h.calls.prompts.length,0);}finally{await h.close();}
});
test('plugin askAI uses real serialized transport queue, stopped generation is rejected',async()=>{
 const h=await bridgeHarness();try{h.setMode('reserved2');const signal=new AbortController();assert.equal(h.taskCaps.requestPluginPrompt('FIXTURE_PLUGIN_PROMPT',{plugin:'gov-policy',key:'private:123',signal:signal.signal}),true);for(let i=0;i<100&&h.calls.prompts.length===0;i++)await new Promise(r=>setTimeout(r,5));assert.equal(h.calls.prompts.length,1);assert.ok(JSON.stringify(h.calls.prompts[0].content).includes('FIXTURE_PLUGIN_PROMPT'));signal.abort();assert.equal(h.taskCaps.requestPluginPrompt('stale',{plugin:'gov-policy',key:'private:123',signal:signal.signal}),false);}finally{await h.close();}
});
test('real maintenance dispatch after a complex request selects Flash low',async()=>{
 const h=await bridgeHarness();const selected=[];h.api.sessions.selectModel=async p=>{selected.push(p);return {result:{ok:true,value:{selected:p}}};};
 try{h.setMode('reserved2');h.pluginHost.emitIncoming({key:'private:123',text:'请重构代码并修复并发死锁'});await h.sendWakePromptV2('private:123','memoryWrite');assert.equal(h.calls.prompts.length,1);assert.equal(selected.at(-1).model,'deepseek-flash');assert.equal(selected.at(-1).reasoningEffort,'low');}finally{await h.close();}
});
test('queued plugin prompt obeys pause and revoked offline generation',async()=>{
 for(const mode of ['pause','offline']){
  const h=await bridgeHarness();try{h.setMode('reserved2');let release,entered;const ready=new Promise(r=>entered=r);h.api.sessions.prompt=async p=>{if(JSON.stringify(p.content).includes('BLOCK')){entered();await new Promise(r=>release=r);}h.calls.prompts.push(p);return {result:{ok:true,value:{}}};};
   const first=h.deliverPrompt('private:123','BLOCK');await ready;const ctrl=new AbortController();assert.equal(h.taskCaps.requestPluginPrompt('STALE_PLUGIN_PROMPT',{plugin:'gov-policy',key:'private:123',signal:ctrl.signal}),true);
   if(mode==='pause')h.socialV2.paused=true;else h.setReady(false);release();await first;await new Promise(r=>setTimeout(r,30));
   if(mode==='offline'){ctrl.abort();h.pluginHost.setEnabled('gov-policy',false);h.setReady(true);await h.flushQueue();await new Promise(r=>setTimeout(r,30));}
   assert.equal(h.calls.prompts.filter(p=>JSON.stringify(p.content).includes('STALE_PLUGIN_PROMPT')).length,0);
  }finally{await h.close();}
 }
});
test('contact plan identity survives busy queue and cancellation prevents old-time wake',async()=>{
 const h=await bridgeHarness();try{h.setMode('reserved2');const key='private:123',now=Date.now();h.pluginHost.callService('availability','setPlan',{key,kind:'later',contactISO:new Date(now+3600000).toISOString(),reason:'约定'});const plan=h.pluginHost.get('life-user-availability').state.plans[key];let release,entered;const ready=new Promise(r=>entered=r);h.api.sessions.prompt=async p=>{if(JSON.stringify(p.content).includes('BLOCK')){entered();await new Promise(r=>release=r);}h.calls.prompts.push(p);return {result:{ok:true,value:{}}};};const first=h.deliverPrompt(key,'BLOCK');await ready;await h.taskCaps.requestScheduledContact({key,id:plan.id});assert.ok(h.getSocialV2State(key).pendingWakeReasons.some(x=>x.reason==='scheduledContact:'+plan.id));h.pluginHost.callService('availability','cancelPlan',{key});release();await first;h.replayPendingWakeReasonsV2(key);await new Promise(r=>setTimeout(r,30));assert.equal(h.calls.prompts.length,1);}finally{await h.close();}
});
test('all optional plugins disabled still permits ordinary transport delivery',async()=>{const h=await bridgeHarness();try{h.setMode('reserved2');for(const p of h.pluginHost.summary().plugins)h.pluginHost.setEnabled(p.id,false);await h.deliverPrompt('private:123','ORDINARY_TRANSPORT');assert.equal(h.calls.prompts.length,1);assert.ok(JSON.stringify(h.calls.prompts[0].content).includes('ORDINARY_TRANSPORT'));}finally{await h.close();}});

test('availability returned API checks session token and plan identity, retaining unrelated quiet periods', async () => {
 const h=await bridgeHarness();const key='private:123';const server=h.startConsoleServer();
 try {
  h.setMode('reserved2');if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const token=h.getSocialV2State(key).agentToken;
  const call=async(input,auth=token)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/availability',{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-token':auth},body:JSON.stringify({key,...input})});return{status:response.status,data:await response.json()};};
  const booked=await call({action:'set',kind:'later',contactISO:new Date(Date.now()+3600000).toISOString()});
  assert.equal(booked.status,200);assert.equal(typeof booked.data.planId,'string');
  assert.equal((await call({action:'returned',planId:booked.data.planId},'invalid')).status,403);
  assert.equal((await call({action:'returned'})).status,400);
  assert.equal((await call({action:'query'})).data.plan.id,booked.data.planId);
  const returned=await call({action:'returned',planId:booked.data.planId});
  assert.equal(returned.status,200);assert.equal(returned.data.cancelled,true);
  assert.equal((await call({action:'query'})).data.plan,null);
  await call({action:'set',kind:'daily',windows:[{start:'08:00',end:'17:00'}]});
  assert.equal((await call({action:'returned',planId:booked.data.planId})).status,400);
  assert.equal((await call({action:'query'})).data.plan.kind,'daily');
 }finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));await h.close();}
});

test('scheduled contact uses the ordinary group wake rate limit and model return revokes pending wake', async () => {
 const h=await bridgeHarness();const key='group:456';
 try {
  h.setMode('reserved2');const st=h.getSocialV2State(key);h.cfg.socialV2.wake.maxWakePerMinute=1;st.wakeTimes=[Date.now()];
  const booked=h.pluginHost.callService('availability','setPlan',{key,kind:'later',contactISO:new Date(Date.now()+3600000).toISOString()});
  await h.taskCaps.requestScheduledContact({key,id:booked.planId});
  assert.equal(h.calls.prompts.length,0);assert.ok(st.rateLimitRetryTimer,'existing rate-limit retry must be used');
  assert.equal(h.pluginHost.callService('availability','markReturned',{key,planId:booked.planId}).ok,true);
  await h.taskCaps.requestScheduledContact({key,id:booked.planId});assert.equal(h.calls.prompts.length,0);
 }finally{await h.close();}
});

test('balance plugin calls require the token belonging to the administrator private session', async () => {
 const h=await bridgeHarness();const server=h.startConsoleServer();let calls=0;
 try {
  h.setMode('reserved2');if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const original=h.pluginHost.callTool.bind(h.pluginHost);h.pluginHost.callTool=async(name,input)=>name==='deepseek_balance'?(calls++,{ok:true,result:{ok:true,is_available:true,balance_infos:[]}}):original(name,input);
  const invoke=async key=>fetch('http://127.0.0.1:'+server.address().port+'/api/plugins/call',{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-token':h.getSocialV2State(key).agentToken},body:JSON.stringify({tool:'deepseek_balance',input:{}})});
  assert.equal((await invoke('group:456')).status,403);assert.equal(calls,0);
  assert.equal((await invoke('private:123')).status,200);assert.equal(calls,1);
 }finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));await h.close();}
});
