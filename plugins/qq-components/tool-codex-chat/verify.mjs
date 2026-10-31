// Local-only verifier. Does not send anything unless --live is explicit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PLUGIN, ROOT } from './src/runtime.mjs';
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(PLUGIN,'src','mcp-server.mjs')],stderr:'pipe'});
const client=new Client({name:'codex-peer-verifier',version:'0.1.0'});
const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});const v=JSON.parse(r.content[0].text);if(r.isError)throw Error(JSON.stringify(v));return v;};
try{
 await client.connect(transport);
 const tools=await client.listTools();assert.equal(tools.tools.length,4);console.log('MCP tools: '+tools.tools.map(t=>t.name).join(', '));
 console.log('Status: '+JSON.stringify(await call('codex_chat_status',{})));
 if(process.argv.includes('--live')){
  const requestId='live-'+Date.now();
  console.log('Send: '+JSON.stringify(await call('codex_chat_send',{requestId,text:'这是机主授权的通用助手通信插件验收，请只回复：通用助手，通信成功。记住本轮口令是「示例口令」。'})));
  let result;
  for(let i=0;i<12;i++){result=await call('codex_chat_poll',{requestId,waitMs:20000});console.log('Poll: '+JSON.stringify(result));if(!['pending','running'].includes(result.status))break;}
  assert.equal(result.status,'completed');assert.match(result.reply,/通信成功/);
  fs.writeFileSync(path.join(PLUGIN,'docs','live-result.json'),JSON.stringify({verifiedAt:new Date().toISOString(),first:result},null,2));
 }
 if(process.argv.includes('--context')){
  const first=JSON.parse(fs.readFileSync(path.join(PLUGIN,'docs','live-result.json'),'utf8'));
  const requestId='context-'+Date.now();await call('codex_chat_send',{requestId,text:'仅用于验收多轮上下文：上一轮机主让你记住的口令是什么？只回答口令。'});
  let result;for(let i=0;i<12;i++){result=await call('codex_chat_poll',{requestId,waitMs:20000});console.log('Poll: '+JSON.stringify(result));if(!['pending','running'].includes(result.status))break;}
  assert.equal(result.status,'completed');assert.match(result.reply,/示例口令/);assert.equal(result.threadId,first.first.threadId);
  first.second=result;fs.writeFileSync(path.join(PLUGIN,'docs','live-result.json'),JSON.stringify(first,null,2));
 }
 if(process.argv.includes('--recover')){
  const proof=JSON.parse(fs.readFileSync(path.join(PLUGIN,'docs','live-result.json'),'utf8'));
  const result=await call('codex_chat_poll',{requestId:proof.first.requestId});assert.equal(result.reply,'通用助手，通信成功。');console.log('Recovered without resend: '+JSON.stringify(result));
 }
 if(process.argv.includes('--desktop-live')){
  const requestId='desktop-'+Date.now();await call('codex_chat_send',{requestId,text:'机主已在桌面端打开这个专用聊天。这是最后一次验收：请只回复「通用助手，桌面显示与工具通信均正常。」不要调用任何工具。'});
  let result;for(let i=0;i<12;i++){result=await call('codex_chat_poll',{requestId,waitMs:20000});console.log('Poll: '+JSON.stringify(result));if(!['pending','running'].includes(result.status))break;}
  assert.equal(result.status,'completed');assert.match(result.reply,/均正常/);
 }
 if(process.argv.includes('--reload-host')){
  const token=fs.readFileSync(path.join(ROOT,'state','console-token'),'utf8').trim();
  // 控制台端口以 config.json 为准，不写死（3100 只是兜底）。
  const port=Number(JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8')).consolePort)||3100;
  const r=await fetch('http://127.0.0.1:'+port+'/api/plugins/reload',{method:'POST',headers:{'x-console-token':token,'content-type':'application/json'},body:'{}'});assert.equal(r.status,200);
  const data=await r.json();const plugin=data.plugins.find(p=>p.id==='tool-codex-chat');assert.ok(plugin?.enabled);assert.equal(plugin.layer,'T');console.log('T layer loaded: '+plugin.name);
 }
}finally{await client.close();}
