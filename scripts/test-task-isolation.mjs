import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import {bridgeHarness} from './audit-bridge-harness.mjs';

async function harness(run) {
  const h = await bridgeHarness({config:{socialV2:{adminDev:{enabled:false},proactive:{enabled:false},curfew:{enabled:false}}}});
  h.setMode('reserved2'); h.setPresets(['standard','qq-chat','qq-chat-v2','qq-chat-dev','qq-task-worker']);
  const token = h.getSocialV2State('private:123').agentToken;
  try { await run(h, token); } finally { await h.close(); }
}

test('task spawn uses a fresh worker and sends only its task envelope', () => harness(async(h,token) => {
  const t = await h.taskCaps.taskSpawn({token,title:'统计项目',task:'统计 fixture-project 的代码行数'});
  assert.equal(h.calls.created[0].agentPreset,'qq-task-worker');
  assert.equal(h.calls.prompts[0].sessionId,t.sessionId);
  const text = h.calls.prompts[0].content[0].text;
  assert.match(text,/统计 fixture-project/);
  assert.doesNotMatch(text,/用户|科普|普通|通用助手|温柔|会话令牌|当前唤醒|沉睡|角色卡/);
  assert.ok(!text.includes(token));
  assert.equal(h.calls.sent.length,0);
}));

test('task completion marker must be its own final line', () => harness(async(h,token) => {
  const t = await h.taskCaps.taskSpawn({token,title:'test',task:'test'});
  h.handleTaskTurnEnd(t.taskId,{reason:{kind:'completed'},text:'示例中可能包含 [任务完成]，但工作尚未结束'});
  assert.notEqual(h.tasksStore[t.taskId].status,'done');
  assert.equal(h.tasksStore[t.taskId].status,'waiting_input');
}));

test('task requests missing input through the bot and can resume without a new worker', () => harness(async(h,token) => {
  const t = await h.taskCaps.taskSpawn({token,title:'test',task:'test'});
  h.handleTaskTurnEnd(t.taskId,{reason:{kind:'completed'},text:'请提供源目录\n[任务需补充]'});
  assert.equal(h.tasksStore[t.taskId].status,'waiting_input');
  assert.equal(h.getSocialV2State('private:123').pendingTaskReport.taskId,t.taskId);
  assert.equal(typeof h.taskCaps.taskInput,'function');
  await h.taskCaps.taskInput({token,taskId:t.taskId,input:'使用 fixture-project',requestId:'input-1'});
  assert.equal(h.tasksStore[t.taskId].status,'running');
  assert.equal(h.calls.created.filter(x=>x.agentPreset==='qq-task-worker').length,1);
  const delivered=h.calls.prompts.find(x=>x.sessionId===t.sessionId && x.content[0].text.includes('使用 fixture-project'));
  assert.ok(delivered);
  assert.doesNotMatch(delivered.content[0].text,/当前唤醒|沉睡|角色卡|科普/);
}));

test('terminal results survive duplicate or late task events', () => harness(async(h,token) => {
  const t = await h.taskCaps.taskSpawn({token,title:'test',task:'test'});
  h.handleTaskTurnEnd(t.taskId,{reason:{kind:'completed'},text:'产物：fixture.txt\n[任务完成]'});
  h.handleTaskTurnEnd(t.taskId,{reason:{kind:'error',error:{message:'late'}}});
  assert.equal(h.tasksStore[t.taskId].status,'done');
  assert.equal(h.tasksStore[t.taskId].error,'');
}));

test('worker preset contains work instructions without chat persona and sleep protocol', () => {
  const rows=yaml.load(fs.readFileSync(new URL('../dsh/agent-presets/qq-task-worker/agent.cordis.yml',import.meta.url),'utf8'));
  const text=rows.find(x=>x.id==='persona').config.prefix;
  assert.doesNotMatch(text,/用户|科普|普通|通用助手|友好交流|结巴|温柔|qq_wait_for_messages|qq_set_wake_config/);
  assert.ok(rows.some(x=>x.id==='task-tool-restrict'));
  assert.ok(!rows.some(x=>x.id==='tool-ask-user'));
});

test('repeating the same task input never starts a second delivery', () => harness(async(h,token) => {
  const t = await h.taskCaps.taskSpawn({token,title:'test',task:'test'});
  const input={token,taskId:t.taskId,input:'fixture-answer',requestId:'stable-input-1'};
  await h.taskCaps.taskInput(input);
  await h.taskCaps.taskInput(input);
  assert.equal(h.calls.prompts.filter(x=>x.sessionId===t.sessionId && x.content[0].text.includes('fixture-answer')).length,1);
  await assert.rejects(h.taskCaps.taskInput({...input,input:'different answer'}),/requestId/);
  await assert.rejects(h.taskCaps.taskInput({...input,token:'wrong-token'}),/仅管理员/);
}));

test('parallel task reports remain available until each result is collected',()=>harness(async(h,token)=>{
  h.socialV2.paused=true;
  const a=await h.taskCaps.taskSpawn({token,title:'a',task:'a'});
  const b=await h.taskCaps.taskSpawn({token,title:'b',task:'b'});
  h.handleTaskTurnEnd(a.taskId,{reason:{kind:'completed'},text:'a.txt\n[任务完成]'});
  h.handleTaskTurnEnd(b.taskId,{reason:{kind:'completed'},text:'需要输入\n[任务需补充]'});
  assert.equal(h.pluginHost.get('life-task-session').state.notices.length,2);
  await h.pluginHost.callTool('task_result',{token,taskId:a.taskId});
  assert.equal(h.pluginHost.get('life-task-session').state.notices.length,1);
  assert.equal(h.pluginHost.get('life-task-session').state.notices[0].taskId,b.taskId);
  await h.taskCaps.taskCancel({token,taskId:b.taskId});
  assert.equal(h.tasksStore[b.taskId].status,'cancelled');
}));

const workerEvent=(h,t,type,data)=>h.queueDshEnvelope({payload:{type:'session/event',sessionId:t.sessionId,event:{type,data}}});

test('a queued supplement keeps the task active until its own turn finishes',()=>harness(async(h,token)=>{
  h.socialV2.paused=true;
  const t=await h.taskCaps.taskSpawn({token,title:'test',task:'original'});
  await workerEvent(h,t,'turn/start',{turn:1});
  await h.taskCaps.taskInput({token,taskId:t.taskId,input:'supplement',requestId:'supplement-1'});
  h.handleTaskTurnEnd(t.taskId,{turn:1,reason:{kind:'completed'},text:'old result\n[任务完成]'});
  assert.equal(h.tasksStore[t.taskId].status,'running');
  const request=h.calls.prompts.find(x=>x.sessionId===t.sessionId && x.content[0].text.includes('supplement'));
  await workerEvent(h,t,'turn/start',{turn:2});
  await workerEvent(h,t,'user/message',{source:{kind:'user',rpcId:request.requestId},content:[]});
  h.handleTaskTurnEnd(t.taskId,{turn:2,reason:{kind:'completed'},text:'new result\n[任务完成]'});
  assert.equal(h.tasksStore[t.taskId].status,'done');
  assert.equal(h.tasksStore[t.taskId].result,'new result');
}));

test('a late input receipt cannot erase a newer worker question',()=>harness(async(h,token)=>{
  h.socialV2.paused=true;
  const t=await h.taskCaps.taskSpawn({token,title:'test',task:'original'});
  let release,wireId;
  const gate=new Promise(r=>release=r);
  h.api.sessions.prompt=async p=>{wireId=p.requestId;await gate;return {result:{ok:true,value:{accepted:true}}};};
  const sending=h.taskCaps.taskInput({token,taskId:t.taskId,input:'answer one',requestId:'answer-1'});
  await workerEvent(h,t,'turn/start',{turn:2});
  await workerEvent(h,t,'user/message',{source:{kind:'user',rpcId:wireId},content:[]});
  h.handleTaskTurnEnd(t.taskId,{turn:2,reason:{kind:'completed'},text:'Need another file\n[任务需补充]'});
  release();await sending;
  assert.equal(h.tasksStore[t.taskId].status,'waiting_input');
  assert.equal(h.tasksStore[t.taskId].pendingInput,'Need another file');
}));

test('worker approval is relayed and an explicit response is sent once without another prompt',()=>harness(async(h,token)=>{
  h.socialV2.paused=true;
  const t=await h.taskCaps.taskSpawn({token,title:'test',task:'original'}),responses=[];
  h.api.respond=async p=>{responses.push(p);return {result:{ok:true,value:{}}};};
  await workerEvent(h,t,'turn/start',{turn:1});
  await h.queueDshEnvelope({payload:{type:'approval/requested',sessionId:t.sessionId,clientId:'client-1',eventId:'approval-1',toolName:'pwsh',reason:'requested operation'}});
  const state=await h.taskCaps.taskResult({token,taskId:t.taskId});
  assert.equal(state.status,'waiting_input');
  assert.equal(state.pendingRequests[0].id,'approval-1');
  const reply={token,taskId:t.taskId,input:'allow this operation',requestId:'reply-1',replyToRequest:'approval-1',decision:'allowed-once'};
  await h.taskCaps.taskInput(reply);await h.taskCaps.taskInput(reply);
  assert.equal(responses.length,1);
  assert.equal(responses[0].eventId,'approval-1');
  assert.equal(responses[0].outcome.value,'allowed-once');
  assert.equal(h.calls.prompts.filter(x=>x.sessionId===t.sessionId).length,1);
}));

test('a definitely rejected input cannot hold the original task open',()=>harness(async(h,token)=>{
  h.socialV2.paused=true;
  const t=await h.taskCaps.taskSpawn({token,title:'test',task:'original'});
  h.api.sessions.prompt=async()=>({result:{ok:false,error:{code:'session/agent-busy',message:'not admitted'}}});
  await assert.rejects(h.taskCaps.taskInput({token,taskId:t.taskId,input:'extra',requestId:'rejected-1'}));
  assert.equal(h.tasksStore[t.taskId].inputs[0].delivery,'rejected');
  h.handleTaskTurnEnd(t.taskId,{turn:1,reason:{kind:'completed'},text:'original result\n[任务完成]'});
  assert.equal(h.tasksStore[t.taskId].status,'done');
}));

test('an explicit retry of uncertain input reuses its wire identity and receipt',()=>harness(async(h,token)=>{
  const t=await h.taskCaps.taskSpawn({token,title:'test',task:'original'}),ids=[];
  h.api.sessions.prompt=async p=>{ids.push(p.requestId);if(ids.length===1)throw Error('connection lost');return {result:{ok:true,value:{accepted:true}}};};
  const input={token,taskId:t.taskId,input:'extra',requestId:'uncertain-1'};
  await assert.rejects(h.taskCaps.taskInput(input));
  const result=await h.taskCaps.taskInput(input);
  assert.equal(result.delivery,'accepted');
  assert.equal(ids.length,2);
  assert.equal(ids[0],ids[1]);
  assert.equal(h.tasksStore[t.taskId].inputs.length,1);
}));

test('a late definite rejection settles an already finished original turn',()=>harness(async(h,token)=>{
  h.socialV2.paused=true;
  const t=await h.taskCaps.taskSpawn({token,title:'test',task:'original'});let release;
  const gate=new Promise(r=>release=r);
  h.api.sessions.prompt=async()=>{await gate;return {result:{ok:false,error:{code:'session/agent-busy',message:'not admitted'}}};};
  const sending=h.taskCaps.taskInput({token,taskId:t.taskId,input:'extra',requestId:'late-reject-1'});
  h.handleTaskTurnEnd(t.taskId,{turn:1,reason:{kind:'completed'},text:'Original done\n[任务完成]'});
  assert.equal(h.tasksStore[t.taskId].status,'running');
  release();await assert.rejects(sending);
  assert.equal(h.tasksStore[t.taskId].status,'done');
  assert.equal(h.tasksStore[t.taskId].result,'Original done');
}));

const historyFixture=(text='Recovered result\n[任务完成]')=>[
{type:'event',event:{seq:1,type:'turn/start',data:{turn:1}}},
{type:'event',event:{seq:2,type:'assistant/message',data:{turn:1,message:{content:[{type:'text',text}]}}}},
{type:'event',event:{seq:3,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}}
];
test('task_result reconciles a missed turn end through bounded session history',()=>harness(async(h,token)=>{
 h.socialV2.paused=true;const t=await h.taskCaps.taskSpawn({token,title:'recover',task:'original'});
 h.api.callUnary=async(method)=>({result:{ok:true,value:method==='session/projections'?{asOfSeq:3,values:{inbox:{'next-turn':[],'next-step':[]}}}:{records:historyFixture(),hasMore:false}}});
 const result=await h.taskCaps.taskResult({token,taskId:t.taskId});
 assert.equal(result.status,'done');assert.equal(result.result,'Recovered result');
 assert.equal(h.tasksStore[t.taskId].status,'done');
}));
test('a reconnect snapshot repairs task state without replaying QQ replies',()=>harness(async(h,token)=>{
 h.socialV2.paused=true;const t=await h.taskCaps.taskSpawn({token,title:'recover',task:'original'});
 await h.queueDshEnvelope({payload:{type:'session/snapshot',sessionId:t.sessionId,snapshot:{records:historyFixture(),projections:{values:{inbox:{'next-turn':[],'next-step':[]}}}}}});
 assert.equal(h.tasksStore[t.taskId].status,'done');assert.equal(h.calls.sent.length,0);
}));
test('recovery ignores partial history, newer open turns and cancelled tasks',async()=>{
 const {recoverTask}=await import('../plugins/qq-components/life-task-session/task-policy.mjs');
 const record={status:'running',inputs:[]};
 assert.equal(recoverTask({record,records:historyFixture().slice(1)}),null);
 assert.equal(recoverTask({record,records:[...historyFixture(),{seq:4,type:'turn/start',data:{turn:2}}]}).activeTurn,2);
 assert.equal(recoverTask({record:{status:'cancelled'},records:historyFixture()}),null);
 assert.equal(recoverTask({record,records:historyFixture(),pendingInbox:true}).status,'running');
});

test('hot reload refreshes task policy dependencies and preserves task tool registration',async()=>{
 const os=await import('node:os'),path=await import('node:path'),{pathToFileURL}=await import('node:url');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task-policy-reload-'));
 try{
  fs.copyFileSync(new URL('../plugins/qq-components/life-task-session/index.js',import.meta.url),path.join(dir,'index.mjs'));
  const original=fs.readFileSync(new URL('../plugins/qq-components/life-task-session/task-policy.mjs',import.meta.url),'utf8');
  const entry=pathToFileURL(path.join(dir,'index.mjs')).href;
  for(const version of ['first','second']){
   fs.writeFileSync(path.join(dir,'task-policy.mjs'),original+'\nexport const generation='+JSON.stringify(version)+';');
   const mod=await import(entry+'?generation='+version),tools=[];
   const instance=mod.createPlugin({registerTool:name=>tools.push(name),capabilities:{},state:{get:()=>({})}});
   assert.deepEqual(tools.sort(),['task_cancel','task_input','task_list','task_result','task_spawn']);
   const policy=await import(pathToFileURL(path.join(dir,'task-policy.mjs')).href+'?generation='+version);
   assert.equal(policy.generation,version);assert.equal(instance.services['task-session'].prompt,policy.buildTaskPrompt);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('reconnect restores consumption of an input in an unfinished turn',()=>harness(async(h,token)=>{
 h.socialV2.paused=true;const t=await h.taskCaps.taskSpawn({token,title:'recover',task:'original'});
 await workerEvent(h,t,'turn/start',{turn:1});
 await h.taskCaps.taskInput({token,taskId:t.taskId,input:'extra',requestId:'open-turn-input'});
 const receipt=h.tasksStore[t.taskId].inputs[0];
 const records=[{seq:10,type:'turn/start',data:{turn:2}},{seq:11,type:'user/message',data:{source:{rpcId:receipt.wireId}}}];
 await h.queueDshEnvelope({payload:{type:'session/snapshot',sessionId:t.sessionId,snapshot:{records}}});
 assert.equal(h.tasksStore[t.taskId].activeTurn,2);assert.equal(h.tasksStore[t.taskId].inputs[0].consumedTurn,2);
 h.handleTaskTurnEnd(t.taskId,{turn:2,seq:12,reason:{kind:'completed'},text:'final\n[任务完成]'});
 assert.equal(h.tasksStore[t.taskId].status,'done');
}));

test('reconnect settles closed input turns even while a later turn remains open',async()=>{
 const {recoverTask,taskTransition}=await import('../plugins/qq-components/life-task-session/task-policy.mjs');
 const record={status:'running',activeTurn:1,inputs:[{wireId:'input-2',kind:'prompt',consumedTurn:null,settled:false}]};
 const records=[{seq:10,type:'turn/start',data:{turn:2}},{seq:11,type:'user/message',data:{source:{rpcId:'input-2'}}},{seq:12,type:'turn/end',data:{turn:2,reason:{kind:'completed'}}},{seq:13,type:'turn/start',data:{turn:3}}];
 const patch=recoverTask({record,records});assert.equal(patch.inputs[0].settled,true);
 assert.equal(taskTransition({record:{...record,...patch},ended:{turn:3,reason:{kind:'completed'},text:'Done\n[任务完成]'}}).status,'done');
});
