import test from 'node:test';import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {selectTaskModel,normalizeModelPolicy} from '../plugins/qq-components/obs-cost-policy/policy.mjs';
const chat={provider:'magpie',model:'chat',effort:'medium'},work={provider:'magpie',model:'work',effort:'high'};
const config={conversation:chat,task:work,presets:{'qq-task-worker':{allowed:[{provider:'magpie',model:'work',efforts:['medium','high']},{provider:'other',model:'plain',efforts:['']}]}}};
const catalog={groups:[{id:'magpie',models:[{id:'chat',reasoning:{efforts:[{id:'medium'}]}},{id:'work',reasoning:{efforts:[{id:'medium'},{id:'high'}]}}]},{id:'other',models:[{id:'plain'}]}]};
test('range rejects missing, unknown and unsupported combinations; fixed worker settings migrate',()=>{
 assert.throws(()=>selectTaskModel(config),/modelSelection/);assert.throws(()=>selectTaskModel(config,{...work,effort:'max'}),/范围/);
 assert.deepEqual(selectTaskModel(config,work),work);
 assert.deepEqual(normalizeModelPolicy({...config,presets:{'qq-task-worker':work}}).presets['qq-task-worker'].allowed[0].efforts,['high']);
});
test('initiator discovers current choices; invalid spawn has no session/prompt; selection persists through continuation and range shrink',async()=>{
 const h=await bridgeHarness({config:{socialV2:{adminDev:{enabled:true,preset:'qq-admin'}}},files:{'state/plugins/config/obs-cost-policy.json':config}});
 try{
  h.setMode('reserved2');h.setPresets(['standard','qq-chat-v2','qq-admin','qq-task-worker']);const ok=value=>({result:{ok:true,value}}),selected=[],prompts=[];
  h.api.callUnary=async()=>ok(catalog);h.api.sessions.selectModel=async p=>{selected.push(p);return ok({selected:p});};
  h.api.sessions.prompt=async p=>{prompts.push(p);return ok({});};
  await h.ensureSession('private:123');const token=h.getSocialV2State('private:123').agentToken;
  assert.equal((await h.taskCaps.taskModels({token})).allowed.length,2);
  await assert.rejects(()=>h.taskCaps.taskModels({token:'invalid'}));
  const before=selected.length;await assert.rejects(()=>h.taskCaps.taskSpawn({token,title:'bad',task:'bad',modelSelection:{...work,effort:'max'}}),/范围/);assert.equal(selected.length,before);assert.equal(prompts.length,0);
  const task=await h.taskCaps.taskSpawn({token,title:'fixture',task:'fixture',modelSelection:work});assert.deepEqual(task.modelSelection,work);
  await h.taskCaps.taskInput({token,taskId:task.taskId,input:'continue',requestId:'first'});assert.equal(selected.at(-1).model,'work');
  const shrunk={...config,presets:{'qq-task-worker':{allowed:[{provider:'other',model:'plain',efforts:['']}]}}};
  assert.equal(h.pluginHost.setConfig('obs-cost-policy',shrunk).ok,true);await h.pluginHost.reload('obs-cost-policy');
  const promptCount=prompts.length;await assert.rejects(()=>h.taskCaps.taskInput({token,taskId:task.taskId,input:'blocked',requestId:'blocked'}),/范围/);assert.equal(prompts.length,promptCount);
  const replacement={provider:'other',model:'plain',effort:''};
  await h.taskCaps.taskInput({token,taskId:task.taskId,input:'reselect',requestId:'new-choice',modelSelection:replacement});assert.deepEqual(h.taskCaps.getTaskRecord(task.sessionId).modelSelection,replacement);assert.equal(selected.at(-1).model,'plain');assert.equal('reasoningEffort' in selected.at(-1),false);
  const duplicate={token,taskId:task.taskId,input:'simultaneous',requestId:'concurrent'};const n=prompts.length;
  await Promise.all([h.taskCaps.taskInput(duplicate),h.taskCaps.taskInput(duplicate)]);assert.equal(prompts.length,n+1);assert.equal(h.taskCaps.getTaskRecord(task.sessionId).inputs.filter(x=>x.requestId==='concurrent').length,1);
  let release,entered;const waiting=new Promise(r=>entered=r);h.api.callUnary=async()=>{entered();await new Promise(r=>release=r);return ok(catalog);};
  const pending=assert.rejects(h.taskCaps.taskInput({token,taskId:task.taskId,input:'late',requestId:'after-cancel'}),/已结束/);
  await waiting;await h.taskCaps.taskCancel({token,taskId:task.taskId});release();await pending;assert.equal(prompts.length,n+1);
 }finally{await h.close();}
});
