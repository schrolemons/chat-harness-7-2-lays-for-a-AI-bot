import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {readCostPolicy,selectCostPolicy} from '../plugins/qq-components/obs-cost-policy/policy.mjs';
const flash={provider:'deepseek-official',model:'deepseek-flash',effort:'low'},pro={provider:'deepseek-official',model:'deepseek-v4-pro',effort:'max'};
async function fixture(run){const h=await bridgeHarness({config:{consoleToken:'fixture-policy-control',dsh:{model:'UNRELATED_DSH_DEFAULT'},socialV2:{adminDev:{enabled:true,preset:'qq-admin'}}}});h.setMode('reserved2');h.setPresets(['standard','qq-chat-v2','qq-admin','qq-task-worker']);h.api.agentPresets={list:async()=>({result:{ok:true,value:{presets:['qq-admin','qq-task-worker','qq-learning'].map(id=>({id}))}}})};const selected=[];h.api.sessions.selectModel=async p=>{selected.push(p);return {result:{ok:true,value:{selected:p}}};};try{await h.ensureSession('private:123');await run(h,selected);}finally{await h.close();}}
const save=async(h,config)=>{assert.equal(h.pluginHost.setConfig('obs-cost-policy',config).ok,true);await h.pluginHost.reload('obs-cost-policy');};
test('sync retains session identities, applies independent chat defaults and preserves task choice within range',()=>fixture(async(h,selected)=>{
 const owner=await h.ensureSession('private:123'),group=await h.ensureSession('group:456'),token=h.getSocialV2State('private:123').agentToken;
 const task=await h.taskCaps.taskSpawn({token,title:'test',task:'test'}),before=JSON.stringify(h.state.sessions);
 await save(h,{conversation:pro,task:pro,presets:{'qq-task-worker':{allowed:[{...flash,efforts:['low']}].map(({effort,...s})=>s)}}});
 const sync=await h.taskCaps.synchronizeCostPolicy();assert.equal(sync.ok,true);assert.equal(JSON.stringify(h.state.sessions),before);
 for(const sid of [owner,group])assert.equal(selected.findLast(p=>p.sessionId===sid).model,pro.model);
 assert.equal(selected.findLast(p=>p.sessionId===task.sessionId).model,flash.model);
}));
test('disabled component still reads saved policy; corrupt state cannot silently fall back',()=>fixture(async(h,selected)=>{
 await save(h,{conversation:pro,task:flash,presets:{}});h.pluginHost.setEnabled('obs-cost-policy',false);await h.ensureSession('private:123');assert.equal(selected.at(-1).model,pro.model);
 fs.writeFileSync(path.join(h.temp,'state/plugins/config/obs-cost-policy.json'),'broken');assert.throws(()=>readCostPolicy(h.temp),/不可读/);
}));
test('failed task model application archives unstarted session and never submits a prompt',()=>fixture(async h=>{
 h.api.sessions.selectModel=async()=>{throw Error('fixture selection refused');};
 await assert.rejects(()=>h.taskCaps.taskSpawn({token:h.getSocialV2State('private:123').agentToken,title:'test',task:'test'}),/模型/);assert.equal(h.calls.prompts.length,0);assert.equal(h.calls.archived.length,1);
}));
test('console saves route independently, rejects old generic writes, and reports partial synchronization honestly',()=>fixture(async(h,selected)=>{
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 const request=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+route,{method:body?'POST':'GET',headers:{'x-console-token':'fixture-policy-control','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 try{
  assert.equal((await request('/api/plugins/config',{id:'obs-cost-policy',config:{defaultEffort:'max'}})).status,410);
  const first=await request('/api/presets/model-policy');assert.equal(first.status,200);
  const saved=await request('/api/presets/model-policy',{scope:'conversation',selection:pro,revision:first.data.revision});assert.equal(saved.status,200);assert.equal(selected.at(-1).model,pro.model);assert.deepEqual(readCostPolicy(h.temp).task,flash);
  h.api.sessions.selectModel=async()=>{throw Error('fixture refusal');};const partial=await request('/api/presets/model-policy',{scope:'conversation',selection:flash,revision:saved.data.revision});assert.equal(partial.status,409);assert.equal(partial.data.saved,true);assert.equal(partial.data.sync.failed.length,1);assert.deepEqual(readCostPolicy(h.temp).conversation,flash);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}));
test('web summary preset overrides task default without inheriting conversation setting',()=>fixture(async h=>{
 await save(h,{conversation:flash,task:flash,presets:{'campus-summary':pro}});assert.equal(selectCostPolicy(readCostPolicy(h.temp),{purpose:'task',preset:'campus-summary'}).model,pro.model);
}));
