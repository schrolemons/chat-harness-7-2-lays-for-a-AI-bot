import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {stagePublicRelease,runNpm,RELEASE_ROOT} from './release-public.mjs';
import {SNOW_RELEASE,installManagedSnow} from './install-managed-snow.mjs';
import {initializeManifest,appendInstallationEvidence} from '../src/instance-manifest.mjs';
import {readInstanceDescriptor} from '../src/instance-descriptor.mjs';
import {readInstanceSessionPolicy} from '../src/instance-session-policy.mjs';
import {resolveInstanceNode} from '../src/dsh-instance-factories.mjs';
import {validateLauncherPorts,readLauncherPorts} from './launcher-settings.mjs';
import {bootstrapLocal} from './bootstrap-local.mjs';
import {planInstanceInstall,sha256,assertPlainDirectory,installError} from './plan-instance-install.mjs';
import {applyInstanceInstall,recoverInstanceInstall} from './migrate-instance-profile.mjs';
export {installProfile} from './install-profile.mjs';

/** Inventory only a tree just created by this installer. Never follow links. */
export async function inventoryCreatedTree(root) {
  await assertPlainDirectory(root);const files=[],links=[],directories=[];
  const walk=async directory=>{
    for(const name of (await fs.readdir(directory)).sort()) {
      const file=path.join(directory,name),relative=path.relative(root,file).replaceAll('\\','/'),stat=await fs.lstat(file);
      if(stat.isSymbolicLink()) {
        const target=await fs.realpath(file),r=path.relative(root,target);
        if(r==='..'||r.startsWith('..'+path.sep)||path.isAbsolute(r))throw installError('CREATED_TREE_EXTERNAL_LINK');
        links.push({path:relative,target});
      } else if(stat.isDirectory()){directories.push(relative);await walk(file);}
      else if(stat.isFile()&&stat.nlink===1)files.push({path:relative,sha256:sha256(await fs.readFile(file))});
      else throw installError('CREATED_TREE_INVALID');
    }
  };
  await walk(root);return {files,links,directories};
}

/** Download pinned official release; local ZIP is an input, never a runtime root. */
export async function acquireSnowArtifact({root,artifact,fetchImpl=fetch}={}) {
  if(artifact) {
    if(!path.isAbsolute(artifact))throw installError('ARTIFACT_PATH_REQUIRED');
    const stat=await fs.lstat(artifact);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>256*1024*1024)throw installError('ARTIFACT_UNTRUSTED');
    const bytes=await fs.readFile(artifact);if(sha256(bytes)!==SNOW_RELEASE.sha256)throw installError('ARTIFACT_DIGEST');
    return {artifact,bytes:bytes.length,downloaded:false};
  }
  await assertPlainDirectory(root);
  const cache=path.join(root,'.instance-install');await fs.mkdir(cache,{recursive:true,mode:0o700});await assertPlainDirectory(cache);
  const target=path.join(cache,`snow-${SNOW_RELEASE.sha256}.zip`);
  try {return {...await acquireSnowArtifact({root,artifact:target}),downloaded:false};}catch(e){if(e.code!=='ENOENT')throw e;}
  const response=await fetchImpl(SNOW_RELEASE.url,{redirect:'follow',signal:AbortSignal.timeout(180000)});
  if(!response.ok||Number(response.headers.get('content-length')||0)>256*1024*1024)throw installError('ARTIFACT_DOWNLOAD_FAILED');
  let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>256*1024*1024)throw installError('ARTIFACT_DOWNLOAD_TOO_LARGE');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);if(sha256(bytes)!==SNOW_RELEASE.sha256)throw installError('ARTIFACT_DIGEST');
  await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});return {artifact:target,bytes:size,downloaded:true};
}
async function checkPorts(ports,home,instanceId) {
  const ownKeys=['console','snowHttp','snowWs','launcher','snowWebui'];
  let inventory;try{inventory=JSON.parse(await fs.readFile(path.join(home,'bot-instances','installation-roots.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const row of inventory?.roots||[]) {
    if(row.instanceId===instanceId)throw installError('INSTANCE_ID_CONFLICT');
    if(row.state!=='ready')throw installError('ROOT_DECLARATION_INCOMPLETE');
    const descriptor=await readInstanceDescriptor(row.root);
    if(descriptor.instanceId!==row.instanceId)throw installError('ROOT_DECLARATION_CONFLICT');
    let existing;try{existing=readLauncherPorts(JSON.parse(await fs.readFile(path.join(row.root,'config.json'),'utf8')),{managed:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
    if(ownKeys.some(k=>ownKeys.some(other=>ports[k]===existing[other])))throw installError('INSTANCE_PORT_CONFLICT');
  }
  for(const kind of ownKeys)await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(installError('INSTANCE_PORT_CONFLICT')));server.listen({host:'127.0.0.1',port:ports[kind],exclusive:true},()=>server.close(resolve));});
}
/** Fresh code/dependencies + disabled candidate; no profile apply or service launch. */
export async function preparePublicInstall({sourceRoot=RELEASE_ROOT,target,dshHome,profile,instanceId='public-bot',label='Public bot',bundleName='qq-bridge-public',entryId='public-bot-mode',artifact,ports,installDependencies=true}={}) {
  if(!path.isAbsolute(target||'')||!path.isAbsolute(dshHome||'')||!profile||!/^[\w-]+$/.test(profile)||!/^[a-z0-9][a-z0-9._-]*$/.test(instanceId))throw installError('EXPLICIT_INSTALL_TARGET_REQUIRED');
  await assertPlainDirectory(path.join(dshHome,'profiles',profile));
  for(let p=path.dirname(target);;p=path.dirname(p)) {
    try{await fs.lstat(path.join(p,'.git'));throw installError('DEVELOPER_CHECKOUT_TARGET_REJECTED');}catch(e){if(e.code!=='ENOENT')throw e;}
    for(const marker of ['.qq-bridge-instance.json','.qq-bridge-instance-manifest.json']) {
      try{await fs.lstat(path.join(p,marker));throw installError('NESTED_INSTANCE_TARGET');}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    if(path.dirname(p)===p)break;
  }
  const selectedPorts=validateLauncherPorts({dsh:'',console:3200,snowHttp:3201,snowWs:3202,launcher:3299,snowWebui:5299,...ports},undefined,{managed:true});
  await checkPorts(selectedPorts,dshHome,instanceId);
  const stage=await stagePublicRelease({sourceRoot,target,bundleName,entryId});
  const creation=stage.creation;
  const descriptor={version:1,instanceId,label,bundleName,entryId,settingsNamespace:entryId,root:await fs.realpath(target),dshHome:await fs.realpath(dshHome),profile,presetIdMap:{},workspaces:{}};
  for(const kind of ['chat','learning','task','summary'])descriptor.workspaces[kind]=path.join(descriptor.root,'state','workspaces',instanceId+'-'+kind);
  const policy=readInstanceSessionPolicy({descriptor});descriptor.presetIdMap={...policy.presetMap};
  for(const kind of ['chat','learning','task','summary'])descriptor.workspaces[kind]=policy.workspace(kind);
  await fs.mkdir(path.join(target,'.instance-install'),{mode:0o700});
  await fs.writeFile(path.join(target,'.instance-install','creation.json'),JSON.stringify(creation,null,2)+'\n',{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(target,'.qq-bridge-instance.json'),JSON.stringify(descriptor,null,2)+'\n',{flag:'wx',mode:0o600});
  await initializeManifest(target,descriptor);
  // Failed preparations remain inspectable. No recursive deletion/unregistration.
  if(installDependencies)runNpm(target,['ci','--omit=dev','--no-audit','--no-fund']);
  else throw installError('DEPENDENCY_PROVISIONING_REQUIRED');
  const acquired=await acquireSnowArtifact({root:target,artifact});
  const managed=await installManagedSnow({descriptor,artifact:acquired.artifact,expectedDigest:SNOW_RELEASE.sha256});
  const runtime={snowHome:managed.snowHome,nodePath:path.join(managed.snowHome,'node.exe')};
  runtime.nodePath=await resolveInstanceNode({descriptor,config:runtime,host:{execPath:'Desktop.exe',versions:{electron:'installation-check'}}});
  bootstrapLocal(target,{descriptor,snowHome:managed.snowHome,ports:selectedPorts});
  const created={source:'created',cleanup:'owned',createdByTransaction:creation.transactionId};
  const nodeModules=path.join(target,'node_modules'),npmManifest=path.join(nodeModules,'.package-lock.json');
  const statePath=path.join(target,'state'),stateInventory=await inventoryCreatedTree(statePath);
  const createdPaths=[
    {path:managed.snowHome,kind:'dependency',...created,manifestPath:managed.manifestPath,sha256:sha256(await fs.readFile(managed.manifestPath))},
    {path:nodeModules,kind:'dependency',...created,manifestPath:npmManifest,sha256:sha256(await fs.readFile(npmManifest)),...await inventoryCreatedTree(nodeModules)},
    {path:statePath,kind:'data',...created,mutable:true,namespace:'instance-state',sha256:sha256(JSON.stringify(stateInventory)),...stateInventory},
  ];
  for(const name of ['config.json','state/mode.json','state/current-role.json'])createdPaths.push({path:path.join(target,name),kind:'data',...created,mutable:true,sha256:sha256(await fs.readFile(path.join(target,name)))});
  await appendInstallationEvidence(target,{profileEntries:[],links:[],paths:createdPaths});
  const plan=await planInstanceInstall({descriptor,profilePath:path.join(dshHome,'profiles',profile),runtime,creation});
  await fs.writeFile(path.join(target,'.instance-install','candidate.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  return {descriptor,runtime,plan,stage,dependencyArtifact:{version:SNOW_RELEASE.version,sha256:SNOW_RELEASE.sha256,bytes:acquired.bytes,downloaded:acquired.downloaded},candidate:path.join(target,'.instance-install','candidate.json')};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),get=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
  try {
    if(get('--apply-plan')||get('--rollback-plan')) {
      const plan=JSON.parse(await fs.readFile(get('--apply-plan')||get('--rollback-plan'),'utf8'));
      const options={expectedHashes:plan.beforeHashes,writersStopped:args.includes('--writers-stopped'),action:'rollback',recoverLock:args.includes('--recover-lock')};
      console.log(JSON.stringify(get('--apply-plan')?await applyInstanceInstall(plan,options):await recoverInstanceInstall(plan,options)));
    } else {
      const result=await preparePublicInstall({target:get('--target'),dshHome:get('--dsh-home'),profile:get('--profile'),artifact:get('--snow-artifact')});
      console.log(JSON.stringify({prepared:true,candidate:result.candidate,conflicts:result.plan.conflicts,dependencyArtifact:result.dependencyArtifact}));
    }
  } catch(error){console.error(error.code||error.message);if(error.detail)console.error(error.detail);process.exitCode=1;}
}
