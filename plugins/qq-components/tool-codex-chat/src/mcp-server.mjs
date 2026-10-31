import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { makeController, STATE } from './runtime.mjs';
import { createViewer } from './viewer.mjs';
let controller,viewer,starting;
const get=async()=>{
  if(controller)return controller;
  starting??=(async()=>{
    const c=makeController();
    try{viewer=await createViewer({enabled:()=>c.enabled(),read:async()=>{const {viewerUrl,...status}=c.status();return {...status,messages:status.threadId?await c.client.readHistory(status.threadId):[]};}});
      c.viewerUrl=viewer.url;fs.writeFileSync(path.join(STATE,'viewer-info.json'),JSON.stringify({pid:process.pid,url:viewer.url}),{mode:0o600});controller=c;return c;
    }catch(e){await c.close();throw e;}
  })().catch(e=>{starting=null;throw e;});return starting;
};
const requestId=z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/).describe('每条新消息的唯一 ID；重试必须用原 ID，不要换 ID 重发');
const server=new McpServer({name:'codex-peer',version:'0.1.0'});
function register(name,description,schema,handler,{images=false}={}){
  server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:name==='codex_chat_status',destructiveHint:false,openWorldHint:name==='codex_chat_send'}},async(input)=>{
    try{const result=await handler(input);const blocks=[{type:'text',text:JSON.stringify(images&&result.images?(({images,...rest})=>rest)(result):result)}];if(images&&Array.isArray(result.images))blocks.push(...result.images);return {content:blocks};}
    catch(e){const code=/^[A-Z0-9_]+$/.test(e.message)?e.message:'LOCAL_ERROR_CHECK_INSTALL';return {isError:true,content:[{type:'text',text:JSON.stringify({error:code,hint:'不要自动重发；先查状态或请机主检查。'})}]};}
  });
}
register('codex_chat_send','经机主授权，把AI助手的一条文本发到固定的 Codex 专用聊天，返回请求状态。之后用 poll 取回答。不得转发其他人的隐私、令牌或未授权聊天内容；禁止无限自动联聊。',z.object({requestId,text:z.string().min(1).max(8000)}).strict(),async input=>(await get()).send(input));
register('codex_chat_poll','读取本插件已发送请求的最终回答；waitMs 最多 20000。pending/running 时继续查同一 ID，不要重复 send。最终图片会作为图片内容块返回。',z.object({requestId,waitMs:z.number().int().min(0).max(20000).default(0)}).strict(),async input=>(await get()).poll(input),{images:true});
register('codex_chat_status','查看专用聊天 ID、开关、熔断和活跃请求，并返回只读本地面板 viewerUrl（链接中的临时查看钥匙不要公开）。不会发送模型消息。',z.object({}).strict(),async()=>(await get()).status());
register('codex_chat_time','返回此刻 Asia/Shanghai 本地时间、UTC 时间和 Unix 毫秒时间戳；只读，不发送模型消息。',z.object({}).strict(),async()=>(await get()).time());
register('codex_chat_cancel','请求停止本插件指定的活跃回合；取消是否完成以 poll 的状态为准。不能操作其他聊天。',z.object({requestId}).strict(),async input=>(await get()).cancel(input));
async function close(){await viewer?.close();await controller?.close();await server.close();}
process.once('SIGTERM',()=>void close().then(()=>process.exit(0)));
process.once('SIGINT',()=>void close().then(()=>process.exit(0)));
process.stdin.once('end',()=>void close().then(()=>process.exit(0)));
await server.connect(new StdioServerTransport());
