import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {initializeManifest,appendInstallationEvidence,readManifest} from '../src/instance-manifest.mjs';
import * as runtime from '../src/instance-runtime.mjs';import {prepareFileCleanup} from '../src/instance-cleanup-files.mjs';import {SNOW_RELEASE} from './install-managed-snow.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'snow-receipt-')),root=path.join(base,'bot');await fs.mkdir(root);t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const descriptor={version:1,root,instanceId:'fixture',dshHome:path.join(base,'home'),profile:'fixture',bundleName:'fixture',entryId:'fixture',settingsNamespace:'fixture'};await initializeManifest(root,descriptor);
 const home=path.join(root,'managed-dependencies','snow'),marker=path.join(home,'.qq-bridge-managed.json');await fs.mkdir(path.join(home,'config'),{recursive:true});await fs.writeFile(path.join(home,'index.mjs'),'fixture');await fs.writeFile(path.join(home,'node.exe'),'fixture');
 await fs.writeFile(marker,JSON.stringify({version:1,kind:'snowluma',instanceId:'fixture',entry:'index.mjs',runtime:'node.exe',files:{'index.mjs':hash('fixture'),'node.exe':hash('fixture')},artifact:SNOW_RELEASE,createdDirectories:['config']}));
 await appendInstallationEvidence(root,{profileEntries:[],links:[],paths:[{path:home,kind:'dependency',source:'created',cleanup:'owned',createdByTransaction:crypto.randomUUID(),sha256:hash(await fs.readFile(marker)),manifestPath:marker}]});
 return {root,home,descriptor,marker,async write(){const snow=await runtime.verifyManagedSnow(root,home,'fixture');await runtime.writeSnowAccount(snow,{snowluma:{}},'123456789',{snowHttp:43000,snowWs:43001},descriptor);}};
}
test('runtime authors exact Snow config receipt; rewrites preserve receipt and cleanup uses current bytes',async t=>{
 assert.equal(typeof runtime.writeSnowAccount,'function');const f=await fixture(t);await f.write();const first=await readManifest(f.root),row=first.paths.find(r=>r.producer==='managed-snow-account');assert(row);assert.equal(row.mutable,true);
 await fs.writeFile(row.path,'{"vendorChanged":true}');await f.write();assert.deepEqual((await readManifest(f.root)).paths,first.paths);
 const plan=await prepareFileCleanup(await readManifest(f.root));assert(plan.operations.some(r=>r.path===row.path));
 await fs.mkdir(path.join(f.home,'unknown-empty'));await assert.rejects(prepareFileCleanup(await readManifest(f.root)),/UNKNOWN_DESCENDANT/);
});
test('managed Snow refuses unrecorded existing config and unproved namespace without adopting bytes',async t=>{
 assert.equal(typeof runtime.writeSnowAccount,'function');const f=await fixture(t),file=path.join(f.home,'config','onebot_123456789.json');await fs.writeFile(file,'{"external":true}');await assert.rejects(f.write(),{code:'SNOW_CONFIG_UNOWNED'});assert.equal(await fs.readFile(file,'utf8'),'{"external":true}');
 await fs.unlink(file);const marker=JSON.parse(await fs.readFile(f.marker));delete marker.createdDirectories;await fs.writeFile(f.marker,JSON.stringify(marker));await assert.rejects(f.write(),{code:'SNOW_CONFIG_NAMESPACE_UNPROVEN'});
});
test('failed Snow author append preserves ambiguous bytes and retry refuses adoption',async t=>{
 const f=await fixture(t),rename=fs.rename;
 fs.rename=async(from,to)=>{if(to===path.join(f.root,'.qq-bridge-instance-manifest.json'))throw Error('synthetic receipt failure');return rename(from,to);};
 try{await assert.rejects(f.write(),/synthetic receipt failure/);}finally{fs.rename=rename;}
 const file=path.join(f.home,'config','onebot_123456789.json'),bytes=await fs.readFile(file);
 assert(!(await readManifest(f.root)).paths.some(row=>row.path===file));await assert.rejects(f.write(),{code:'SNOW_CONFIG_UNOWNED'});assert.deepEqual(await fs.readFile(file),bytes);
});

test('Snow namespace must match the exact installer dependency receipt',async t=>{
 const f=await fixture(t);await fs.appendFile(f.marker,' ');await assert.rejects(f.write(),{code:'SNOW_CONFIG_NAMESPACE_UNPROVEN'});
 const g=await fixture(t),file=path.join(g.root,'.qq-bridge-instance-manifest.json'),manifest=JSON.parse(await fs.readFile(file));manifest.paths=[];await fs.writeFile(file,JSON.stringify(manifest));await assert.rejects(g.write(),{code:'SNOW_CONFIG_NAMESPACE_UNPROVEN'});
});
