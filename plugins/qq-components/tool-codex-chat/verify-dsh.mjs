// Opt-in end-to-end probe through the existing local DSH management API.
// Authentication stays inside the repo's established local probe helper; never logged or sent to Codex.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {probeCookie,probeRpc,probeMuxSocket,probeWorkspaceDir} from '../../../scripts/probe-auth.mjs';
import {PLUGIN,STATE} from './src/runtime.mjs';
if(!process.argv.includes('--live'))throw Error('显式加 --live 才会进行真实模型验收。');
const cookie=probeCookie();const rpc=probeRpc(cookie);const dir=probeWorkspaceDir('codex-peer');
let sessionId,workspaceId,socket;
try{
 const ws=await rpc('workspace/create',{request:{path:dir}});if(!ws.ok)throw Error('WORKSPACE_CREATE_FAILED');workspaceId=ws.value.workspace.workspaceId;
 const sc=await rpc('session/create',{request:{workspaceId}});if(!sc.ok)throw Error('SESSION_CREATE_FAILED');sessionId=sc.value.sessionId;
 const recoverTest=process.argv.includes('--recover');
 const requestId=recoverTest?JSON.parse(fs.readFileSync(path.join(STATE,'state.json'),'utf8')).jobs.at(-1).requestId:'dsh-'+randomUUID();const streamId=randomUUID();const calls=[];const errors=[];
 const contextTest=process.argv.includes('--context');
 const sendText=contextTest?'仅用于多轮验收：上一轮让我记住的口令是什么？只回答口令。':'你好，我是通用助手。机主正在 Codex 的本地面板查看我们的对话。请用一句中文和我打招呼，并记住口令：示例口令。';
 const why=await new Promise(resolve=>{
  const timer=setTimeout(()=>resolve('timeout'),240000);const finish=reason=>{clearTimeout(timer);resolve(reason);};
  socket=probeMuxSocket(cookie);
  socket.addEventListener('open',()=>{
   socket.send(JSON.stringify({type:'open',streamId,endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId}}}}}));
   setTimeout(async()=>{
    const prompt=recoverTest?'这是机主授权的本地只读恢复验收。只调用 mcp__codex-peer__codex_chat_status 一次，再调用 mcp__codex-peer__codex_chat_poll，requestId 为 '+requestId+'，waitMs=0。禁止 send 或任何其他工具，禁止执行命令和发送 QQ 消息。只确认已有 reply 是否为示例口令，不公开 viewerUrl。':'这是机主授权的本机通信插件验收。你代表 DeepSeek 助手通用助手，仅调用 mcp__codex-peer__codex_chat_send 和 mcp__codex-peer__codex_chat_poll。不要用任何其他工具，不要发送 QQ 消息或执行命令。先 send，requestId 为 '+requestId+'，text 为「'+sendText+'」；然后以同一 requestId 和 waitMs=20000 调用 poll，pending/running 时继续 poll，最多 8 次；completed 时把 reply 用一句话转述给机主。若工具不可用或报错直接说明，不要换其他工具。';
    const result=await rpc('session/prompt',{request:{sessionId,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:prompt}]}});
    if(!result.ok)finish('prompt-failed');
   },600);
  });
  socket.addEventListener('message',event=>{
   let message;try{message=JSON.parse(event.data);}catch{return;}
   if(message.type!=='item'||message.streamId!==streamId||message.value?.type!=='event')return;
   const e=message.value.event;
   if(e.type==='tool/call'){const name=e.data?.name??e.data?.toolName;calls.push(name);console.log('DSH tool: '+name);}
   if(e.type==='tool/result'&&(e.data?.isError||e.data?.error))errors.push(e.data?.name??e.data?.toolName??'tool-error');
   if(e.type==='turn/end')finish('done');
  });
  socket.addEventListener('error',()=>finish('socket-error'));socket.addEventListener('close',()=>finish('closed'));
 });
 console.log('DSH verification: '+why);
 const state=JSON.parse(fs.readFileSync(path.join(STATE,'state.json'),'utf8'));const job=state.jobs.find(j=>j.requestId===requestId);
 const proof={at:new Date().toISOString(),dshSessionId:sessionId,calls,errors,threadId:state.threadId,job};
 fs.writeFileSync(path.join(PLUGIN,'docs',recoverTest?'dsh-recovery-result.json':contextTest?'dsh-context-result.json':'dsh-live-result.json'),JSON.stringify(proof,null,2));
 if(why!=='done'||job?.status!=='completed'||!calls.includes('mcp__codex-peer__codex_chat_'+(recoverTest?'status':'send'))||!calls.includes('mcp__codex-peer__codex_chat_poll'))throw Error('DSH_E2E_INCOMPLETE');
 console.log('Verified: DeepSeek -> MCP -> Codex -> MCP -> DeepSeek');
}finally{
 socket?.close();if(sessionId)await rpc('workspace/archiveSession',{request:{sessionId}});
 if(workspaceId)await rpc('workspace/delete',{request:{workspaceId}});
 // Directory was created by probeWorkspaceDir in the system temp root, never a user workspace.
 if(fs.existsSync(dir))fs.rmdirSync(dir);
}
