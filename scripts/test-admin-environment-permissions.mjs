import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness,fixtureTaskTurn} from './audit-bridge-harness.mjs';
import {isAdminPluginTool} from '../src/tools/admin-policy.js';

const management=['task_spawn','task_list','task_result','task_input','task_cancel','web_watch_status','bridge_health_help','worklog_history','diary_history','user_checking','exec_backends','browser_policy','eval_list_cases','integration_howto','gov_policy_rules','image_generation_status'];
async function fixture(t,{enabled=false,preset='qq-admin',mode='reserved2'}={}){
 const h=await bridgeHarness({config:{allow:{private:['123','789'],groups:['456']},socialV2:{adminDev:{enabled,preset,autoApprove:false},taskSession:{enabled:true}}}});
 t.after(()=>h.close());h.setMode(mode);h.setPresets(['standard','qq-chat','qq-chat-v2','qq-admin','qq-task-worker','qq-learning','campus-summary']);
 await h.ensureSession('private:123');
 const owner=h.getSocialV2State('private:123'),other=h.getSocialV2State('private:789'),group=h.getSocialV2State('group:456');
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const call=(tool,token=owner.agentToken,input={})=>fetch(base+'/api/plugins/call',{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-call':'1','x-agent-token':token},body:JSON.stringify({tool,input:{token,...input}})});
 return {h,owner,other,group,call,base};
}

for(const mode of ['reserved2','closed-agent'])test(mode+': owner identity with environment disabled denies every management route and direct task capability',async t=>{
 const f=await fixture(t,{mode});
 for(const tool of management){const r=await f.call(tool);assert.equal(r.status,403,tool);await r.json();}
 await assert.rejects(f.h.taskCaps.taskSpawn({token:f.owner.agentToken,title:'denied',task:'do not execute'}),/管理员环境/);
 assert.equal(f.h.calls.prompts.length,0);assert.equal(f.h.calls.sent.length,0);
});

test('administrator can query diary archives, worklogs and tasks without opening a paid task group',async t=>{
 const f=await fixture(t,{enabled:true});
 for(const tool of ['task_list','diary_history','worklog_history']){
  const r=await f.call(tool);assert.equal(r.status,200,tool);const data=await r.json();assert.equal(data.ok,true,tool);
  const denied=await f.call(tool,f.other.agentToken);assert.equal(denied.status,403,tool);await denied.json();
 }
 const mutation=await f.call('task_spawn');assert.equal(mutation.status,409);await mutation.json();
});

test('ordinary selected preset, stale loaded preset and disabled switch cannot authorize management',async t=>{
 const f=await fixture(t,{enabled:true,preset:'qq-chat-v2'});
 assert.equal((await f.call('task_list')).status,403);
 f.h.cfg.socialV2.adminDev.preset='qq-admin';
 assert.equal((await f.call('task_list')).status,403,'enabling admin selection cannot upgrade the old chat session');
});

test('active admin environment authorizes management only for its private session and revokes on disable',async t=>{
 const f=await fixture(t,{enabled:true});
 await fixtureTaskTurn(f.h,'private:123');
 for(const tool of ['task_list','web_watch_status','exec_backends']){const r=await f.call(tool);assert.equal(r.status,200,tool);await r.json();}
 for(const state of [f.other,f.group])for(const tool of management){const r=await f.call(tool,state.agentToken,{isOwnerKey:true,key:'private:123'});assert.equal(r.status,403,tool);await r.json();}
 f.h.cfg.socialV2.adminDev.enabled=false;
 for(const tool of management){const r=await f.call(tool);assert.equal(r.status,403,tool);await r.json();}
 await assert.rejects(f.h.taskCaps.taskSpawn({token:f.owner.agentToken,title:'denied',task:'do not execute'}),/管理员环境/);
});

test('disabling admin through the real config endpoint cancels outstanding delegated work and invalidates native follow-up',async t=>{
 const f=await fixture(t,{enabled:true});
 const task=await f.h.taskCaps.taskSpawn({token:f.owner.agentToken,title:'fixture',task:'fixture only'});
 const response=await fetch(f.base+'/api/socialV2/config',{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token'},body:JSON.stringify({adminDev:{enabled:false}})});
 assert.equal(response.status,200);await response.json();
 assert.equal(f.h.tasksStore[task.taskId].status,'cancelled');
 assert(f.h.calls.cancelled.includes(task.sessionId));
 const denied=await f.call('task_list');assert.equal(denied.status,403);
});

test('every currently registered management tool uses the same gate; dangerous handlers are replaced by permission probes',async t=>{
 const f=await fixture(t,{enabled:true});
 await fixtureTaskTurn(f.h,'private:123');
 const headers={'x-console-token':'fixture-console-token'};
 const inventory=await(await fetch(f.base+'/api/plugins',{headers})).json();
 const names=inventory.tools.map(tool=>tool.name).filter(isAdminPluginTool);
 assert(names.length>=20);
 let dispatches=0;
 f.h.pluginHost.callTool=async tool=>{dispatches++;return {ok:true,result:{permissionProbe:tool}};};
 const consoleOnly=new Set(['image_generation_secret']);
 for(const tool of names){const r=await f.call(tool);assert.equal(r.status,consoleOnly.has(tool)?403:200,tool);const data=await r.json();if(!consoleOnly.has(tool))assert.equal(data.result.permissionProbe,tool);}
 assert.equal(dispatches,names.length-consoleOnly.size);
 f.h.cfg.socialV2.adminDev.enabled=false;
 for(const tool of names){const r=await f.call(tool);assert.equal(r.status,403,tool);await r.json();}
 assert.equal(dispatches,names.length-consoleOnly.size,'disabled calls never reach management handlers');
 console.log('Management tool matrix: '+names.length+' tools × enabled/disabled');
});

test('QQ tokens cannot enable admin environment or invoke console control endpoints in either state',async t=>{
 const f=await fixture(t,{enabled:true});
 for(const enabled of [true,false]){
  f.h.cfg.socialV2.adminDev.enabled=enabled;
  for(const route of ['/api/restart','/api/role','/api/security','/api/whitelist','/api/plugins/config','/api/socialV2/config','/api/workspace/reset']){
   const r=await fetch(f.base+route,{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-call':'1','x-agent-token':f.owner.agentToken},body:JSON.stringify({adminDev:{enabled:true,preset:'qq-admin'},rehardenStateDir:true})});
   assert.equal(r.status,403,route);await r.json();
  }
 }
 assert.equal(f.h.calls.sent.length,0);
});
