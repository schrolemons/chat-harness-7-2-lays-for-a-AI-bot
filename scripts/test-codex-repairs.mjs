import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/obs-self-review/index.js';
import fs from 'node:fs';
import path from 'node:path';
import {bridgeHarness} from './audit-bridge-harness.mjs';

function fixture(enabled=true){
 let state={issueLedgerMigrated:true,issueSchemaVersion:2,issueLedger:[{id:'issue-a',queue:'self',origin:'tool',status:'待修复',text:'a'},{id:'issue-b',queue:'self',origin:'tool',status:'待修复',text:'b'}]};
 const plugin=createPlugin({config:{codexRepairEnabled:enabled},state:{get:()=>structuredClone(state),set:p=>{state={...state,...structuredClone(p)};}},capabilities:{getFeedbackReports:()=>[]}});
 return {service:plugin.services.selfReviewFeedback,state:()=>state};
}
const batch=()=>({runId:'codex-test-run-1',items:[{id:'issue-a',summary:'修复等待器',evidence:['隔离取消/重入回归通过'],classification:'code_fix'},{id:'issue-b',summary:'复核当前鉴权正常',evidence:['当前已认证状态读取成功'],classification:'already_fixed'}]});

test('repair batch validates all entries before changing state and supports a write-free dry run',()=>{
 const f=fixture(),bad=batch();bad.items[1].id='missing';
 assert.equal(typeof f.service.repairBatch,'function');
 assert.equal(f.service.repairBatch(bad).ok,false);assert(f.state().issueLedger.every(x=>x.status==='待修复'));
 assert.equal(f.service.repairBatch({...batch(),dryRun:true}).dryRun,true);assert(f.state().issueLedger.every(x=>x.status==='待修复'));
 const done=f.service.repairBatch(batch());assert.equal(done.ok,true);assert.equal(done.resolvedCount,2);
 assert.equal(f.service.listFeedback().counts.completed,2);assert.equal(f.service.listFeedback().counts.selfPending,0);
});
test('a retried batch preserves its log outbox, creates no duplicate event, and rejects changed evidence',()=>{
 const f=fixture(),first=f.service.repairBatch(batch()),events=f.state().queueEvents.length;
 const retry=f.service.repairBatch(batch());assert.equal(retry.replayed,true);assert.equal(retry.logSynced,false);assert.equal(retry.marker,first.marker);assert.equal(f.state().queueEvents.length,events);
 const conflict=batch();conflict.items[0].summary='别的修复';assert.equal(f.service.repairBatch(conflict).statusCode,409);
 assert.equal(f.service.markRepairBatchLogged({runId:first.runId,marker:first.marker}).ok,true);
 assert.equal(f.service.repairBatch(batch()).logSynced,true);
});
test('disabled interface, empty evidence, duplicate IDs and active research cannot close issues',()=>{
 assert.equal(fixture(false).service.repairBatch(batch()).statusCode,403);
 const f=fixture(),empty=batch();empty.items[0].evidence=[];assert.equal(f.service.repairBatch(empty).ok,false);
 const duplicate=batch();duplicate.items[1].id='issue-a';assert.equal(f.service.repairBatch(duplicate).ok,false);
 f.state().issueLedger[0].processingTaskId='task-live';assert.equal(f.service.repairBatch(batch()).statusCode,409);delete f.state().issueLedger[0].processingTaskId;
 assert.equal(f.service.repairBatch(batch()).resolvedCount,2);
 assert.equal(fixture().service.repairBatch({...batch(),runId:'constructor'}).ok,true);
});

async function serverFixture(){
 const h=await bridgeHarness();h.setMode('reserved2');h.pluginHost.setConfig('obs-self-review',{codexRepairEnabled:true});await h.pluginHost.reload('obs-self-review');
 h.pluginHost.callService('selfReviewFeedback','ingestToolFeedback',{entry:{id:'fixture-issue',message:'测试问题',time:new Date().toISOString()}});
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const body={runId:'fixture-api-run',items:[{id:'fixture-issue',summary:'取消旧等待器已修复',evidence:['取消与新回合接管隔离验证通过']}]};
 const call=async(data,extra={})=>{const r=await fetch(base+'/api/socialV2/self-review-feedback/repairs',{method:'POST',headers:{'x-console-token':'fixture-console-token',origin:base,'content-type':'application/json',connection:'close',...extra},body:JSON.stringify(data),signal:AbortSignal.timeout(5000)});return {status:r.status,data:await r.json()};};
 return {h,body,call,base,close:async()=>{await new Promise(r=>server.close(r));await h.close();}};
}
test('authenticated endpoint writes the existing repair Markdown and updates counts exactly once',async()=>{
 const f=await serverFixture();try{
  assert.equal((await f.call(f.body,{'x-console-token':'wrong'})).status,401);
  assert.equal((await f.call(f.body,{'x-agent-token':'ordinary-agent'})).status,403);
  assert.equal((await f.call({...f.body,dryRun:true})).data.dryRun,true);
  const first=await f.call(f.body);assert.equal(first.status,200);assert.equal(first.data.counts.completed,1);assert.equal(first.data.counts.selfPending,0);
  const file=path.join(f.h.temp,'state/memory/_optimization.md'),text=fs.readFileSync(file,'utf8');assert.match(text,/fixture-issue/);assert.match(text,/取消与新回合接管/);assert.match(text,/codex-repair:/);
  const second=await f.call(f.body);assert.equal(second.data.replayed,true);assert.equal(fs.readFileSync(file,'utf8'),text);
 }finally{await f.close();}
});

test('turning Codex assistance off reports disabled and rejects dry runs and commits without changing issues or logs',async()=>{
 const f=await serverFixture();try{
  assert.equal(f.h.pluginHost.setConfig('obs-self-review',{codexRepairEnabled:false}).ok,true);
  await f.h.pluginHost.reload('obs-self-review');
  const base=f.base;
  const definition=await fetch(base+'/api/socialV2/self-review-feedback/repairs',{headers:{'x-console-token':'fixture-console-token',connection:'close'}});
  assert.equal(definition.status,200);assert.equal((await definition.json()).enabled,false);
  const agentHeaders={'x-console-token':'fixture-console-token','x-agent-token':'ordinary-agent',origin:base,connection:'close'};
  const agentRead=await fetch(base+'/api/socialV2/self-review-feedback/repairs',{headers:agentHeaders});assert.equal(agentRead.status,403);await agentRead.text();
  const enableAttempt=await fetch(base+'/api/plugins/config',{method:'POST',headers:{...agentHeaders,'content-type':'application/json'},body:JSON.stringify({id:'obs-self-review',config:{codexRepairEnabled:true}})});
  assert.equal(enableAttempt.status,403);await enableAttempt.text();
  assert.equal(f.h.pluginHost.get('obs-self-review').config.codexRepairEnabled,false);
  const before=structuredClone(f.h.pluginHost.callService('selfReviewFeedback','listFeedback',{}));
  for(const dryRun of [true,false]){const denied=await f.call({...f.body,dryRun});assert.equal(denied.status,403);assert.match(denied.data.error,/未启用/);}
  const agent=await f.call(f.body,{'x-agent-token':'ordinary-agent'});assert.equal(agent.status,403);
  assert.deepEqual(f.h.pluginHost.callService('selfReviewFeedback','listFeedback',{}),before);
  assert.equal(fs.existsSync(path.join(f.h.temp,'state/memory/_optimization.md')),false);
 }finally{await f.close();}
});
test('Markdown failure is reported and an identical retry repairs only the missing log',async()=>{
 const f=await serverFixture();try{
  const obstacle=path.join(f.h.temp,'state/memory/obstructed');fs.mkdirSync(path.dirname(obstacle),{recursive:true});fs.writeFileSync(obstacle,'fixture');f.h.cfg.socialV2.selfReview.memoryFile='state/memory/obstructed/_optimization.md';
  const failed=await f.call(f.body);assert.equal(failed.status,503);assert.equal(failed.data.stateCommitted,true);assert.equal(failed.data.logSynced,false);assert.equal(failed.data.counts.completed,1);
  fs.unlinkSync(obstacle);const retried=await f.call(f.body);assert.equal(retried.status,200);assert.equal(retried.data.replayed,true);assert.equal(retried.data.counts.completed,1);assert.match(fs.readFileSync(path.join(obstacle,'_optimization.md'),'utf8'),/fixture-issue/);
 }finally{await f.close();}
});
