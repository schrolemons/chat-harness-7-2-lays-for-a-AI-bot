import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {fileURLToPath,pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const api=await import('./release-public.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const install=await import('./install.mjs');
async function temp(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'public-install-test-'));t.after(async()=>{assert.equal(path.dirname(base),os.tmpdir());await fs.rm(base,{recursive:true,force:true});});return base;}
test('allowlist public stage emits distinct native package and excludes local ownership and data',async t=>{
  assert.equal(typeof api.stagePublicRelease,'function');const base=await temp(t),target=path.join(base,'stage');
  await api.stagePublicRelease({sourceRoot:root,target,bundleName:'fixture-public',entryId:'public-bot-mode'});
  const pkg=JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8'));assert.equal(pkg.name,'fixture-public');assert.deepEqual(pkg.dsh.client.inject,['@deepseek-ai/dsh-client-connection']);
  const client=await fs.readFile(path.join(target,'dsh-client.js'),'utf8');assert(client.includes('id: "fixture-public"'));assert(client.includes('const CLIENT_MODULE_ID = "fixture-public"'));
  for(const name of ['private-data','private-libraries','state','config.json','.qq-bridge-instance.json','.instance-install','managed-dependencies'])await assert.rejects(fs.stat(path.join(target,name)),{code:'ENOENT'});
  await assert.rejects(api.stagePublicRelease({sourceRoot:root,target}),/TARGET_EXISTS/);
  for(const name of ['.qq-bridge-instance.json','managed-dependencies/secret.json','.instance-install/journal.json','state/session.json','config.json']) {
    await fs.mkdir(path.dirname(path.join(target,name)),{recursive:true});await fs.writeFile(path.join(target,name),'synthetic local secret/session');
  }
  const clean=path.join(base,'clean');await api.stagePublicRelease({sourceRoot:target,target:clean});
  await assert.rejects(fs.stat(path.join(clean,'.qq-bridge-instance.json')),{code:'ENOENT'});
  const list=JSON.parse(await fs.readFile(path.join(target,'release-files.json'),'utf8'));list.push('managed-dependencies/secret.json');await fs.writeFile(path.join(target,'release-files.json'),JSON.stringify(list));
  await assert.rejects(api.stagePublicRelease({sourceRoot:target,target:path.join(base,'bad')}),/RELEASE_PATH_DENIED/);
});
test('managed metadata present, even malformed, blocks old force/stop/setup before effects',async t=>{
  const base=await temp(t);await fs.mkdir(path.join(base,'scripts'));await fs.mkdir(path.join(base,'src'));
  for(const script of ['start-da-feiyu.mjs','setup-dsh.mjs','setup-bridge-health.mjs','setup-web-summary.mjs']) {
    const text=await fs.readFile(path.join(root,'scripts',script),'utf8');
    assert.match(text,/assertLegacyControlAllowed/);
  }
  const {assertLegacyControlAllowed}=await import('./legacy-control-guard.mjs');assert.doesNotThrow(()=>assertLegacyControlAllowed(base));
  await fs.writeFile(path.join(base,'.qq-bridge-instance.json'),'invalid');assert.throws(()=>assertLegacyControlAllowed(base),/INSTANCE_CONTROL_REQUIRED/);
});
test('public bootstrap never restores private snapshot or rewrites existing configuration',async t=>{
  const {bootstrapLocal}=await import('./bootstrap-local.mjs'),base=await temp(t);
  await fs.mkdir(path.join(base,'private-data'));await fs.writeFile(path.join(base,'private-data','manifest.json'),'{}');
  assert.throws(()=>bootstrapLocal(base),/PRIVATE_RESTORE_SEPARATE/);
  await fs.writeFile(path.join(base,'config.json'),'original');assert.equal(bootstrapLocal(base).created,false);assert.equal(await fs.readFile(path.join(base,'config.json'),'utf8'),'original');
});
test('automatic Snow acquisition requests only the pinned official URL and rejects untrusted bytes',async t=>{
  assert.equal(typeof install.acquireSnowArtifact,'function');const base=await temp(t);let seen;
  await assert.rejects(install.acquireSnowArtifact({root:base,fetchImpl:async url=>{seen=url;return new Response('untrusted fixture');}}),/ARTIFACT_DIGEST/);
  assert.equal(seen,'https://github.com/SnowLuma/SnowLuma/releases/download/v2.1.1/SnowLuma-v2.1.1-win-x64.zip');
});
test('Windows instance Node rejects the known 24.16 worker-crash runtime and accepts fixed versions',async()=>{
  const api=await import('../src/dsh-instance-factories.mjs');assert.equal(typeof api.isSupportedInstanceNode,'function');
  for(const v of ['24.0.0','24.16.0','24.19.9','23.99.0','invalid'])assert.equal(api.isSupportedInstanceNode(v,'win32'),false,v);
  for(const v of ['24.20.0','24.22.1','25.0.0'])assert.equal(api.isSupportedInstanceNode(v,'win32'),true,v);
  assert.equal(api.isSupportedInstanceNode('24.16.0','linux'),true);
});
test('fresh installer rejects nesting before creating code under another bot marker',async t=>{
  const base=await temp(t),home=path.join(base,'home'),parent=path.join(base,'existing-bot'),target=path.join(parent,'nested');
  await fs.mkdir(path.join(home,'profiles','desktop'),{recursive:true});await fs.mkdir(parent);await fs.writeFile(path.join(parent,'.qq-bridge-instance.json'),'invalid-but-present');
  await assert.rejects(install.preparePublicInstall({sourceRoot:root,target,dshHome:home,profile:'desktop',installDependencies:false}),/NESTED_INSTANCE_TARGET/);
  await assert.rejects(fs.lstat(target),{code:'ENOENT'});
});
test('created dependency inventory hashes exact files and refuses external links',async t=>{
  assert.equal(typeof install.inventoryCreatedTree,'function');const base=await temp(t),dir=path.join(base,'owned');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'a.js'),'synthetic');
  const first=await install.inventoryCreatedTree(dir);assert.equal(first.files.length,1);assert.match(first.files[0].sha256,/^[a-f0-9]{64}$/);assert.deepEqual(first.links,[]);
  const external=path.join(base,'external');await fs.mkdir(external);await fs.symlink(external,path.join(dir,'foreign'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(install.inventoryCreatedTree(dir),/CREATED_TREE_EXTERNAL_LINK/);
});
test('real official artifact fresh install uses local dependencies, owned Node and native dual package identities', {skip:!process.env.TEST_SNOW_ARTIFACT,timeout:240000},async t=>{
  assert.equal(typeof install.preparePublicInstall,'function');const base=await temp(t),home=path.join(base,'home'),profilePath=path.join(home,'profiles','desktop');await fs.mkdir(profilePath,{recursive:true});
  await fs.writeFile(path.join(profilePath,'package.json'),'{"name":"synthetic-profile","private":true,"dependencies":{},"dsh":{"profile":{"bundles":[]}}}\n');await fs.writeFile(path.join(profilePath,'cordis.patch.yml'),'[]\n');
  const packed=await api.packPublicRelease({sourceRoot:root,target:path.join(base,'release-stage'),packDirectory:base});
  if(process.env.TEST_ARTIFACT_OUTPUT_DIR){await fs.mkdir(process.env.TEST_ARTIFACT_OUTPUT_DIR,{recursive:true});await fs.copyFile(packed.artifact,path.join(process.env.TEST_ARTIFACT_OUTPUT_DIR,path.basename(packed.artifact)));await fs.writeFile(path.join(process.env.TEST_ARTIFACT_OUTPUT_DIR,'artifact-proof.json'),JSON.stringify({bytes:packed.bytes,sha256:packed.sha256,unpackedBytes:packed.unpackedBytes},null,2)+'\n');}
  const bootstrap=path.join(base,'bootstrap');await fs.mkdir(bootstrap);await fs.writeFile(path.join(bootstrap,'package.json'),'{"private":true}');
  api.runNpm(bootstrap,['install','--ignore-scripts','--no-audit','--no-fund',packed.artifact]);
  const extracted=path.join(bootstrap,'node_modules','qq-bridge-public');
  assert((await fs.readdir(path.join(extracted,'roles'))).some(n=>n.endsWith('.md')),'Unicode role survives actual npm tarball extraction');
  const invoked=spawnSync(process.execPath,[path.join(extracted,'scripts','install.mjs'),'--target',path.join(base,'public-bot'),'--dsh-home',home,'--profile','desktop','--snow-artifact',process.env.TEST_SNOW_ARTIFACT],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});
  assert.equal(invoked.status,0,invoked.stderr||invoked.stdout);
  const prepared=JSON.parse(invoked.stdout),plan=JSON.parse(await fs.readFile(prepared.candidate,'utf8'));
  const override=plan.operations.find(op=>op.path.endsWith('cordis.patch.yml'));
  const yaml=await import('js-yaml'),runtime=yaml.default.load(override.content).find(row=>row.id==='public-bot-mode').config;
  const result={plan,descriptor:plan.descriptor,runtime};
  console.log(JSON.stringify({artifactProof:{bytes:packed.bytes,sha256:packed.sha256,unpackedBytes:packed.unpackedBytes,snowBytes:prepared.dependencyArtifact.bytes,dependencyInstall:'fresh npm install bootstrap + npm ci stable root'}}));
  assert.equal(result.plan.conflicts.length,0);assert(result.runtime.nodePath.startsWith(result.descriptor.root));
  const {resolveInstanceNode}=await import('../src/dsh-instance-factories.mjs');const electron={execPath:path.join(base,'Desktop.exe'),versions:{electron:'fixture'}};
  assert.equal(await resolveInstanceNode({descriptor:result.descriptor,config:result.runtime,host:electron}),result.runtime.nodePath);
  await assert.rejects(resolveInstanceNode({descriptor:result.descriptor,config:{},host:electron}),/NODE_RUNTIME_REQUIRED/);
  const installedEntry=await import(pathToFileURL(path.join(result.descriptor.root,'dsh-entry.mjs'))),mcp=await import(pathToFileURL(path.join(result.descriptor.root,'dsh-mcp-entry.mjs')));
  let runtimeCreated=0;const calls=[];Object.defineProperty(process.versions,'electron',{value:'synthetic-installed-host',configurable:true});
  try {
    await assert.rejects(installedEntry.apply({fiber:{entry:{options:{id:'public-bot-mode'}}}},{root:result.descriptor.root},{createRuntime:()=>{runtimeCreated++;}}),/NODE_RUNTIME_REQUIRED/);
    for(const serverName of Object.keys(mcp.BUNDLED_MCP))await mcp.apply({root:{},loader:{import:async()=>({}),unwrapExports:m=>m},plugin:(_,config)=>{calls.push(config);}},{root:result.descriptor.root,serverName,nodePath:result.runtime.nodePath});
  } finally {delete process.versions.electron;}
  assert.equal(runtimeCreated,0);assert.equal(calls.length,7);assert(calls.every(c=>c.command===result.runtime.nodePath&&c.cwd===result.descriptor.root));
  const configBefore=await fs.readFile(path.join(result.descriptor.root,'config.json'));
  for(const [script,args]of [['start-da-feiyu.mjs',['--force','--stop']],['setup-dsh.mjs',['desktop']],['setup-bridge-health.mjs',[profilePath]],['setup-web-summary.mjs',['desktop']]]) {
    const stopped=spawnSync(result.runtime.nodePath,[path.join(result.descriptor.root,'scripts',script),...args],{windowsHide:true,encoding:'utf8',env:{...process.env,DSH_HOME:home}});assert.notEqual(stopped.status,0);assert.match(stopped.stderr,/INSTANCE_CONTROL_REQUIRED/);
  }
  assert.deepEqual(await fs.readFile(path.join(result.descriptor.root,'config.json')),configBefore);
  const {applyInstanceInstall}=await import('./migrate-instance-profile.mjs');await applyInstanceInstall(result.plan,{expectedHashes:result.plan.beforeHashes,writersStopped:true});
  const cfg=JSON.parse(await fs.readFile(path.join(result.descriptor.root,'config.json'),'utf8'));assert.deepEqual(cfg.allow,{private:[],groups:[]});assert.equal(cfg.ownerQQ,null);assert.equal(cfg.snowluma.botUin,'');assert.equal(cfg.launcher.ports.dsh,'');assert.equal(cfg.launcher.ports.launcher,3299);
  for(const kind of ['chat','learning','task','summary'])assert.equal(path.basename(result.descriptor.workspaces[kind]),'public-bot-'+kind);
  const proof=spawnSync(process.execPath,['--input-type=module','--eval',`import {createRequire} from 'node:module';const req=createRequire(${JSON.stringify(path.join(profilePath,'package.json'))});const pkg=req('qq-bridge-public/package.json');console.log(JSON.stringify({name:pkg.name,entry:req.resolve('qq-bridge-public'),inject:pkg.dsh.client.inject}));`],{encoding:'utf8',windowsHide:true});assert.equal(proof.status,0,proof.stderr);assert.equal(JSON.parse(proof.stdout).name,'qq-bridge-public');
  const depStat=await fs.lstat(path.join(result.descriptor.root,'node_modules'));assert(!depStat.isSymbolicLink());
  const {readManifest}=await import('../src/instance-manifest.mjs');const manifest=await readManifest(result.descriptor.root);assert.equal(manifest.paths.find(r=>r.kind==='code').cleanup,'owned');assert.deepEqual(manifest.sessions,[]);
  const dependencies=manifest.paths.find(r=>r.path===path.join(result.descriptor.root,'node_modules'));assert(dependencies.files.length>100);assert(dependencies.files.every(r=>r.sha256));assert(Array.isArray(dependencies.links));
  for(const name of ['config.json','state/mode.json','state/current-role.json']){const row=manifest.paths.find(r=>r.path===path.join(result.descriptor.root,name));assert.equal(row.kind,'data');assert.equal(row.mutable,true);assert(row.createdByTransaction);}
  // Both generated clients pass the actual pinned native module arrival system.
  const {createRequire}=await import('node:module'),vm=await import('node:vm');const req=createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'));let exports;
  vm.runInNewContext(await fs.readFile(req.resolve('@deepseek-ai/dsh-client-modules/client'),'utf8'),{window:{__ModuleLoader__:{load:m=>{exports=m.factory(()=>({}));}}},console,URL});
  const second=path.join(base,'other-public');await api.stagePublicRelease({sourceRoot:root,target:second,bundleName:'qq-bridge-other',entryId:'other-bot-mode'});
  const connection='@deepseek-ai/dsh-client-connection',ids=['qq-bridge-public','qq-bridge-other'],arrived=[],target={mode:'queue',pendingQueue:[]};
  const row=(id,inject=[])=>({id,rev:'fixture',url:'/plugins/'+id+'/client.js',initialUrl:'/plugins/'+id+'/client.js',external:[],inject});
  const system=new exports.ClientModuleSystem({manifest:{modules:[...ids.map(id=>row(id,[connection])),row(connection)],plugins:[]},staticModules:{},bootstrapModule:{id:'@deepseek-ai/dsh-client-modules',exports},registrationTarget:target,async loadBundle(url){const id=[connection,...ids].find(id=>url.includes(id));arrived.push(id);if(id===connection)target.load({id,factory:()=>({})});else vm.runInNewContext(await fs.readFile(path.join(id===ids[0]?result.descriptor.root:second,'dsh-client.js'),'utf8'),{window:{__ModuleLoader__:target},URL,console});}});
  for(const id of ids)await system.prefetch(id);assert.deepEqual(arrived,[connection,...ids]);
  // Same actually installed artifact, exact retained installer receipts and real
  // native default-zstd session/cache/index lifecycle. Never starts Snow or QQ.
  const {verifyManagedSnow,writeSnowAccount}=await import('../src/instance-runtime.mjs');
  await writeSnowAccount(await verifyManagedSnow(result.descriptor.root,result.runtime.snowHome,result.descriptor.instanceId),{snowluma:{}},'123456789',{snowHttp:3201,snowWs:3202},result.descriptor);
  const {cleanupFixture}=await import('./native-session-cleanup-fixture.mjs');
  const controlled=await cleanupFixture(t,{compression:'default',installed:{dir:base,descriptor:result.descriptor}});await controlled.primeCatalog();await controlled.stoppedSnapshot();
  const {planInstanceCleanup}=await import('../src/instance-uninstall-plan.mjs');
  const before=await controlled.owner.snapshotForCleanup();
  const cleanup=await planInstanceCleanup(await controlled.manifest(),{sessionStoreAdapter:controlled.adapter});assert.deepEqual(cleanup.conflicts,[]);
  assert.equal(cleanup.sessions.length,2);assert(cleanup.paths.length>1000);
  assert.deepEqual(await controlled.owner.snapshotForCleanup(),before,'planning preserves all exact native bytes and retained sessions');
  // Full dependency deletion is separately scale-limited by per-file durable
  // journaling; test-instance-uninstall proves complete execution on smaller receipts.
  console.log(JSON.stringify({installedCleanupPlanProof:{conflicts:0,compression:'native-default-zstd',authoredSnowConfig:true,operations:cleanup.paths.length,sessions:cleanup.sessions.length,execute:false,preserved:before.snapshot.listed}}));
});
