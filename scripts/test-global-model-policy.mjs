import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelPolicyController,modelPolicyRevision} from '../src/console/model-policy.mjs';
import {selectCostPolicy,taskModelRange} from '../plugins/qq-components/obs-cost-policy/policy.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';

const old={provider:'official',model:'flash',effort:'low'};
const selection={provider:'campus',model:'flash',effort:''};
function fixture({initialPolicy,...options}={}){
 let policy=initialPolicy||{conversation:{...old},task:{...old},presets:{'qq-admin':{...old},'qq-chat-v2':{...old},'qq-task-worker':{allowed:[{provider:'official',model:'flash',efforts:['low','high']}]}}};
 const writes=[],syncs=[];
 const controller=createModelPolicyController({
  readPolicy:()=>structuredClone(policy),
  fetchCatalog:async()=>({groups:[{id:'campus',models:[{id:'flash'}]},{id:'official',models:[{id:'flash',reasoning:{efforts:[{id:'low'},{id:'high'}]}}]}]}),
  fetchPresets:async()=>['qq-chat','qq-chat-v2','qq-admin','qq-learning','campus-summary','qq-task-worker'].map(id=>({id})),
  savePolicy:async config=>{writes.push(structuredClone(config));policy=structuredClone(config);return {ok:true};},
  synchronize:async()=>{syncs.push(structuredClone(policy));return {ok:true,applied:8,total:8,failed:[]};},
  ...options,
 });
 async function request(body,method='POST'){
  let response;
  const handled=await controller.route({req:{method},url:new URL('http://localhost/api/presets/model-policy'),readBody:async()=>body,sendJson:(data,status=200)=>{response={status,...data};}});
  assert.equal(handled,true);return response;
 }
 return {request,writes,syncs,policy:()=>structuredClone(policy),body:(extra={})=>({scope:'global',selection,revision:modelPolicyRevision(policy),...extra})};
}

test('global save updates both defaults and preserves every enabled override in one write and one sync',async()=>{
 const h=fixture(),before=h.policy(),r=await h.request(h.body());
 assert.equal(r.status,200);assert.equal(r.ok,true);assert.equal(r.saved,true);
 assert.deepEqual(h.policy(),{conversation:selection,task:selection,presets:before.presets});
 assert.equal(h.writes.length,1);assert.equal(h.syncs.length,1);
 assert.equal(r.revision,modelPolicyRevision(h.policy()));
 for(const preset of ['qq-chat','qq-learning','campus-summary','future-preset']){
  const selected=selectCostPolicy(h.policy(),{preset,purpose:['qq-learning','campus-summary','qq-task-worker'].includes(preset)?'task':'conversation'});
  assert.equal(selected.provider,'campus');assert.equal(selected.model,'flash');assert.equal(selected.reasoningEffort,undefined);
 }
 assert.deepEqual(taskModelRange(h.policy()),before.presets['qq-task-worker']);
 assert.equal(selectCostPolicy(h.policy(),{preset:'qq-admin'}).provider,'official');
 assert.equal(selectCostPolicy(h.policy(),{preset:'qq-chat-v2'}).provider,'official');
});

test('readback advertises global support and one preset can override it afterward',async()=>{
 const h=fixture({initialPolicy:{conversation:old,task:old,presets:{}}});const initial=await h.request(null,'GET');assert.equal(initial.supportsGlobalDefault,true);
 await h.request(h.body());
 const override=await h.request(h.body({scope:'preset',presetId:'qq-admin',selection:old}));
 assert.equal(override.ok,true);assert.deepEqual(override.config.presets,{'qq-admin':old});
 assert.equal(selectCostPolicy(override.config,{preset:'qq-admin'}).provider,'official');
 assert.equal(selectCostPolicy(override.config,{preset:'qq-chat-v2'}).provider,'campus');
 const inherited=await h.request(h.body({scope:'preset',presetId:'qq-admin',selection:null}));
 assert.equal(inherited.ok,true);assert.equal(selectCostPolicy(inherited.config,{preset:'qq-admin'}).provider,'campus');
 assert.deepEqual(taskModelRange(inherited.config),{allowed:[{provider:'campus',model:'flash',efforts:['']}]});
});

test('invalid combinations and stale revisions never change any scope',async()=>{
 for(const patch of [{revision:'outdated'},{selection:{...selection,model:'missing'}},{selection:{...selection,effort:'high'}},{selection:null},{selection:{...selection,apiKey:'invalid-extra-field'}}]){
  const h=fixture(),before=h.policy(),r=await h.request(h.body(patch));
  assert.equal(r.ok,false);assert.equal(r.status,patch.revision?409:400);
  assert.deepEqual(h.policy(),before);assert.equal(h.writes.length,0);assert.equal(h.syncs.length,0);
 }
});

test('catalog failure does not save or synchronize',async()=>{
 const h=fixture({fetchCatalog:async()=>{throw Error('offline');}}),r=await h.request(h.body());
 assert.equal(r.status,503);assert.equal(h.writes.length,0);assert.equal(h.syncs.length,0);
});

test('persistence failure does not synchronize or claim a saved configuration',async()=>{
 const h=fixture({savePolicy:async()=>({ok:false,error:'write denied'})}),before=h.policy(),r=await h.request(h.body());
 assert.equal(r.status,400);assert.equal(r.saved,undefined);assert.equal(h.syncs.length,0);assert.deepEqual(h.policy(),before);
});

test('partial or thrown sync failure retains saved config with an explicit failure response',async()=>{
 for(const synchronize of [async()=>({ok:false,total:8,applied:7,failed:[{sessionId:'fixture-task',status:'failed'}]}),async()=>{throw Error('sync unavailable');}]){
  const h=fixture({synchronize}),r=await h.request(h.body());
  assert.equal(r.status,409);assert.equal(r.saved,true);assert.equal(r.ok,false);assert.equal(r.config.conversation.provider,'campus');
  assert.match(r.error,/已保存/);assert.equal(h.writes.length,1);
 }
});

test('concurrent global and preset saves cannot overwrite a newer revision',async()=>{
 const h=fixture(),body=h.body();
 const results=await Promise.all([h.request(body),h.request({...body,scope:'preset',presetId:'qq-admin',selection:old})]);
 assert.deepEqual(results.map(r=>r.status),[200,409]);assert.equal(h.writes.length,1);assert.equal(h.syncs.length,1);
});

test('inherited task range follows global default and prior out-of-range selections need explicit reselection',async()=>{
 const h=fixture({initialPolicy:{conversation:old,task:old,presets:{}}});await h.request(h.body());
 assert.throws(()=>selectCostPolicy(h.policy(),{preset:'qq-task-worker',modelSelection:old}),/超出允许范围/);
 assert.equal(selectCostPolicy(h.policy(),{preset:'qq-task-worker',modelSelection:selection}).provider,'campus');
});

test('authenticated global route synchronizes inherited sessions while preserving individually configured sessions and running tasks',async()=>{
 const initial={conversation:old,task:old,presets:{'qq-admin':old,'qq-task-worker':{allowed:[{provider:old.provider,model:old.model,efforts:[old.effort]}]}}};
 const h=await bridgeHarness({config:{consoleToken:'fixture-global-default',socialV2:{adminDev:{enabled:true,preset:'qq-admin'}}},files:{'state/plugins/config/obs-cost-policy.json':initial}});
 let server;
 try{
  h.setMode('reserved2');h.setPresets(['standard','qq-chat-v2','qq-admin','qq-task-worker']);
  const ok=value=>({result:{ok:true,value}}),selected=[];
  h.api.agentPresets={list:async()=>ok({presets:['qq-chat-v2','qq-admin','qq-task-worker'].map(id=>({id}))})};
  h.api.callUnary=async()=>ok({groups:[{id:'campus',models:[{id:'flash'}]},{id:'official',models:[{id:'flash',reasoning:{efforts:[{id:'low'}]}}]}]});
  h.api.sessions.selectModel=async value=>{selected.push(value);return ok({selected:value});};
  const owner=await h.ensureSession('private:123'),group=await h.ensureSession('group:456');
  const token=h.getSocialV2State('private:123').agentToken;
  const task=await h.taskCaps.taskSpawn({token,title:'fixture',task:'fixture',modelSelection:old});
  selected.length=0;
  server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(body,headers={})=>{
   const response=await fetch(base+'/api/presets/model-policy',{method:body?'POST':'GET',headers:{'x-console-token':'fixture-global-default','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
   return {status:response.status,data:await response.json()};
  };
  const first=await request(),body={scope:'global',selection,revision:first.data.revision};
  const denied=await request(body,{'x-agent-call':'1','x-agent-token':h.getSocialV2State('group:456').agentToken});
  assert.equal(denied.status,403);assert.equal(selected.length,0);
  const saved=await request(body);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.sync.ok,true);
  assert.equal(selected.findLast(s=>s.sessionId===owner).provider,'official');
  assert.equal(selected.findLast(s=>s.sessionId===group).provider,'campus');
  assert.equal(selected.findLast(s=>s.sessionId===task.sessionId).provider,'official');
  assert.deepEqual(h.taskCaps.getTaskRecord(task.sessionId).modelSelection,old);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await h.close();}
});
