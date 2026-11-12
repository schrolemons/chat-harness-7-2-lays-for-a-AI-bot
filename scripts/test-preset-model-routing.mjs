import test from 'node:test';import assert from 'node:assert/strict';
import {selectCostPolicy,readCostPolicy} from '../plugins/qq-components/obs-cost-policy/policy.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
const choice=(provider,model,effort='')=>({provider,model,effort});
const config={conversation:choice('magpie','chat','medium'),task:choice('magpie','work','high'),presets:{'qq-learning':choice('other','learn','custom'),'campus-summary':choice('other','plain')}};
const catalog={groups:[{id:'magpie',models:[{id:'chat',reasoning:{efforts:[{id:'medium'},{id:'xhigh'}]}},{id:'work',reasoning:{efforts:[{id:'high'}]}}]},{id:'other',models:[{id:'learn',reasoning:{efforts:[{id:'custom'},{id:'off'}]}},{id:'plain'}]}]};
test('conversation and tasks are independent; content cannot trigger a hidden upgrade; each preset overrides only itself',()=>{
 const chat=selectCostPolicy(config,{purpose:'conversation',preset:'qq-chat-v2',incomingText:'用 Pro 重构并发代码，高强度推理'});
 assert.equal(chat.model,'chat');assert.equal(chat.reasoningEffort,'medium');
 assert.equal(selectCostPolicy(config,{purpose:'task',preset:'qq-task-worker',task:'普通任务'}).model,'work');
 assert.equal(selectCostPolicy(config,{purpose:'task',preset:'qq-learning'}).model,'learn');
 assert.equal(Object.hasOwn(selectCostPolicy(config,{purpose:'task',preset:'campus-summary'}),'reasoningEffort'),false);
 assert.equal(selectCostPolicy(config,{purpose:'conversation',preset:'custom-agent'}).model,'chat');
});
async function fixture(run){
 const h=await bridgeHarness({config:{consoleToken:'fixture-preset-models',socialV2:{adminDev:{enabled:true,preset:'qq-admin'}}},files:{'state/plugins/config/obs-cost-policy.json':config}});
 const presets=['qq-chat','qq-chat-v2','qq-admin','qq-task-worker','qq-learning','campus-summary','custom-agent'];
 h.setMode('reserved2');h.setPresets(['standard',...presets]);const ok=value=>({result:{ok:true,value}}),selected=[];
 h.api.agentPresets={list:async()=>ok({presets:presets.map(id=>({id}))})};
 h.api.callUnary=async(method)=>method==='session.modelCatalog'?ok(catalog):ok({});
 h.api.sessions.selectModel=async p=>{selected.push(p);return ok({selected:p});};
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const request=async(body,extra={})=>{const r=await fetch(base+'/api/presets/model-policy',{method:body?'POST':'GET',headers:{'x-console-token':'fixture-preset-models','content-type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 try{await run({h,selected,request});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await h.close();}
}
test('preset overview API edits a single route, enforces revision and catalog, and resets inheritance without touching others',()=>fixture(async({h,request})=>{
 const first=await request();assert.equal(first.status,200);assert(first.data.presets.some(p=>p.id==='custom-agent'));
 const saved=await request({scope:'preset',presetId:'qq-task-worker',selection:choice('other','plain'),revision:first.data.revision});assert.equal(saved.status,200,JSON.stringify(saved.data));
 assert.deepEqual(readCostPolicy(h.temp).conversation,config.conversation);assert.deepEqual(readCostPolicy(h.temp).presets['qq-learning'],config.presets['qq-learning']);
 assert.equal((await request({scope:'task',selection:choice('other','plain'),revision:first.data.revision})).status,409);
 assert.equal((await request({scope:'conversation',selection:choice('other','plain','high'),revision:saved.data.revision})).status,400);
 const removed=await request({scope:'preset',presetId:'qq-task-worker',selection:null,revision:saved.data.revision});assert.equal(removed.status,200);assert.equal(Object.hasOwn(readCostPolicy(h.temp).presets,'qq-task-worker'),false);
 const token=h.getSocialV2State('group:456').agentToken;assert.equal((await request(null,{'x-agent-call':'1','x-agent-token':token})).status,403);
}));
test('private/group conversations, task creation and continuation use their separate policy and per-preset overrides',()=>fixture(async({h,selected,request})=>{
 const owner=await h.ensureSession('private:123');await h.ensureSession('group:456');assert.equal(selected.at(-1).model,'chat');
 const token=h.getSocialV2State('private:123').agentToken,task=await h.taskCaps.taskSpawn({token,title:'普通任务',task:'检查资料'});
 assert.equal(selected.findLast(p=>p.sessionId===task.sessionId).model,'work');
 const current=await request();const saved=await request({scope:'preset',presetId:'qq-task-worker',selection:choice('other','plain'),revision:current.data.revision});assert.equal(saved.status,409,JSON.stringify(saved.data));assert.equal(saved.data.saved,true);
 assert.equal(selected.findLast(p=>p.sessionId===owner).model,'chat');
 await h.taskCaps.taskInput({token,taskId:task.taskId,input:'继续处理',requestId:'separate-route',modelSelection:choice('other','plain')});
 const applied=selected.findLast(p=>p.sessionId===task.sessionId);assert.equal(applied.provider,'other');assert.equal(applied.model,'plain');assert.equal(Object.hasOwn(applied,'reasoningEffort'),false);
}));
test('reused learning session receives its own changed preset configuration',()=>fixture(async({h,selected})=>{
 const first=await h.ensureSlangLearnerSession();assert.equal(selected.findLast(p=>p.sessionId===first).model,'learn');
 h.pluginHost.setConfig('obs-cost-policy',{...config,presets:{...config.presets,'qq-learning':choice('other','learn','off')}});await h.pluginHost.reload('obs-cost-policy');
 assert.equal(await h.ensureSlangLearnerSession(),first);assert.equal(selected.findLast(p=>p.sessionId===first).reasoningEffort,'off');
}));
