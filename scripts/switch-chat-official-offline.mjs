import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import{normalizeModelPolicy}from'../plugins/qq-components/obs-cost-policy/policy.mjs';
const root=JSON.parse(fs.readFileSync('workspace.local.json')).runtimeRoot;
const file=path.join(root,'state/plugins/config/obs-cost-policy.json'),audit=path.join(root,'state/audits/response-flow-20261112');
// Only use this path while the owning bridge is stopped. A live bridge must use
// its revision-checked Console API and confirm session synchronization.
try{const r=await fetch('http://127.0.0.1:3100/api/health',{signal:AbortSignal.timeout(1000)});if(r)throw Error('Bridge responds; use its authenticated API');}catch(e){if(!['ECONNREFUSED'].includes(e.cause?.code))throw e;}
const before=fs.readFileSync(file,'utf8'),old=normalizeModelPolicy(JSON.parse(before));
const selection={provider:'deepseek-official',model:'deepseek-flash',effort:'off'};
const next=normalizeModelPolicy({...old,conversation:selection,presets:{...old.presets,'qq-memory-worker':selection}});
assert.deepEqual(next.task,old.task);assert.deepEqual(next.presets['qq-task-worker'],old.presets['qq-task-worker']);
fs.mkdirSync(audit,{recursive:true});const backup=path.join(audit,'model-policy-before-official.json');if(!fs.existsSync(backup))fs.writeFileSync(backup,before);
if(fs.readFileSync(file,'utf8')!==before)throw Error('Model policy changed concurrently');
const temporary=file+'.official-candidate-'+process.pid;fs.writeFileSync(temporary,JSON.stringify(next,null,2)+'\n');fs.renameSync(temporary,file);
assert.deepEqual(normalizeModelPolicy(JSON.parse(fs.readFileSync(file))),next);
const result={at:Date.now(),saved:true,liveApplied:false,reason:'bridge stopped',conversation:next.conversation,memoryWorker:next.presets['qq-memory-worker'],taskDefaultUnchanged:true,taskRangeUnchanged:true};
fs.writeFileSync(path.join(audit,'official-model-switch.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
