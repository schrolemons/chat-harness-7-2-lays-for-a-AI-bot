// Explicit local, read-only model-tool smoke check. Never sends QQ messages or restarts a process.
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {probeCookie,probeRpc,probeMuxSocket,probeWorkspaceDir} from './probe-auth.mjs';
if(!process.argv.includes('--live'))throw Error('加 --live 才会进行 DSH 模型调用验收。');
const rpc=probeRpc(probeCookie()),dir=probeWorkspaceDir('bridge-health');let workspaceId,sessionId,socket;
try{
 const w=await rpc('workspace/create',{request:{path:dir}});if(!w.ok)throw Error('WORKSPACE_FAILED');workspaceId=w.value.workspace.workspaceId;
 const s=await rpc('session/create',{request:{workspaceId}});if(!s.ok)throw Error('SESSION_FAILED');sessionId=s.value.sessionId;
 const streamId=randomUUID(),calls=[];let reply='';
 const why=await new Promise(resolve=>{
  const timer=setTimeout(()=>resolve('timeout'),90000);const finish=x=>{clearTimeout(timer);resolve(x);};socket=probeMuxSocket(probeCookie());
  socket.addEventListener('open',()=>{
   socket.send(JSON.stringify({type:'open',streamId,endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId}}}}}));
   setTimeout(async()=>{const r=await rpc('session/prompt',{request:{sessionId,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'这是机主授权的只读诊断验收。我担心 bridge 又连不上，请先且只调用 mcp__bridge-health__bridge_health 一次。根据其 verdict 回答当前是否需要修连接；ready 必须说明当前正常、不需要重启。不读日志、不执行命令、不改配置、不调用任何其他工具、不发QQ消息。用一句中文答复。'}]}});if(!r.ok)finish('prompt_failed');},500);
  });
  socket.addEventListener('message',ev=>{let m;try{m=JSON.parse(ev.data);}catch{return;}if(m.type!=='item'||m.streamId!==streamId||m.value?.type!=='event')return;const e=m.value.event;
   if(e.type==='tool/call'){calls.push(e.data?.name??e.data?.toolName);console.log('DSH called: '+calls.at(-1));}
   if(e.type==='assistant/message')for(const c of e.data?.message?.content||[])if(c.type==='text')reply+=c.text;
   if(e.type==='turn/end')finish('done');
  });socket.addEventListener('error',()=>finish('error'));socket.addEventListener('close',()=>finish('closed'));
 });
 console.log(JSON.stringify({why,calls,reply:reply.slice(-500)}));
 if(why!=='done'||calls.length!==1||calls[0]!=='mcp__bridge-health__bridge_health'||!reply.includes('正常'))throw Error('HEALTH_E2E_FAILED');
}finally{socket?.close();if(sessionId)await rpc('workspace/archiveSession',{request:{sessionId}});if(workspaceId)await rpc('workspace/delete',{request:{workspaceId}});if(fs.existsSync(dir))fs.rmdirSync(dir);}
