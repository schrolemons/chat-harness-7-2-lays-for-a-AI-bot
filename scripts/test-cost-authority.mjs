import test from 'node:test';import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import fs from 'node:fs';import path from 'node:path';
import {readCostPolicy,selectCostPolicy} from '../plugins/qq-components/obs-cost-policy/policy.mjs';
const pro={defaultModel:'deepseek-v4-pro',defaultEffort:'max',autoUpgradeComplexTasks:false};
async function fixture(run){const h=await bridgeHarness({config:{dsh:{model:'UNRELATED_DSH_DEFAULT',reasoningEffort:'medium'}}});h.setMode('reserved2');h.setPresets(['standard','qq-chat','qq-chat-v2','qq-task-worker']);const selected=[];h.api.sessions.selectModel=async p=>{selected.push(p);return {result:{ok:true,value:{selected:p}}};};try{await run(h,selected);}finally{await h.close();}}
test('policy sync updates existing private/group and unfinished tasks without replacing their sessions',()=>fixture(async(h,selected)=>{
 const privateId=await h.ensureSession('private:123'),groupId=await h.ensureSession('group:456'),token=h.getSocialV2State('private:123').agentToken;
 const task=await h.taskCaps.taskSpawn({token,title:'普通任务',task:'核对示例资料'}),before={...h.state.sessions};
 h.pluginHost.setConfig('obs-cost-policy',pro);await h.pluginHost.reload('obs-cost-policy');
 const result=await h.pluginHost.callService('cost-policy','sync',{});assert.equal(result?.ok,true);assert.equal(JSON.stringify(h.state.sessions),JSON.stringify(before));
 for(const id of [privateId,groupId,task.sessionId]){const actual=selected.findLast(p=>p.sessionId===id);assert.equal(actual.model,'deepseek-v4-pro');assert.equal(actual.reasoningEffort,'max');}
 const next=await h.taskCaps.taskSpawn({token,title:'后续任务',task:'另一个普通任务'});assert.equal(selected.findLast(p=>p.sessionId===next.sessionId).reasoningEffort,'max');
}));
test('disabled policy component retains its configured baseline instead of unrelated DSH defaults',()=>fixture(async(h,selected)=>{
 h.pluginHost.setConfig('obs-cost-policy',pro);await h.pluginHost.reload('obs-cost-policy');h.pluginHost.setEnabled('obs-cost-policy',false);
 await h.ensureSession('private:123');assert.equal(selected.at(-1).model,'deepseek-v4-pro');assert.equal(selected.at(-1).reasoningEffort,'max');
}));
test('failed task model selection never submits a prompt on the wrong model',()=>fixture(async(h)=>{
 const token=h.getSocialV2State('private:123').agentToken;h.api.sessions.selectModel=async()=>{throw Error('fixture selection failed');};
 await assert.rejects(h.taskCaps.taskSpawn({token,title:'test',task:'test'}),/模型|档位/);assert.equal(h.calls.prompts.length,0);
}));
test('resuming an existing task rechecks the current policy before sending more input',()=>fixture(async(h,selected)=>{
 const token=h.getSocialV2State('private:123').agentToken,task=await h.taskCaps.taskSpawn({token,title:'普通任务',task:'核对资料'});
 h.pluginHost.setConfig('obs-cost-policy',pro);await h.pluginHost.reload('obs-cost-policy');
 await h.taskCaps.taskInput({token,taskId:task.taskId,input:'补充内容',requestId:'extra-input'});
 assert.equal(selected.findLast(p=>p.sessionId===task.sessionId).reasoningEffort,'max');
}));
test('Console saves synchronize existing sessions, and legacy effort writes the same policy',async()=>{
 const h=await bridgeHarness({config:{consoleToken:'fixture-cost-admin',dsh:{model:'OLD_MODEL',reasoningEffort:'low'}}});let server;const selected=[];h.api.sessions.selectModel=async p=>{selected.push(p);return {result:{ok:true,value:{selected:p}}};};
 try{
  h.setMode('reserved2');const id=await h.ensureSession('private:123'),configBefore=JSON.stringify(h.cfg.dsh);
  server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port,headers={'x-console-token':'fixture-cost-admin','content-type':'application/json'};
  const saved=await fetch(base+'/api/plugins/config',{method:'POST',headers,body:JSON.stringify({id:'obs-cost-policy',config:pro})});assert.equal(saved.status,200);assert.equal((await saved.json()).sync.applied,1);assert.equal(selected.findLast(row=>row.sessionId===id).model,'deepseek-v4-pro');
  const legacy=await fetch(base+'/api/dsh/effort',{method:'POST',headers,body:JSON.stringify({reasoningEffort:'high'})});assert.equal(legacy.status,200);assert.equal((await legacy.json()).policySource,'obs-cost-policy');assert.equal(readCostPolicy(h.temp).defaultEffort,'high');assert.equal(JSON.stringify(h.cfg.dsh),configBefore);
  const current=await fetch(base+'/api/dsh/model',{headers}).then(r=>r.json());assert.equal(current.model,'deepseek-v4-pro');assert.equal(current.reasoningEffort,'high');assert.equal(current.default,'high');
  h.pluginHost.setEnabled('obs-cost-policy',false);const disabled=await fetch(base+'/api/plugins/config',{method:'POST',headers,body:JSON.stringify({id:'obs-cost-policy',config:pro})});assert.equal(disabled.status,200);assert.equal(selected.findLast(row=>row.sessionId===id).reasoningEffort,'max');
  h.api.sessions.selectModel=async()=>{throw Error('fixture refused');};const partial=await fetch(base+'/api/plugins/config',{method:'POST',headers,body:JSON.stringify({id:'obs-cost-policy',config:{defaultEffort:'max'}})});assert.equal(partial.status,409);const failure=await partial.json();assert.equal(failure.ok,false);assert.equal(failure.sync.failed.length,1);assert.match(failure.error,/已保存/);
 }finally{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await h.close();}
});
test('standalone summary policy reads the same saved model and effort; malformed settings never choose a hidden fallback',()=>fixture(async h=>{
 h.pluginHost.setConfig('obs-cost-policy',pro);const actual=selectCostPolicy(readCostPolicy(h.temp),{reason:'webSummary',task:'请使用 Pro'});assert.equal(actual.model,'deepseek-v4-pro');assert.equal(actual.reasoningEffort,'max');
 fs.writeFileSync(path.join(h.temp,'state/plugins/config/obs-cost-policy.json'),'broken');assert.throws(()=>readCostPolicy(h.temp),/不可读/);
}));
