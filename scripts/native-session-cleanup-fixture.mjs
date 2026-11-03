// Exclusively created homes and retained ChildProcess handles; never adopts a real home/PID.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {zstdCompressSync,zstdDecompressSync,constants} from 'node:zlib';
import {zstdFrameEnd} from './recover-session-title-metadata.mjs';
import {initializeManifest,appendOwnedSession,appendInstallationEvidence,readManifest} from '../src/instance-manifest.mjs';
import {fingerprintSessionHeader} from '../src/instance-session-ownership.mjs';
import {createOfflineSessionStoreAdapter} from '../src/instance-session-cleanup.mjs';
import {sha256,rowHash,tree,cleanupError} from '../src/instance-cleanup-files.mjs';
import {SNOW_RELEASE} from './install-managed-snow.mjs';
const worker=fileURLToPath(new URL('./native-session-cleanup-worker.mjs',import.meta.url));
export async function cleanupFixture(t,{shared=false,compression='none',nestedSnowAsset=false}={}) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'instance-cleanup-')),home=path.join(dir,'home');await fs.mkdir(home);
 const root=path.join(dir,'alpha'),beta=path.join(dir,'beta');await fs.mkdir(root);await fs.mkdir(beta);
 const children=new Set(),records=[],ownerToken=randomUUID();let frozen=false,unknown=false,host,snapshot,serial=0;
 async function launch(internal=false){
  if(frozen&&!internal)throw cleanupError('LAUNCH_FROZEN');
  const child=fork(worker,[home,compression],{execArgv:[],silent:true,windowsHide:true,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''}});children.add(child);
  let stderr='';child.stderr.on('data',b=>stderr+=b);const pending=new Map();
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code)=>{children.delete(child);for(const {reject} of pending.values())reject(Error('Fixture child closed '+code+' '+stderr));pending.clear();if(code===0)resolve();else reject(Error('Fixture child failed '+code+' '+stderr));});});
  const ready=new Promise((resolve,reject)=>{const done=m=>{if(m.ready){child.off('message',done);resolve();}};child.on('message',done);closed.then(()=>reject(Error('Exited before ready')),reject);});
  child.on('message',m=>{if(!m.id)return;const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);});
  await ready;
  const call=(command,data={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});child.send({id,command,...data});});
  return {child,call,closed,async stop(){await call('shutdown');await closed;}};
 }
 t.after(async()=>{if(host&&children.has(host.child))await host.stop();if(children.size)throw Error('Fixture writer leaked');if(path.dirname(dir)!==os.tmpdir())throw Error('Invalid fixture root');await fs.rm(dir,{recursive:true,force:true});});
 const cwd=shared?path.join(dir,'shared'):path.join(root,'state','workspaces','chat');await fs.mkdir(cwd,{recursive:true});
 const descriptor={version:1,instanceId:'alpha',label:'Synthetic Alpha',root,dshHome:home,profile:'fixture',bundleName:'synthetic-alpha',entryId:'alpha-mode',settingsNamespace:'alpha-mode',presetIdMap:{'qq-chat':'alpha-chat'},workspaces:{chat:cwd,learning:cwd,task:cwd,summary:cwd}};
 const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
 await write(path.join(root,'package.json'),{name:'synthetic-alpha',version:'1.0.0'});await write(path.join(root,'entry.mjs'),'export const synthetic=true;\n');
 const creation={transactionId:randomUUID(),root,source:'created',files:await Promise.all(['package.json','entry.mjs'].map(async p=>({path:p,sha256:sha256(await fs.readFile(path.join(root,p)))})))};
 await write(path.join(root,'.instance-install','creation.json'),creation);await write(path.join(root,'.qq-bridge-instance.json'),descriptor);
 await initializeManifest(root,descriptor);
 const bdesc={...descriptor,instanceId:'beta',root:beta,bundleName:'synthetic-beta'};await initializeManifest(beta,bdesc);
 const created={source:'created',cleanup:'owned',createdByTransaction:creation.transactionId};
 await write(path.join(root,'config.json'),{synthetic:true});await write(path.join(root,'state','mode.json'),{enabled:false});
 await write(path.join(root,'node_modules','.package-lock.json'),{name:'synthetic-alpha'});await write(path.join(root,'node_modules','example','index.js'),'module.exports=1;');
 await fs.symlink(path.join(root,'node_modules','example'),path.join(root,'node_modules','example-link'),process.platform==='win32'?'junction':'dir');
 const snow=path.join(root,'managed-dependencies','synthetic-snow'),snowFile=path.join(snow,'.qq-bridge-managed.json');
 await write(path.join(snow,'index.mjs'),'export const fixture=true;');await write(path.join(snow,'node.exe'),'Synthetic non-executable fixture bytes');
 const snowFiles={'index.mjs':sha256(await fs.readFile(path.join(snow,'index.mjs'))),'node.exe':sha256(await fs.readFile(path.join(snow,'node.exe')))};
 if(nestedSnowAsset){const name='native/sqlite/prebuilds/synthetic.node';await write(path.join(snow,name),'Synthetic non-executable asset');snowFiles[name]=sha256(await fs.readFile(path.join(snow,name)));}
 await write(snowFile,{version:1,kind:'snowluma',instanceId:'alpha',entry:'index.mjs',runtime:'node.exe',artifact:SNOW_RELEASE,files:snowFiles,patches:[]});
 const profile=path.join(home,'profiles','fixture');await write(path.join(profile,'package.json'),{dependencies:{'synthetic-alpha':'link:'+root.replaceAll('\\','/'),'unrelated':'1.0.0'},dsh:{profile:{bundles:['unrelated','synthetic-alpha']}}});
 const row={id:'alpha-mode',name:'synthetic-alpha',config:{enabled:false}},patch=path.join(profile,'cordis.patch.yml');
 await write(patch,'# Keep unrelated comment\n- insert:\n    - id: unrelated\n      name: unrelated\n    - id: alpha-mode\n      name: synthetic-alpha\n      config:\n        enabled: false\n');
 await fs.mkdir(path.join(profile,'node_modules'));await fs.symlink(root,path.join(profile,'node_modules','synthetic-alpha'),process.platform==='win32'?'junction':'dir');
 await appendInstallationEvidence(root,{profileEntries:[{...created,path:patch,id:row.id,name:row.name,sha256:rowHash(row)}],links:[{...created,path:path.join(profile,'node_modules','synthetic-alpha'),target:root}],paths:[
  {...created,path:root,kind:'code',sha256:creation.files[0].sha256,files:creation.files},
  {...created,path:path.join(root,'config.json'),kind:'data',mutable:true,sha256:sha256(await fs.readFile(path.join(root,'config.json')))},
  {...created,path:path.join(root,'state'),kind:'data',mutable:true,namespace:'instance-state',sha256:rowHash(await tree(path.join(root,'state'))),...await tree(path.join(root,'state'))},
  {...created,path:path.join(root,'node_modules'),kind:'dependency',manifestPath:path.join(root,'node_modules','.package-lock.json'),sha256:sha256(await fs.readFile(path.join(root,'node_modules','.package-lock.json'))),...await tree(path.join(root,'node_modules'))},
  {...created,path:snow,kind:'dependency',manifestPath:snowFile,sha256:sha256(await fs.readFile(snowFile))}
 ]});
 host=await launch();
 records.push(...await host.call('seed',{items:[{id:'alpha-session',cwd,preset:'alpha-chat',archive:true},{id:'beta-session',cwd:path.join(beta,'workspace'),preset:'beta-chat',pin:true},{id:'ordinary-session',cwd:shared?cwd:path.join(dir,'ordinary-workspace')},{id:'alpha-pinned',cwd,preset:'alpha-chat',pin:true}]}));
 for(const r of records.filter(r=>r.header.id.startsWith('alpha-')))await appendOwnedSession(root,{sessionId:r.header.id,workspaceId:r.workspaceId,path:r.path,source:'created',cleanup:'owned',headerFingerprint:fingerprintSessionHeader(r.header)});
 if(shared){const r=records.find(r=>r.header.id==='ordinary-session');await appendOwnedSession(root,{sessionId:r.header.id,workspaceId:r.workspaceId,path:r.path,source:'verified-legacy',cleanup:'preserve',headerFingerprint:fingerprintSessionHeader(r.header)});}
 const extraArtifacts=new Map();
 const owner={hostPackage:createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'),
  async assertExclusive(token){if(token!==ownerToken||!frozen||unknown||children.size)throw cleanupError('UNSUPPORTED_SESSION_DELETE','Home has an active/unknown writer or unproven shutdown');},
  async freezeAndSnapshot(){
   if(unknown)throw cleanupError('UNSUPPORTED_SESSION_DELETE','Unknown writer');
   if(!frozen){frozen=true;snapshot=await host.call('snapshot',{ids:records.map(r=>r.header.id)});await host.stop();}
   return this.snapshotForCleanup();
  },
  async snapshotForCleanup(){
   await this.assertExclusive(ownerToken);
   const sessions=[];
   for(const r of records){const paths=[{path:r.path,kind:'log'},{path:path.join(home,'storages','session_projcache','sessions',r.header.id+'.json'),kind:'cache'},...(extraArtifacts.get(r.header.id)||[])];sessions.push({sessionId:r.header.id,path:r.path,workspaceId:r.workspaceId,header:r.header,artifacts:await Promise.all(paths.map(async a=>({...a,sha256:sha256(await fs.readFile(a.path))})))});}
   return {ownerToken,home,sessionsRoot:path.join(home,'sessions'),storageRoot:path.join(home,'storages'),indexes:[{path:path.join(home,'query.sqlite'),enabled:true}],snapshot,sessions};
  },
  async reconcile(rows,before){
   await this.assertExclusive(ownerToken);const maintenance=await launch(true);host=maintenance;
   try{await maintenance.call('detach',{rows});const remaining=before.listed.filter(id=>!rows.some(r=>r.sessionId===id));const result=await maintenance.call('snapshot',{ids:remaining});await maintenance.stop();
    const workspace=JSON.parse(await fs.readFile(path.join(home,'storages','workspace.json'),'utf8'));
    const db=new DatabaseSync(path.join(home,'query.sqlite'),{readOnly:true});let catalogIds;try{catalogIds=db.prepare('SELECT id FROM persisted_sessions UNION SELECT session_id AS id FROM persisted_docs').all().map(r=>r.id);}finally{db.close();}
    return {...result,catalogIds,workspaceIds:Object.values(workspace.tables.workspaces).flatMap(w=>w.sessionIds)};
   }finally{if(children.has(maintenance.child))await maintenance.stop();}
  }
 };
 return {dir,home,root,beta,descriptor,profile,records,owner,adapter:createOfflineSessionStoreAdapter(owner),
  manifest:()=>readManifest(root),launch:()=>launch(),revokeOwner(){unknown=true;},
  async addHistorical(){
   await owner.freezeAndSnapshot();const r=records[0],compressed=compression==='default',file=path.join(path.dirname(r.path),'session.v3.jsonl'+(compressed?'.zstd':'')),bytes=await fs.readFile(r.path);
   const firstEnd=compressed?zstdFrameEnd(bytes):bytes.indexOf(10)+1,first=compressed?zstdDecompressSync(bytes.subarray(0,firstEnd),{maxOutputLength:64*1024}):bytes.subarray(0,firstEnd),header=JSON.parse(first.toString('utf8'));header.version=3;
   const line=Buffer.from(JSON.stringify(header)+'\n'),head=compressed?zstdCompressSync(line,{params:{[constants.ZSTD_c_checksumFlag]:1}}):line;
   await fs.writeFile(file,Buffer.concat([head,bytes.subarray(firstEnd)]));extraArtifacts.set(r.header.id,[{path:file,kind:'log'}]);return file;
  },
  async seedUnrecorded(){return host.call('seed',{items:[{id:'unrecorded-session',cwd,preset:'alpha-chat'}]});},
  async primeCatalog(){await host.stop();host=await launch();return host.call('snapshot',{ids:records.map(r=>r.header.id)});},
  async stoppedSnapshot(){return owner.freezeAndSnapshot();}
 };
}
