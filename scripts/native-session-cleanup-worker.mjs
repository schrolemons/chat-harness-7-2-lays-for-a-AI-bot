// Child of the exclusively owned synthetic fixture. Never uses a default DSH home.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const home=process.argv[2];
if(!home||!path.isAbsolute(home)||!process.send)throw Error('Explicit fixture IPC home required');
const hostPackage=createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
const host=createRequire(hostPackage),base=createRequire(host.resolve('@deepseek-ai/dsh-base/package.json'));
const modules={};
for(const name of ['cordis','cordis-plugin-loader','dsh-session','dsh-session-projection','dsh-session-persistence-jsonl','dsh-storage','dsh-storage-json','dsh-storage-domain','dsh-workspace','dsh-session-query-sqlite','dsh-session-projection-cache']) {
 const resolve=['dsh-session-persistence-jsonl','dsh-storage-json','dsh-session-projection-cache','dsh-session-query-sqlite'].includes(name)?base:host;
 const file=resolve.resolve('@deepseek-ai/'+name);
 if(name!=='cordis'&&name!=='cordis-plugin-loader'&&resolve(resolve.resolve('@deepseek-ai/'+name+'/package.json')).version!=='0.2.1-rc.2')throw Error('Unpinned fixture module: '+name);
 modules[name]=await import(pathToFileURL(file));
}
const ctx=new modules.cordis.Context();
await ctx.plugin(modules['cordis-plugin-loader'].default,{baseUrl:pathToFileURL(hostPackage).href});
const mount=async(name,config)=>ctx.plugin(ctx.loader.unwrapExports(modules[name]),config);
for(const name of ['dsh-session','dsh-session-projection'])await mount(name);
const {z}=await import(pathToFileURL(host.resolve('zod')));
ctx.sessionProjections.register({key:'synthetic',stateVersion:1,stateSchema:z.object({body:z.string()}),init:header=>({body:'synthetic cached '+header.id}),apply:state=>state});
await mount('dsh-session-persistence-jsonl',{root:path.join(home,'sessions'),compression:'none'});
await mount('dsh-storage');await mount('dsh-storage-json',{root:path.join(home,'storages')});await mount('dsh-storage-domain',{backend:'json'});
await mount('dsh-workspace');await mount('dsh-session-projection-cache',{writeEveryEvents:1,writeIntervalMs:10000});
await mount('dsh-session-query-sqlite',{path:path.join(home,'query.sqlite'),openAt:'startup'});
async function snapshot(ids=[]) {
 const listed=await ctx.sessionQuery.listSessions();
 const searched=await ctx.sessionQuery.searchSessions({query:'synthetic',limit:100});
 return {listed:listed.map(x=>x.header.id),searched,workspaces:ctx.workspaceRegistry.list().map(w=>({id:w.id,path:w.path,title:w.title,sessionIds:[...w.sessionIds]})),archived:[...ctx.workspaceRegistry.archivedSessionIds],pinned:[...ctx.workspaceRegistry.pinnedSessionIds],events:await Promise.all(ids.map(async sessionId=>({sessionId,result:await ctx.sessionQuery.searchEvents({sessionId,query:'synthetic',limit:100})})))};
}
process.on('message',async request=>{
 try {
 let result;
 if(request.command==='seed') {
  result=[];
  for(const item of request.items) {
   await fs.mkdir(item.cwd,{recursive:true});const ws=await ctx.workspaceRegistry.create(item.cwd,'Synthetic workspace');
   const session=ctx.sessions.create(item.id,{meta:{cwd:item.cwd,agentPreset:item.preset||'standard'}});
   session.append('user/message',{id:item.id+'-message',role:'user',source:{kind:'user'},content:[{type:'text',text:'synthetic body '+item.id}]},{surfaceOp:'append'});
   const handle=await ctx.sessionPersistence.create(session.header);await handle.append(session.snapshotEvents());await handle.close();
   await ws.attachSession(session.id);await ctx.sessionProjectionCache.write(session);
   if(item.archive)await ctx.workspaceRegistry.archiveSession(session.id);else if(item.pin)await ctx.workspaceRegistry.pinSession(session.id);
   result.push({header:session.header,path:ctx.sessionPersistence.locate(session.header).path,workspaceId:ws.id});
  }
  await snapshot();
 } else if(request.command==='snapshot')result=await snapshot(request.ids);
 else if(request.command==='detach') {
  for(const row of request.rows){await ctx.workspaceRegistry.get(row.workspaceId).detachSession(row.sessionId);await ctx.workspaceRegistry.unarchiveSession(row.sessionId);await ctx.workspaceRegistry.unpinSession(row.sessionId);}
  result=await snapshot();
 } else if(request.command==='shutdown') {
  await ctx.fiber.dispose();process.send({id:request.id,result:true},()=>process.disconnect());return;
 } else throw Error('Unknown fixture command');
 process.send({id:request.id,result});
 }catch(error){process.send({id:request.id,error:error.stack});}
});
process.send({ready:true});
