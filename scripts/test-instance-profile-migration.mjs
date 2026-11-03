import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
import { planInstanceInstall, rowHash } from './plan-instance-install.mjs';
import { applyInstanceInstall, recoverInstanceInstall } from './migrate-instance-profile.mjs';
import { initializeManifest, readManifest, appendInstallationEvidence, appendOwnedSession } from '../src/instance-manifest.mjs';
import { readInstanceDescriptor } from '../src/instance-descriptor.mjs';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'instance-install-test-'));
  t.after(async()=>{ assert.equal(path.dirname(base),os.tmpdir()); await fs.rm(base,{recursive:true,force:true}); });
  const root=path.join(base,'private-bot'),home=path.join(base,'home'),profilePath=path.join(home,'profiles','desktop');
  await fs.mkdir(path.join(root,'plugins','old-mode'),{recursive:true});
  await fs.mkdir(path.join(profilePath,'node_modules'),{recursive:true});
  const modulePath=path.join(root,'plugins','old-mode','index.mjs'); await fs.writeFile(modulePath,'export const fixture = true;');
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'fixture-private',type:'module',main:'index.mjs'}));
  await fs.writeFile(path.join(root,'index.mjs'),'export const fixture = true;');
  await fs.writeFile(path.join(root,'roles.md'),'synthetic role original\r\n');
  await fs.writeFile(path.join(root,'config.json'),'synthetic unchanged secret');
  const descriptor={version:1,instanceId:'fixture-private',label:'Private fixture',root,dshHome:home,profile:'desktop',bundleName:'fixture-private',entryId:'qq-mode',settingsNamespace:'qq-mode',presetIdMap:{}};
  await fs.writeFile(path.join(root,'.qq-bridge-instance.json'),JSON.stringify(descriptor));
  await initializeManifest(root,descriptor);
  const row={id:'qq-mode',name:modulePath,config:{mode:'v2',model:'keep-model'}};
  const untouched='# third-party bytes stay exact\r\n- insert:\r\n    - id: mcp-codex-peer\r\n      name: unrelated-codex\r\n      config: { token: "synthetic-secret", model: untouched }\r\n    - id: mcp-schnie-private-phi\r\n      name: unrelated-phi\r\n';
  await fs.writeFile(path.join(profilePath,'cordis.patch.yml'),yaml.dump([{insert:[row]}])+untouched);
  const pkgText='{\n  "name": "fixture-profile", "unrelated": { "token": "synthetic-secret", "defaultPreset": "keep" },\n  "dependencies": {}, "dsh": {"profile": {"bundles": [], "other": 42}}\n}\n';
  await fs.writeFile(path.join(profilePath,'package.json'),pkgText);
  const legacy={rows:[{id:row.id,rowHash:rowHash(row),modulePath,sourceRoot:root}],bundles:[]};
  const runtime={nodePath:process.execPath,snowHome:path.join(root,'managed-dependencies','snow')};
  return {base,root,home,profilePath,descriptor,row,legacy,runtime,untouched,pkgText,modulePath};
}
test('exact row/module/provenance migration preserves unrelated bytes, preset IDs and protected source',async t=>{
  const f=await fixture(t),role=await fs.readFile(path.join(f.root,'roles.md')),cfg=await fs.readFile(path.join(f.root,'config.json'));
  const p=await planInstanceInstall(f); assert.deepEqual(p.conflicts,[]); assert(p.operations.length>=3);
  const receipt=await applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true});
  assert.equal(receipt.status,'committed'); assert.equal(receipt.codeDisposition,'preserve');
  const text=await fs.readFile(path.join(f.profilePath,'cordis.patch.yml'),'utf8'); assert(text.includes(f.untouched));
  const rows=yaml.load(text);const override=rows.find(r=>r.id==='qq-mode'); assert.equal(override.disabled,true); assert.equal(override.config.model,'keep-model'); assert.equal(override.config.nodePath,process.execPath);
  assert((await fs.readFile(path.join(f.profilePath,'package.json'),'utf8')).includes('"unrelated": { "token": "synthetic-secret", "defaultPreset": "keep" }'));
  assert.deepEqual(await fs.readFile(path.join(f.root,'roles.md')),role);assert.deepEqual(await fs.readFile(path.join(f.root,'config.json')),cfg);
  assert.deepEqual((await readManifest(f.root)).sessions,[]);
  assert.equal((await readManifest(f.root)).paths.find(r=>r.kind==='code').cleanup,'preserve');
  assert.equal((await applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true})).transactionId,receipt.transactionId);
  const again=await planInstanceInstall(f);assert.deepEqual(again.conflicts,[]);assert.equal(again.operations.length,0);
});
test('descriptor reader defaults compare semantically while raw descriptor bytes retain CAS protection',async t=>{
  const f=await fixture(t),file=path.join(f.root,'.qq-bridge-instance.json'),raw=await fs.readFile(file);
  const descriptor=await readInstanceDescriptor(f.root),p=await planInstanceInstall({...f,descriptor});
  assert.deepEqual(p.conflicts,[]);
  assert.equal(p.beforeHashes[file].sha256,hash(raw));
  assert((await planInstanceInstall({...f,descriptor:{...descriptor,label:'Different identity'}})).conflicts.some(r=>r.code==='DESCRIPTOR_CONFLICT'));
  assert((await planInstanceInstall({...f,descriptor:{...descriptor,workspaces:{...descriptor.workspaces,chat:path.join(f.root,'changed')}}})).conflicts.some(r=>r.code==='DESCRIPTOR_CONFLICT'));
  await fs.appendFile(file,' ');
  await assert.rejects(applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true}),/BASELINE_CHANGED/);
  await fs.writeFile(file,raw);
  await applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true});
  assert.deepEqual(await fs.readFile(file),raw);
  const again=await planInstanceInstall({...f,descriptor:await readInstanceDescriptor(f.root)});
  assert.deepEqual(again.conflicts,[]);assert.equal(again.operations.length,0);
});
test('same ID with a different module and old private phi are preserved and conflict blocks apply',async t=>{
  const f=await fixture(t);const file=path.join(f.profilePath,'cordis.patch.yml');
  await fs.writeFile(file,(await fs.readFile(file,'utf8')).replace(f.modulePath,'third-party-module'));
  const before=await fs.readFile(file),p=await planInstanceInstall(f); assert(p.conflicts.some(r=>r.code==='LEGACY_ROW_CONFLICT'));
  await assert.rejects(applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true}),/INSTALL_CONFLICT/);assert.deepEqual(await fs.readFile(file),before);
});
test('external host module also requires exact command argument ownership',async t=>{
  const f=await fixture(t),external=path.join(f.base,'host.mjs');await fs.writeFile(external,'export {};');
  const row={id:'mcp-snowluma',name:external,config:{command:process.execPath,args:[path.join(f.base,'foreign.mjs')]}};
  await fs.writeFile(path.join(f.profilePath,'cordis.patch.yml'),yaml.dump([{insert:[row]}]));
  f.legacy.rows=[{id:row.id,rowHash:rowHash(row),modulePath:external,sourceRoot:f.root,commandPath:path.join(f.root,'index.mjs')}];
  assert((await planInstanceInstall(f)).conflicts.some(r=>r.code==='LEGACY_ROW_CONFLICT'));
  row.config.args=[path.join(f.root,'index.mjs')];await fs.writeFile(path.join(f.profilePath,'cordis.patch.yml'),yaml.dump([{insert:[row]}]));f.legacy.rows[0].rowHash=rowHash(row);
  assert.deepEqual((await planInstanceInstall(f)).conflicts,[]);
});
test('profile concurrent byte change rejects before writes',async t=>{
  const f=await fixture(t),p=await planInstanceInstall(f),file=path.join(f.profilePath,'package.json');
  await fs.appendFile(file,' ');const changed=await fs.readFile(file);await assert.rejects(applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true}),/BASELINE_CHANGED/);assert.deepEqual(await fs.readFile(file),changed);
});
test('resolved legacy link target change rejects before profile mutation',async t=>{
  const f=await fixture(t),link=path.join(f.profilePath,'node_modules','old-mode'),target=path.dirname(f.modulePath);
  await fs.symlink(target,link,process.platform==='win32'?'junction':'dir');
  f.row.name='old-mode/index.mjs';await fs.writeFile(path.join(f.profilePath,'cordis.patch.yml'),yaml.dump([{insert:[f.row]}]));f.legacy.rows[0].rowHash=rowHash(f.row);
  f.legacy.bundles=[{name:'old-mode',target,sourceRoot:f.root}];
  const p=await planInstanceInstall(f);assert.deepEqual(p.conflicts,[]);
  const foreign=path.join(f.base,'foreign');await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'index.mjs'),'export {};');await fs.unlink(link);await fs.symlink(foreign,link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true}),/BASELINE_CHANGED|PROVENANCE_CHANGED/);
});
test('interrupted transaction retains journal and rollback restores exact original bytes',async t=>{
  const f=await fixture(t),p=await planInstanceInstall(f);
  const before=await Promise.all(['package.json','cordis.patch.yml'].map(n=>fs.readFile(path.join(f.profilePath,n))));
  await assert.rejects(applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true,onStep:()=>{throw Error('synthetic interruption');}}),/synthetic interruption/);
  const journal=JSON.parse(await fs.readFile(p.journalPath,'utf8'));assert.equal(journal.status,'interrupted');
  await recoverInstanceInstall(p,{writersStopped:true,action:'rollback'});
  for(let i=0;i<2;i++)assert.deepEqual(await fs.readFile(path.join(f.profilePath,['package.json','cordis.patch.yml'][i])),before[i]);
  assert.equal(JSON.parse(await fs.readFile(p.journalPath,'utf8')).status,'rolled-back');
});
test('rollback refuses a newer writer instead of restoring stale backup',async t=>{
  const f=await fixture(t),p=await planInstanceInstall(f);
  await assert.rejects(applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true,onStep:()=>{throw Error('interrupt');}}));
  const journal=JSON.parse(await fs.readFile(p.journalPath,'utf8')),op=p.operations[journal.completed[0]];
  if(op.kind==='write')await fs.appendFile(op.path,' newer');else{await fs.unlink(op.path);await fs.mkdir(op.path);}
  await assert.rejects(recoverInstanceInstall(p,{writersStopped:true,action:'rollback'}),/ROLLBACK_CONFLICT/);
});
test('apply requires explicit stopped writer acknowledgement and expected hashes',async t=>{
  const f=await fixture(t),p=await planInstanceInstall(f);await assert.rejects(applyInstanceInstall(p,{expectedHashes:p.beforeHashes}),/WRITERS_NOT_STOPPED/);
  await assert.rejects(applyInstanceInstall(p,{writersStopped:true}),/EXPECTED_HASHES_REQUIRED/);
});
test('manifest install append is additive, immutable and refuses checkout code deletion',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.root,'.git'));
  const evidence={profileEntries:[],links:[],paths:[{path:f.root,kind:'code',source:'created',cleanup:'owned',sha256:hash('fixture')}]};
  await assert.rejects(appendInstallationEvidence(f.root,evidence),/CHECKOUT_PRESERVED/);
  evidence.paths[0].cleanup='preserve';await appendInstallationEvidence(f.root,evidence);await appendInstallationEvidence(f.root,evidence);
  assert.equal((await readManifest(f.root)).paths.length,1);
  await assert.rejects(appendInstallationEvidence(f.root,{...evidence,paths:[{...evidence.paths[0],sha256:hash('changed')}]}),/EVIDENCE_CONFLICT/);
});
test('a caller cannot invent a fresh-root creation capability for an existing root',async t=>{
  const f=await fixture(t);await assert.rejects(planInstanceInstall({...f,creation:{transactionId:'invented'}}),/CREATION_CAPABILITY_REQUIRED/);
});
test('legacy bundle-supplied root preserves exact mode override while retiring only proven bundle/link',async t=>{
  const f=await fixture(t),target=path.dirname(f.modulePath),link=path.join(f.profilePath,'node_modules','old-mode');
  await fs.writeFile(path.join(target,'package.json'),'{"name":"old-mode","main":"index.mjs","type":"module"}');await fs.symlink(target,link,process.platform==='win32'?'junction':'dir');
  const override={id:'qq-mode',config:{mode:'v2',model:'keep-overridden',ownerQQ:'synthetic'}};
  await fs.writeFile(path.join(f.profilePath,'cordis.patch.yml'),yaml.dump([override])+f.untouched);
  const pkg={dependencies:{'old-mode':'link:'+target.replaceAll('\\','/')},dsh:{profile:{bundles:['old-mode']}}};await fs.writeFile(path.join(f.profilePath,'package.json'),JSON.stringify(pkg));
  f.legacy={rows:[],bundles:[{name:'old-mode',target,sourceRoot:f.root}],overrides:[{id:'qq-mode',rowHash:rowHash(override),modulePath:f.modulePath,sourceRoot:f.root,sourceBundle:'old-mode'}]};
  const p=await planInstanceInstall(f);assert.deepEqual(p.conflicts,[]);
  await applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true});
  const text=await fs.readFile(path.join(f.profilePath,'cordis.patch.yml'),'utf8');assert(text.includes(f.untouched));assert.equal(yaml.load(text).find(r=>r.id==='qq-mode').config.model,'keep-overridden');await assert.rejects(fs.lstat(link),{code:'ENOENT'});
});
test('two bots in one synthetic profile keep distinct roots, packages, IDs and existing session evidence',async t=>{
  const f=await fixture(t);await appendOwnedSession(f.root,{sessionId:'synthetic-existing',workspaceId:'synthetic-ws',path:path.join(f.base,'session.jsonl'),source:'verified-legacy',cleanup:'preserve',headerFingerprint:'synthetic-header'});
  const first=await planInstanceInstall(f);await applyInstanceInstall(first,{expectedHashes:first.beforeHashes,writersStopped:true});
  const preserved=await fs.readFile(path.join(f.profilePath,'cordis.patch.yml'),'utf8'),root=path.join(f.base,'other-bot');await fs.mkdir(root);await fs.writeFile(path.join(root,'package.json'),'{"name":"fixture-public"}');
  const descriptor={...f.descriptor,root,instanceId:'fixture-public',bundleName:'fixture-public',entryId:'public-bot-mode',settingsNamespace:'public-bot-mode'};
  await fs.writeFile(path.join(root,'.qq-bridge-instance.json'),JSON.stringify(descriptor));await initializeManifest(root,descriptor);
  const second=await planInstanceInstall({descriptor,profilePath:f.profilePath,runtime:f.runtime});assert.deepEqual(second.conflicts,[]);await applyInstanceInstall(second,{expectedHashes:second.beforeHashes,writersStopped:true});
  assert((await fs.readFile(path.join(f.profilePath,'cordis.patch.yml'),'utf8')).startsWith(preserved));
  assert.equal(await fs.realpath(path.join(f.profilePath,'node_modules','fixture-private')),f.root);assert.equal(await fs.realpath(path.join(f.profilePath,'node_modules','fixture-public')),root);
  assert.equal((await readManifest(f.root)).sessions[0].sessionId,'synthetic-existing');assert.deepEqual((await readManifest(root)).sessions,[]);
});
test('hard process interruption needs explicit exact lock recovery before CAS rollback',async t=>{
  const f=await fixture(t),p=await planInstanceInstall(f),file=path.join(f.base,'candidate.json');await fs.writeFile(file,JSON.stringify(p));
  const module=new URL('./migrate-instance-profile.mjs',import.meta.url).href;
  const result=spawnSync(process.execPath,['--input-type=module','--eval',`import fs from 'node:fs';import {applyInstanceInstall} from ${JSON.stringify(module)};const p=JSON.parse(fs.readFileSync(${JSON.stringify(file)}));await applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true,onStep:()=>process.exit(42)});`],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,42,result.stderr);
  await assert.rejects(recoverInstanceInstall(p,{writersStopped:true,action:'rollback'}),/INSTALL_BUSY/);
  const ownerFile=path.join(f.profilePath,'.qq-bridge-install.lock','owner.json'),owner=await fs.readFile(ownerFile),journal=await fs.readFile(p.journalPath);
  await fs.writeFile(ownerFile,'{"transactionId":"foreign"}');
  await assert.rejects(recoverInstanceInstall(p,{writersStopped:true,action:'rollback',recoverLock:true}),/LOCK_RECOVERY_CONFLICT/);
  assert.equal(await fs.readFile(ownerFile,'utf8'),'{"transactionId":"foreign"}');await fs.writeFile(ownerFile,owner);
  await fs.writeFile(p.journalPath,'{"planHash":"foreign"}');await assert.rejects(recoverInstanceInstall(p,{writersStopped:true,action:'rollback',recoverLock:true}),/JOURNAL_PLAN_CONFLICT/);assert.deepEqual(await fs.readFile(ownerFile),owner);await fs.writeFile(p.journalPath,journal);
  const pkgFile=path.join(f.profilePath,'package.json'),pkgBefore=await fs.readFile(pkgFile);await fs.appendFile(pkgFile,' ');
  await assert.rejects(recoverInstanceInstall(p,{writersStopped:true,action:'rollback',recoverLock:true}),/ROLLBACK_CONFLICT/);assert.deepEqual(await fs.readFile(ownerFile),owner);assert.equal((await fs.readFile(pkgFile)).length,pkgBefore.length+1);await fs.writeFile(pkgFile,pkgBefore);
  await recoverInstanceInstall(p,{writersStopped:true,action:'rollback',recoverLock:true});
  assert.equal(await fs.readFile(path.join(f.profilePath,'package.json'),'utf8'),f.pkgText);
});
test('legacy dependency alias needs matching physical target and is rechecked before apply',async t=>{
  const f=await fixture(t),target=path.dirname(f.modulePath),alias=path.join(f.base,'legacy-alias'),link=path.join(f.profilePath,'node_modules','old-mode');
  await fs.writeFile(path.join(target,'package.json'),'{"name":"old-mode","main":"index.mjs"}');await fs.symlink(target,alias,process.platform==='win32'?'junction':'dir');await fs.symlink(target,link,process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(f.profilePath,'package.json'),JSON.stringify({dependencies:{'old-mode':'link:'+alias.replaceAll('\\','/')},dsh:{profile:{bundles:['old-mode']}}}));
  f.legacy.bundles=[{name:'old-mode',target,sourceRoot:f.root}];const p=await planInstanceInstall(f);assert.deepEqual(p.conflicts,[]);
  const foreign=path.join(f.base,'foreign');await fs.mkdir(foreign);await fs.unlink(alias);await fs.symlink(foreign,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(applyInstanceInstall(p,{expectedHashes:p.beforeHashes,writersStopped:true}),/BASELINE_CHANGED/);
});
test('inline YAML collections cannot remove an unrelated row sharing the same source line',async t=>{
  const f=await fixture(t),file=path.join(f.profilePath,'cordis.patch.yml');
  const raw='- insert: '+JSON.stringify([f.row,{id:'keep-third-party',name:'other-module'}])+'\n';await fs.writeFile(file,raw);
  await assert.rejects(planInstanceInstall(f),/UNSUPPORTED_YAML_EDIT/);assert.equal(await fs.readFile(file,'utf8'),raw);
});
