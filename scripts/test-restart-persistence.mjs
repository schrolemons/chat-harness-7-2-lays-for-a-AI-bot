import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {pathToFileURL,fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=(code,args=[])=>new Promise((resolve,reject)=>execFile(process.execPath,['--input-type=module','-e',code,...args],{windowsHide:true,timeout:10000},(e,out,err)=>e?reject(Error(err||e.message)):resolve(JSON.parse(out))));
test('real separate processes restore, reschedule and cancel persistent contact plans',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'availability-restart-'));
 try{
  for(const id of ['life-scheduler','life-user-availability']){const original=path.join(repo,'plugins/qq-components',id),dir=path.join(root,'plugins/qq-components',id);fs.mkdirSync(dir,{recursive:true});const manifest=JSON.parse(fs.readFileSync(path.join(original,'plugin.json')));fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify({...manifest,main:'index.mjs'}));fs.writeFileSync(path.join(dir,'index.mjs'),'export {createPlugin} from '+JSON.stringify(pathToFileURL(path.join(original,'index.js')).href)+';');}
  const code='import {createPluginHost} from '+JSON.stringify(pathToFileURL(path.join(repo,'src/plugin-host.js')).href)+';const h=createPluginHost({root:process.argv[1],startTimers:false});await h.loadAll();const mode=process.argv[2],key="private:1";if(mode==="create")h.callService("availability","setPlan",{key,kind:"later",contactISO:new Date(Date.now()+3600000).toISOString(),reason:"fixture"});h.callService("availability","restore",{});if(mode==="cancel")h.callService("availability","cancelPlan",{key});if(mode==="complete"){const p=h.get("life-user-availability").state.plans[key];h.callService("availability","markDispatched",{key,id:p.id});}const plan=h.get("life-user-availability").state.plans[key];console.log(JSON.stringify({plan:!!plan,finished:plan?.finished||null,scheduled:h.callService("scheduler","status").types.includes("user-availability")}));await h.dispose();';
  assert.equal((await run(code,[root,'create'])).scheduled,true);
  assert.equal((await run(code,[root,'inspect'])).scheduled,true);
  await run(code,[root,'cancel']);assert.equal((await run(code,[root,'inspect'])).scheduled,false);
  await run(code,[root,'create']);await run(code,[root,'complete']);const done=await run(code,[root,'inspect']);assert.equal(done.finished,'dispatched');assert.equal(done.scheduled,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('two real processes cannot claim the same notification twice',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-race-'));try{const file=path.join(root,'receipts.json');const code='import {createDeliveryLedger} from '+JSON.stringify(pathToFileURL(path.join(repo,'plugins/qq-components/life-scheduler/delivery-ledger.mjs')).href)+';console.log(JSON.stringify(createDeliveryLedger({file:process.argv[1]}).claim({id:"one-source-notification",expiresAt:Date.now()+10000})));';const results=await Promise.all([run(code,[file]),run(code,[file])]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal((await run(code,[file])).ok,false);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
