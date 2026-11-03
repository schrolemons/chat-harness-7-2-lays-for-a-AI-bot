import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const api=await import('../src/instance-runtime-ipc.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const clientUrl=new URL('../src/instance-runtime-ipc.mjs',import.meta.url).href;
async function childFixture(t){
  assert.equal(typeof api.bindOwnedRuntimeIpc,'function');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-ipc-'));
  const script=path.join(root,'child.mjs');
  await fs.writeFile(script,`import {createRuntimeIpcClient} from ${JSON.stringify(clientUrl)};
const client=createRuntimeIpcClient({instanceId:'fixture',generation:'one'});
process.on('message',async m=>{if(m.test==='record'){try{const result=await client.recordCreatedSession(m.record);process.send({test:'result',result});}catch(e){process.send({test:'result',error:e.code});}}
if(m.test==='raw')process.send(m.payload);if(m.test==='worker'){try{process.send({test:'result',result:await client.spawnWorker('campus-watch',[])});}catch(e){process.send({test:'result',error:e.code});}}});
process.send({test:'ready'});`);
  const child=spawn(process.execPath,[script],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const end=once(child,'exit');child.kill();await end;}await fs.rm(root,{recursive:true,force:true});});
  await once(child,'message');return child;
}
function result(child){return new Promise(resolve=>{const listener=m=>{if(m.test==='result'){child.off('message',listener);resolve(m);}};child.on('message',listener);});}
test('owned child IPC records only explicit IDs, acknowledges durability and drains before detach',async t=>{
  const child=await childFixture(t);let release,entered;const gate=new Promise(r=>release=r),atRecord=new Promise(r=>entered=r),records=[];
  const channel=api.bindOwnedRuntimeIpc({child,instanceId:'fixture',generation:'one',isActive:()=>true,
    recordCreatedSession:async r=>{records.push(r);entered();await gate;return {ok:true};}});
  const answer=result(child);let acknowledged=false;answer.then(()=>acknowledged=true);
  child.send({test:'record',record:{sessionId:'new-session',workspaceId:'new-workspace'}});await atRecord;
  assert.equal(acknowledged,false);channel.closeAdmission();let drained=false;const drain=channel.drain().then(()=>drained=true);await new Promise(r=>setImmediate(r));assert.equal(drained,false);
  release();assert.deepEqual((await answer).result,{ok:true});await drain;assert.deepEqual(records,[{sessionId:'new-session',workspaceId:'new-workspace'}]);
  const late=result(child);child.send({test:'record',record:{sessionId:'late',workspaceId:'w'}});assert.equal((await late).error,'RUNTIME_CLOSING');channel.detach();
});
test('malformed IDs, stale generations and unsupported methods never call recorder or worker',async t=>{
  const child=await childFixture(t),records=[];
  const channel=api.bindOwnedRuntimeIpc({child,instanceId:'fixture',generation:'one',isActive:()=>true,recordCreatedSession:r=>records.push(r)});t.after(()=>channel.detach());
  const reply=result(child);child.send({test:'record',record:{sessionId:'s',workspaceId:'w',path:'invented'}});assert.equal((await reply).error,'IPC_REQUEST_INVALID');
  child.send({test:'raw',payload:{type:'qq-bridge:request',version:1,instanceId:'other',generation:'old',id:'forged',method:'session.recordCreated',params:{sessionId:'s',workspaceId:'w'}}});
  const worker=result(child);child.send({test:'worker'});assert.equal((await worker).error,'WORKER_UNSUPPORTED');assert.deepEqual(records,[]);
});
test('recorder failure preserves the reported IDs and never invokes replacement creation',async t=>{
  const child=await childFixture(t),records=[];
  const channel=api.bindOwnedRuntimeIpc({child,instanceId:'fixture',generation:'one',isActive:()=>true,recordCreatedSession:r=>{records.push(r);throw Object.assign(Error('unsupported host'),{code:'OWNERSHIP_UNSUPPORTED'});}});t.after(()=>channel.detach());
  const reply=result(child);child.send({test:'record',record:{sessionId:'keep-id',workspaceId:'keep-workspace'}});assert.equal((await reply).error,'OWNERSHIP_UNSUPPORTED');assert.deepEqual(records,[{sessionId:'keep-id',workspaceId:'keep-workspace'}]);
});
