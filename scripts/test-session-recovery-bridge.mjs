import test from 'node:test';import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
const KEY='group:456';
async function fixture(run){const h=await bridgeHarness();try{
 h.setMode('reserved2');const old=await h.ensureSession(KEY),st=h.getSocialV2State(KEY);
 for(const plugin of h.pluginHost.summary().plugins)if(plugin.id!=='obs-session-recovery'&&plugin.hooks.includes('onTick'))h.pluginHost.setEnabled(plugin.id,false);
 h.appendSocialV2Message(KEY,'用户','尚未答复','尚未答复',false,false,'inbound');
 st.mood=72;st.persistentMemory='保留记忆';st.pendingReminderItems=[{id:'reminder',text:'日程'}];
 const originalInspect=h.taskCaps.inspectGroupSessionRecovery;
 h.taskCaps.inspectGroupSessionRecovery=async()=>({sessionId:h.state.sessions[KEY],allowed:true,pendingCount:1,budgetStage:'normal',busy:false,quiet:false,muted:false,paused:false,transportReady:true});
 const token=st.agentToken;
 const now=Date.now();for(let turn=1;turn<=3;turn++){
  await h.deliverPrompt(KEY,'fixture admitted human message',{wakeReason:'message'});
  await h.queueDshEnvelope({payload:{type:'session/event',sessionId:old,event:{type:'turn/start',seq:turn*10,time:now-(3-turn)*60000,data:{turn}}}});
  await h.queueDshEnvelope({payload:{type:'session/event',sessionId:old,event:{type:'turn/end',seq:turn*10+1,time:now-(3-turn)*60000,data:{turn,reason:{kind:'error',error:{code:'INVALID_REQUEST',status:400,message:'bad request'}}}}}});
 }
 assert.equal(h.pluginHost.get('obs-session-recovery').state.groups[KEY].failures.length,3,'native bridge events must reach the detector');
 h.pluginHost.callService('sessionRecovery','observe',{key:KEY,sessionId:old,type:'assistant/message',seq:35,turn:3,chatTurn:true,progress:true,now});
 // Real events use arrival time for detection; set controlled observation times for this fixture.
 for(let turn=4;turn<=6;turn++){
  h.pluginHost.callService('sessionRecovery','observe',{key:KEY,sessionId:old,type:'turn/start',seq:turn*10,turn,chatTurn:true,now:now-(6-turn)*60000});
  h.pluginHost.callService('sessionRecovery','observe',{key:KEY,sessionId:old,type:'turn/end',seq:turn*10+1,turn,chatTurn:true,now:now-(6-turn)*60000,failure:{code:'INVALID_REQUEST',status:400,message:'bad request'}});
 }
 const before=JSON.stringify({unread:st.unread,mood:st.mood,memory:st.persistentMemory,reminders:st.pendingReminderItems});
 st.pendingWakeReasons=[{reason:'reminder',seq:0},{reason:'taskDone',seq:0}];
 const timer={scheduledId:'fixture-future-reminder',generation:123};st.reminderTimer=timer;
 await run({h,st,old,before,token,now,originalInspect,timer});
}finally{await h.close();}}
test('actual bridge rotates only the failed group session and preserves bot business state',()=>fixture(async({h,st,old,before,token,now,timer})=>{
 assert.equal(typeof h.taskCaps.recoverGroupSession,'function');
 await h.pluginHost.tick(now);
 assert.notEqual(h.state.sessions[KEY],old);assert(h.calls.cancelled.includes(old));assert(h.calls.archived.includes(old));
 assert.notEqual(st.agentToken,token);assert.equal(JSON.stringify({unread:st.unread,mood:st.mood,memory:st.persistentMemory,reminders:st.pendingReminderItems}),before);
 assert.deepEqual(Array.from(st.pendingWakeReasons,x=>x.reason),['reminder','taskDone']);assert.equal(st.reminderTimer,timer);
}));
test('disabled component and failed stop never detach the original mapping',()=>fixture(async({h,old,now})=>{
 h.pluginHost.setEnabled('obs-session-recovery',false);await h.pluginHost.tick(now);assert.equal(h.state.sessions[KEY],old);
 h.pluginHost.setEnabled('obs-session-recovery',true);await h.pluginHost.reload('obs-session-recovery');
 const created=h.calls.created.length;
 h.api.stopSessionWork=async()=>{throw Error('fixture stop failed');};await h.pluginHost.tick(now);assert.equal(h.state.sessions[KEY],old);assert.equal(h.calls.created.length,created);assert.equal(h.calls.archived.length,0);
}));
test('saved thresholds affect real recovery and unknown QQ or connection state cannot authorize it',()=>fixture(async({h,old,now,originalInspect})=>{
 assert.equal(h.pluginHost.setConfig('obs-session-recovery',{consecutiveFailures:3.5}).ok,false);
 assert.equal(h.pluginHost.setConfig('obs-session-recovery',{consecutiveFailures:4}).ok,true);await h.pluginHost.reload('obs-session-recovery');await h.pluginHost.tick(now);assert.equal(h.state.sessions[KEY],old);
 assert.equal(h.pluginHost.setConfig('obs-session-recovery',{consecutiveFailures:3}).ok,true);await h.pluginHost.reload('obs-session-recovery');
 h.taskCaps.inspectGroupSessionRecovery=originalInspect;await h.pluginHost.tick(now);assert.equal(h.state.sessions[KEY],old);assert.equal(h.calls.archived.length,0);
}));
