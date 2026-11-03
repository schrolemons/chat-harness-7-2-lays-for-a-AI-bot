import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {initializeManifest} from '../src/instance-manifest.mjs';
import {createInstanceScope} from '../src/dsh-instance-scope.mjs';
import {readInstanceSessionPolicy} from '../src/instance-session-policy.mjs';
export const hostPackage=createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
const requireHost=createRequire(hostPackage),requireBase=createRequire(requireHost.resolve('@deepseek-ai/dsh-base/package.json'));
export const hostImport=async name=>name.startsWith('file:')?import(name):import(pathToFileURL((()=>{try{return requireHost.resolve(name);}catch{return requireBase.resolve(name);}})()).href);
const modules={};for(const name of ['cordis','cordis-plugin-loader','dsh-system-prompt','dsh-tools','dsh-session','dsh-agent','dsh-session-projection','dsh-agent-preset-registry','dsh-session-persistence-jsonl','dsh-storage','dsh-storage-json','dsh-storage-domain','dsh-workspace','dsh-session-query-sqlite'])modules[name]=await hostImport('@deepseek-ai/'+name);
export async function nativeSessionFixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-session-owned-')),ctx=new modules.cordis.Context();
 const mount=async(name,config)=>ctx.plugin(ctx.loader?ctx.loader.unwrapExports(modules[name]):modules[name].default||modules[name],config);
 await ctx.plugin(modules['cordis-plugin-loader'].default,{baseUrl:pathToFileURL(hostPackage).href});
 for(const name of ['dsh-system-prompt','dsh-tools','dsh-session','dsh-agent','dsh-session-projection'])await mount(name);
 await mount('dsh-agent-preset-registry',{default:'standard'});
 await mount('dsh-session-persistence-jsonl',{root:path.join(dir,'host','sessions'),compression:'none'});
 await mount('dsh-storage');await mount('dsh-storage-json',{root:path.join(dir,'host','storages')});await mount('dsh-storage-domain',{backend:'json'});await mount('dsh-workspace');await mount('dsh-session-query-sqlite',{path:':memory:',openAt:'never'});
 const scopes=[];
 t.after(async()=>{for(const scope of scopes)await scope.dispose();await ctx.fiber.dispose();assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});});
 async function instance(id,providedDescriptor){
 const descriptor=providedDescriptor||{version:1,instanceId:id,root:path.join(dir,id),dshHome:path.join(dir,'host'),profile:'fixture',bundleName:'synthetic-'+id,entryId:id+'-mode',settingsNamespace:id+'-mode',presetIdMap:{}};
 await fs.mkdir(descriptor.root,{recursive:true});await initializeManifest(descriptor.root,descriptor);
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
