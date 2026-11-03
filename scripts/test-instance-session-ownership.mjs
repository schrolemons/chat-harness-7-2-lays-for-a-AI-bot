// Actual pinned host services, synthetic isolated roots; no model/QQ/HTTP server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {initializeManifest,readManifest} from '../src/instance-manifest.mjs';
import {createInstanceScope} from '../src/dsh-instance-scope.mjs';
import {readInstanceSessionPolicy} from '../src/instance-session-policy.mjs';
import {NodeApiClient} from '../src/dsh-client.js';
const hostPackage=createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
const requireHost=createRequire(hostPackage),requireBase=createRequire(requireHost.resolve('@deepseek-ai/dsh-base/package.json'));
const hostImport=async name=>name.startsWith('file:')?import(name):import(pathToFileURL((()=>{try{return requireHost.resolve(name);}catch{return requireBase.resolve(name);}})()).href);
const modules={};for(const name of ['cordis','cordis-plugin-loader','dsh-system-prompt','dsh-tools','dsh-session','dsh-agent','dsh-session-projection','dsh-agent-preset-registry','dsh-session-persistence-jsonl','dsh-storage','dsh-storage-json','dsh-storage-domain','dsh-workspace','dsh-session-query-sqlite'])modules[name]=await hostImport('@deepseek-ai/'+name);
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-session-owned-')),ctx=new modules.cordis.Context();
 const mount=async(name,config)=>ctx.plugin(ctx.loader?ctx.loader.unwrapExports(modules[name]):modules[name].default||modules[name],config);
 await ctx.plugin(modules['cordis-plugin-loader'].default,{baseUrl:pathToFileURL(hostPackage).href});
 for(const name of ['dsh-system-prompt','dsh-tools','dsh-session','dsh-agent','dsh-session-projection'])await mount(name);
 await mount('dsh-agent-preset-registry',{default:'standard'});
 await mount('dsh-session-persistence-jsonl',{root:path.join(dir,'host','sessions'),compression:'none'});
 await mount('dsh-storage');await mount('dsh-storage-json',{root:path.join(dir,'host','storages')});await mount('dsh-storage-domain',{backend:'json'});await mount('dsh-workspace');await mount('dsh-session-query-sqlite',{path:':memory:',openAt:'never'});
 const scopes=[];
 t.after(async()=>{for(const scope of scopes)await scope.dispose();await ctx.fiber.dispose();assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});});
 async function instance(id){
 const descriptor={version:1,instanceId:id,root:path.join(dir,id),dshHome:path.join(dir,'host'),profile:'fixture',bundleName:'synthetic-'+id,entryId:id+'-mode',settingsNamespace:id+'-mode',presetIdMap:{}};
 await fs.mkdir(descriptor.root);await initializeManifest(descriptor.root,descriptor);
 const scope=await createInstanceScope(ctx,{...descriptor,hostImport,definitions:['qq-chat','qq-chat-v2','qq-admin','qq-learning','qq-task-worker','campus-summary'].map(id=>({id,plugins:[]}))});scopes.push(scope);scope.activate();
 return {descriptor,scope,policy:readInstanceSessionPolicy({descriptor})};
 }
 async function nativeCreate(instance,preset,workspace){
  let agent;
  await instance.scope.ctx.plugin({inject:['sessions','agents'],apply(owner){const session=owner.sessions.create(undefined,{meta:{cwd:workspace.path,agentPreset:preset}});agent={id:session.id,session,ctx:owner};owner.agents.register(agent);}});
  await workspace.attachSession(agent.id);return agent;
 }
 return {ctx,dir,instance,nativeCreate};
}

test('native header/scope/workspace/JSONL proof appends exact new sessions for two roots without changing ordinary sessions',async t=>{
 const f=await fixture(t),a=await f.instance('alpha'),b=await f.instance('beta');
 const {createSessionOwnershipRecorder,fingerprintSessionHeader}=await import('../src/instance-session-ownership.mjs');
 const preserved=[];
 for(const [id,cwd] of [['legacy-private',path.join(f.dir,'old-private-cwd')],['ordinary-dsh',path.join(f.dir,'ordinary-cwd')]]){
  await fs.mkdir(cwd);const session=f.ctx.sessions.create(id,{meta:{cwd,agentPreset:id==='legacy-private'?'qq-chat-v2':'standard'}});
  session.append('user/message',{id:id+'-message',source:{kind:'user'},content:[{type:'text',text:'Synthetic preserved original body '+id}]},{surfaceOp:'append'});
  const handle=await f.ctx.sessionPersistence.create(session.header);await handle.append(session.snapshotEvents());await handle.close();
  const file=f.ctx.sessionPersistence.locate(session.header).path;preserved.push({session,file,bytes:await fs.readFile(file),events:JSON.stringify(session.snapshotEvents())});
 }
 const originalMapping={'private:123':'legacy-private'};await fs.mkdir(path.join(a.descriptor.root,'state'),{recursive:true});const mappingFile=path.join(a.descriptor.root,'state','sessions.json');await fs.writeFile(mappingFile,JSON.stringify(originalMapping));const beforeMapping=await fs.readFile(mappingFile);
 const mappings=[];
 for(const instance of [a,b]){
  const recorder=await createSessionOwnershipRecorder({ctx:f.ctx,descriptor:instance.descriptor,scope:instance.scope,hostBaseUrl:pathToFileURL(hostPackage).href,hostImport});
  const client=new NodeApiClient('http://127.0.0.1:1',1000,{}, {policy:instance.policy,recordCreatedSession:recorder});
  client.callUnary=async(method,data)=>{if(method==='workspace.create'){const ws=await f.ctx.workspaceRegistry.create(data.path);return {result:{ok:true,value:{workspace:{workspaceId:ws.id,path:ws.path}}}};}if(method==='session.create'){const ws=f.ctx.workspaceRegistry.get(data.workspaceId),agent=await f.nativeCreate(instance,data.agentPreset,ws);return {result:{ok:true,value:{sessionId:agent.id,agentPreset:data.agentPreset}}};}throw Error(method);};
  const result=await client.sessions.create({agentPreset:'qq-chat-v2'});assert.equal(result.ownership.status,'recorded',result.ownership.error);mappings.push({'private:123':result.result.value.sessionId});
  const receipt=await readManifest(instance.descriptor.root),row=receipt.sessions[0],agent=f.ctx.agents.get(row.sessionId);
  assert.equal(row.headerFingerprint,fingerprintSessionHeader(agent.session.header));assert.equal(row.source,'created');assert.equal(row.path,f.ctx.sessionPersistence.locate(agent.session.header).path);assert.notEqual(row.path,agent.session.header.cwd);assert(path.isAbsolute(row.path));
 }
 assert.notEqual(mappings[0]['private:123'],mappings[1]['private:123']);assert.equal(f.ctx.sessions.list().length,4);
 const listed=await f.ctx.sessionQuery.listSessions();assert.equal(listed.length,4);
 for(const item of preserved){assert.deepEqual(await fs.readFile(item.file),item.bytes);assert.equal(JSON.stringify(item.session.snapshotEvents()),item.events);assert(listed.some(row=>row.header.id===item.session.id));}
 assert.deepEqual(await fs.readFile(mappingFile),beforeMapping);
 const recorder=await createSessionOwnershipRecorder({ctx:f.ctx,descriptor:a.descriptor,scope:a.scope,hostBaseUrl:pathToFileURL(hostPackage).href,hostImport});
 const other=(await readManifest(b.descriptor.root)).sessions[0];await assert.rejects(recorder({sessionId:other.sessionId,workspaceId:other.workspaceId}),/OWNERSHIP/);
 const own=(await readManifest(a.descriptor.root)).sessions[0];await assert.rejects(recorder({sessionId:own.sessionId,workspaceId:other.workspaceId}),/OWNERSHIP/);
 assert.equal((await readManifest(a.descriptor.root)).sessions.length,1);
});

test('same-name fake locate provider is unsupported and cannot mint ownership evidence',async()=>{
 const {createSessionOwnershipRecorder}=await import('../src/instance-session-ownership.mjs');
 const ctx=new modules.cordis.Context();
 try{await ctx.plugin({apply(owner){owner.provide('sessionPersistence',{locate(){return {kind:'jsonl',path:path.join(os.tmpdir(),'fake.jsonl')};}});}});
 await assert.rejects(createSessionOwnershipRecorder({ctx,descriptor:{},scope:{},hostBaseUrl:pathToFileURL(hostPackage).href,hostImport}),/UNSUPPORTED/);
 }finally{await ctx.fiber.dispose();}
});
