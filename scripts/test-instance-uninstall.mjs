import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {planInstanceCleanup,executeInstanceCleanup} from '../src/instance-uninstall-plan.mjs';
import {cleanupFixture} from './native-session-cleanup-fixture.mjs';
import {sha256,rowHash} from '../src/instance-cleanup-files.mjs';
import {DatabaseSync} from 'node:sqlite';
async function nativePlan(f){
 // Fixture owner explicitly quiesces before the read-only planner. Refusal remains a plan conflict.
 try{await f.stoppedSnapshot();}catch{}
 return planInstanceCleanup(await f.manifest(),{sessionStoreAdapter:f.adapter});
}


test('missing and empty ownership never authorize cleanup',async()=>{
  for(const value of [undefined,null,{}, {sessions:[],paths:[]}]) {
    const plan=await planInstanceCleanup(value);
    assert(plan.conflicts.length);
    const receipt=await executeInstanceCleanup(plan,{expectedManifestHash:plan.manifestHash});
    assert.equal(receipt.status,'conflict');
  }
});

test('native offline full receipt cleanup reconciles list/search/catalog/cache/workspace and removes exact fresh code last',async t=>{
 const f=await cleanupFixture(t);await f.primeCatalog();const historical=await f.addHistorical();
 const cache=JSON.parse(await fs.readFile(path.join(f.home,'storages','session_projcache','sessions','alpha-session.json'),'utf8'));assert.equal(cache.record.rows.synthetic?.val.body,'synthetic cached alpha-session');
 const db=new DatabaseSync(path.join(f.home,'query.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM persisted_docs WHERE session_id = ?').get('alpha-session').n,1);}finally{db.close();}
 const preserved=await Promise.all(f.records.filter(r=>!r.header.id.startsWith('alpha-')).map(async r=>({path:r.path,hash:sha256(await fs.readFile(r.path))})));
 // Creation hashes of mutable bot state are not permanent byte locks.
 await fs.writeFile(path.join(f.root,'config.json'),'{"synthetic":true,"normalMutation":1}');
 const plan=await nativePlan(f);assert.deepEqual(plan.conflicts,[]);
 await assert.rejects(f.launch(),/LAUNCH_FROZEN/);
 const phases=[];const receipt=await executeInstanceCleanup(plan,{expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter,onStep:step=>phases.push(step.phase)});
 assert.equal(receipt.status,'complete',JSON.stringify(receipt.conflicts));
 assert(phases.indexOf('native-verified')<phases.indexOf('data'));assert(phases.lastIndexOf('profile')<phases.indexOf('code'));
 await assert.rejects(fs.stat(f.root),{code:'ENOENT'});await assert.rejects(fs.stat(historical),{code:'ENOENT'});
 for(const p of preserved)assert.equal(sha256(await fs.readFile(p.path)),p.hash);
 assert.deepEqual(receipt.native.listed.slice().sort(),['beta-session','ordinary-session']);
 assert.deepEqual(receipt.native.catalogIds.slice().sort(),['beta-session','ordinary-session']);
 assert(receipt.native.pinned.includes('beta-session'));assert.equal(receipt.native.archived.length,0);
 assert((await fs.readFile(path.join(f.profile,'cordis.patch.yml'),'utf8')).includes('# Keep unrelated comment'));
 const pkg=JSON.parse(await fs.readFile(path.join(f.profile,'package.json'),'utf8'));assert.equal(pkg.dependencies.unrelated,'1.0.0');assert.deepEqual(pkg.dsh.profile.bundles,['unrelated']);
 const inventory=JSON.parse(await fs.readFile(path.join(f.home,'bot-instances','installation-roots.json'),'utf8'));assert.deepEqual(inventory.roots.map(r=>r.instanceId),['beta']);
 assert(!receipt.journalPath.startsWith(f.root+path.sep));assert.equal(JSON.parse(await fs.readFile(receipt.journalPath,'utf8')).status,'complete');
 const repeated=await executeInstanceCleanup(plan,{expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter});assert.equal(repeated.status,'complete',JSON.stringify(repeated.conflicts));
});

for(const phase of ['prepared','session-intent','session-file','native-verified','data','dependency','profile','registration','code'])test(`interruption at ${phase} retries exact targets, never removes code early`,async t=>{
 const f=await cleanupFixture(t),plan=await nativePlan(f);assert.deepEqual(plan.conflicts,[]);
 let injected=false;const options={expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter};
 const first=await executeInstanceCleanup(plan,{...options,onStep:step=>{if(!injected&&step.phase===phase){injected=true;throw Error('synthetic interruption');}}});
 assert.equal(first.status,'interrupted');assert(injected);
 if(phase!=='code')assert(await fs.stat(path.join(f.root,'entry.mjs')));
 const second=await executeInstanceCleanup(plan,options);assert.equal(second.status,'complete',JSON.stringify(second.conflicts));
});

test('changed manifest and changed plan are rejected before deletion',async t=>{
 const f=await cleanupFixture(t),plan=await nativePlan(f);
 let result=await executeInstanceCleanup(plan,{expectedManifestHash:'changed',sessionStoreAdapter:f.adapter});assert.equal(result.conflicts[0].code,'MANIFEST_CHANGED');
 const changed=structuredClone(plan);changed.paths=[];result=await executeInstanceCleanup(changed,{expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter});assert.equal(result.conflicts[0].code,'PLAN_CHANGED');
 const file=path.join(f.root,'.qq-bridge-instance-manifest.json'),m=await f.manifest();m.sessions[0].cleanup='preserve';await fs.writeFile(file,JSON.stringify(m));
 result=await executeInstanceCleanup(plan,{expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter});assert.equal(result.conflicts[0].code,'MANIFEST_CHANGED');assert(await fs.stat(f.records[0].path));
});

for(const mutation of ['fingerprint','another-bot','ordinary','unknown-generation','legacy-cache','cache-backup','hardlink','junction','dependency-change','unknown-code','external-data'])test(`refuses ${mutation} and preserves session/code`,async t=>{
 const f=await cleanupFixture(t);await f.stoppedSnapshot();const manifestFile=path.join(f.root,'.qq-bridge-instance-manifest.json');let m=await f.manifest();
 if(mutation==='fingerprint')m.sessions[0].headerFingerprint='wrong';
 if(mutation==='another-bot'||mutation==='ordinary'){const r=f.records.find(r=>r.header.id===(mutation==='another-bot'?'beta-session':'ordinary-session'));m.sessions.push({...m.sessions[0],sessionId:r.header.id,workspaceId:r.workspaceId,path:r.path});}
 if(mutation==='external-data')m.paths.push({...m.paths[1],path:path.join(f.beta,'unowned.json')});
 await fs.writeFile(manifestFile,JSON.stringify(m));
 if(mutation==='unknown-generation')await fs.writeFile(path.join(path.dirname(f.records[0].path),'session.v2.jsonl'),'unknown');
 if(mutation==='legacy-cache')await fs.writeFile(path.join(f.home,'storages','session_projcache.json'),'{}');
 if(mutation==='cache-backup')await fs.writeFile(path.join(f.home,'storages','session_projcache','sessions','alpha-session.json.bak.unknown'),'{}');
 if(mutation==='hardlink'){const source=f.records[0].path;await fs.link(source,path.join(f.dir,'hardlink-copy'));}
 if(mutation==='junction'){const directory=path.dirname(f.records[0].path),outside=path.join(f.dir,'moved-session');await fs.rename(directory,outside);await fs.symlink(outside,directory,process.platform==='win32'?'junction':'dir');}
 if(mutation==='dependency-change')await fs.writeFile(path.join(f.root,'node_modules','example','index.js'),'changed');
 if(mutation==='unknown-code')await fs.writeFile(path.join(f.root,'unowned.txt'),'preserve');
 const plan=await nativePlan(f);assert(plan.conflicts.length,mutation);assert(await fs.stat(f.records[0].path));assert(await fs.stat(path.join(f.root,'entry.mjs')));
});

test('shared workspace retains ordinary membership, title and registration',async t=>{
 const f=await cleanupFixture(t,{shared:true}),plan=await nativePlan(f);assert.deepEqual(plan.conflicts,[]);
 const before=plan.native.snapshot.workspaces.find(w=>w.id===f.records[0].workspaceId),receipt=await executeInstanceCleanup(plan,{expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter});assert.equal(receipt.status,'complete',JSON.stringify(receipt.conflicts));
 const after=receipt.native.workspaces.find(w=>w.id===before.id);assert.equal(after.title,before.title);assert.deepEqual(after.sessionIds,['ordinary-session']);
});

test('retry rejects a new unknown descendant without expanding deletion targets',async t=>{
 const f=await cleanupFixture(t),plan=await nativePlan(f);
 const options={expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter};let injected=false;
 const first=await executeInstanceCleanup(plan,{...options,onStep:s=>{if(s.phase==='session-file'&&!injected){injected=true;throw Error('crash');}}});assert.equal(first.status,'interrupted');
 const foreign=path.join(path.dirname(f.records[0].path),'new-file');await fs.writeFile(foreign,'preserve');
 const second=await executeInstanceCleanup(plan,options);assert.equal(second.status,'interrupted');assert(await fs.stat(foreign));assert(await fs.stat(path.join(f.root,'entry.mjs')));
});

test('successful native create with recording failure blocks empty manifest before mutation',async t=>{
 const f=await cleanupFixture(t);await f.seedUnrecorded();const file=path.join(f.root,'.qq-bridge-instance-manifest.json'),m=await f.manifest();m.sessions=[];await fs.writeFile(file,JSON.stringify(m));
 const plan=await nativePlan(f);assert(plan.conflicts.some(c=>c.code==='UNRECORDED_WORKSPACE_SESSION'));
 assert(await fs.stat(f.records[0].path));assert(await fs.stat(path.join(f.root,'entry.mjs')));
});

test('unknown writer authority refuses and preserves every artifact',async t=>{
 const f=await cleanupFixture(t);f.revokeOwner();const plan=await nativePlan(f);
 assert(plan.conflicts.some(c=>c.code==='UNSUPPORTED_SESSION_DELETE'));assert(await fs.stat(f.records[0].path));
});

test('planning never stops a live writer or freezes its admission implicitly',async t=>{
 const f=await cleanupFixture(t),plan=await planInstanceCleanup(await f.manifest(),{sessionStoreAdapter:f.adapter});
 assert(plan.conflicts.some(c=>c.code==='UNSUPPORTED_SESSION_DELETE'));assert((await f.seedUnrecorded())[0].header.id==='unrecorded-session');assert(await fs.stat(f.records[0].path));
});

test('an additional active home writer prevents cleanup without stopping that writer',async t=>{
 const f=await cleanupFixture(t),other=await f.launch();
 try{const plan=await nativePlan(f);assert(plan.conflicts.some(c=>c.code==='UNSUPPORTED_SESSION_DELETE'));assert.equal(other.child.exitCode,null);assert((await other.call('snapshot')).listed.includes('alpha-session'));assert(await fs.stat(f.records[0].path));}
 finally{await other.stop();}
});

test('a shared management lease blocks deletion and is never guessed stale',async t=>{
 const f=await cleanupFixture(t),plan=await nativePlan(f),lock=path.join(f.home,'bot-instances','installation-roots.json.lock');await fs.mkdir(lock);
 const result=await executeInstanceCleanup(plan,{expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter});assert.equal(result.conflicts[0].code,'CLEANUP_BUSY');assert(await fs.stat(lock));assert(await fs.stat(f.records[0].path));
});

test('disabled durable index never counts as complete deletion',async t=>{
 const f=await cleanupFixture(t);await f.stoppedSnapshot();const original=f.owner.snapshotForCleanup.bind(f.owner);
 f.owner.snapshotForCleanup=async m=>{const e=await original(m);e.indexes[0].enabled=false;return e;};
 const plan=await nativePlan(f);assert(plan.conflicts.some(c=>c.code==='UNSUPPORTED_SESSION_DELETE'));assert(await fs.stat(f.records[0].path));
});

test('unexplained missing primary with surviving cache is a conflict, not already deleted',async t=>{
 const f=await cleanupFixture(t);await f.stoppedSnapshot();await fs.unlink(f.records[0].path);
 const plan=await nativePlan(f);assert(plan.conflicts.length);assert(await fs.stat(path.join(f.home,'storages','session_projcache','sessions','alpha-session.json')));assert(await fs.stat(path.join(f.root,'entry.mjs')));
});

test('failed native reconciliation preserves data/code and later retries the same target set',async t=>{
 const f=await cleanupFixture(t),plan=await nativePlan(f),original=f.owner.reconcile.bind(f.owner);
 f.owner.reconcile=async()=>{throw Error('synthetic native verification unavailable');};
 const options={expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter};const first=await executeInstanceCleanup(plan,options);assert.equal(first.status,'interrupted');assert(await fs.stat(path.join(f.root,'entry.mjs')));assert(await fs.stat(path.join(f.root,'config.json')));
 f.owner.reconcile=original;const second=await executeInstanceCleanup(plan,options);assert.equal(second.status,'complete',JSON.stringify(second.conflicts));
});

test('developer Git source, metadata and unknown backups are preserved while explicit working data is cleaned',async t=>{
 const f=await cleanupFixture(t),file=path.join(f.root,'.qq-bridge-instance-manifest.json'),m=await f.manifest();m.paths.find(r=>r.kind==='code').cleanup='preserve';await fs.writeFile(file,JSON.stringify(m));
 await fs.mkdir(path.join(f.root,'.git'));await fs.writeFile(path.join(f.root,'unknown-backup.txt'),'preserve');
 const plan=await nativePlan(f);assert.deepEqual(plan.conflicts,[]);
 const receipt=await executeInstanceCleanup(plan,{expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter});assert.equal(receipt.status,'complete',JSON.stringify(receipt.conflicts));
 for(const name of ['.git','entry.mjs','.qq-bridge-instance.json','.qq-bridge-instance-manifest.json','unknown-backup.txt'])assert(await fs.stat(path.join(f.root,name)));
 await assert.rejects(fs.stat(path.join(f.root,'state')),{code:'ENOENT'});
});

test('new unlisted code descendant after planning blocks all mutation',async t=>{
 const f=await cleanupFixture(t),plan=await nativePlan(f);
 await fs.writeFile(path.join(f.root,'new-unowned-file'),'preserve');
 const receipt=await executeInstanceCleanup(plan,{expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter});assert.equal(receipt.status,'conflict');assert(await fs.stat(f.records[0].path));assert(await fs.stat(path.join(f.root,'entry.mjs')));
});

for(const stage of ['session-intent','path-intent'])test(`byte drift during ${stage} journal publication is preserved`,async t=>{
 const f=await cleanupFixture(t),plan=await nativePlan(f);let file;
 const receipt=await executeInstanceCleanup(plan,{expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter,onStep:async step=>{
  if(!file&&step.phase===stage){file=step.path||step.operation.path;await fs.writeFile(file,'concurrent synthetic bytes');}
 }});
 assert.equal(receipt.status,'interrupted');assert.equal(await fs.readFile(file,'utf8'),'concurrent synthetic bytes');assert(await fs.stat(path.join(f.root,'entry.mjs')));
});

for(const stage of ['session','data','profile'])test(`interruption after ${stage} filesystem mutation before completion journal retries exact intent`,async t=>{
 const f=await cleanupFixture(t),plan=await nativePlan(f);
 const target=stage==='session'?f.records[0].path:stage==='data'?path.join(f.root,'config.json'):path.join(f.profile,'cordis.patch.yml');
 const method=stage==='profile'?'rename':'unlink',original=fs[method];let injected=false;
 fs[method]=async(...args)=>{const value=await original(...args);if(!injected&&(stage==='profile'?args[1]:args[0])===target){injected=true;throw Error('synthetic interruption after filesystem mutation');}return value;};
 const options={expectedManifestHash:plan.manifestHash,sessionStoreAdapter:f.adapter};let first;try{first=await executeInstanceCleanup(plan,options);}finally{fs[method]=original;}
 assert(injected);assert.equal(first.status,'interrupted');assert(await fs.stat(path.join(f.root,'entry.mjs')));
 const second=await executeInstanceCleanup(plan,options);assert.equal(second.status,'complete',JSON.stringify(second.conflicts));
});

test('no adapter is unsupported, never a fabricated permanent-delete success',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cleanup-plan-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'package'),home=path.join(dir,'home');await fs.mkdir(root);await fs.mkdir(home);
 const manifest={version:1,installationId:'installation',instanceId:'alpha',profile:'fixture',bundleName:'alpha',root,dshHome:home,sessions:[],paths:[],links:[],profileEntries:[]};
 await fs.writeFile(path.join(root,'.qq-bridge-instance-manifest.json'),JSON.stringify(manifest));
 const plan=await planInstanceCleanup(manifest);
 const receipt=await executeInstanceCleanup(plan,{expectedManifestHash:plan.manifestHash});
 assert.equal(receipt.status,'conflict');assert(receipt.conflicts.some(x=>x.code==='UNSUPPORTED_SESSION_DELETE'));
 assert.equal((await fs.readdir(root)).length,1);
});
