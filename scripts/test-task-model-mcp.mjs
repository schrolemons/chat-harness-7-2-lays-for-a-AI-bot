import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {isAdminPluginTool,isAdminToolName} from '../src/tools/admin-policy.js';
test('MCP tools/list exposes task range lookup and both model-selection schemas; calls preserve the tuple',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qq-task-model-mcp-')),root=process.cwd(),requests=[];
 fs.cpSync(path.join(root,'src'),path.join(temp,'src'),{recursive:true});fs.cpSync(path.join(root,'plugins/qq-components/ctx-chat-reply-shape'),path.join(temp,'plugins/qq-components/ctx-chat-reply-shape'),{recursive:true});fs.copyFileSync(path.join(root,'package.json'),path.join(temp,'package.json'));fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'junction');
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push({path:req.url,headers:req.headers,body:JSON.parse(raw||'{}')});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,result:{ok:true,allowed:[]}}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 fs.writeFileSync(path.join(temp,'config.json'),JSON.stringify({consolePort:server.address().port,consoleToken:'fixture-console-only'}));
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(temp,'src/mcp-snowluma-safe.js')],cwd:temp,stderr:'pipe'}),client=new Client({name:'task-model-test',version:'1'});
 try{
  let stderr='';transport.stderr?.on('data',chunk=>{stderr+=chunk;});try{await client.connect(transport);}catch(error){throw Error(error.message+' '+stderr);}const {tools}=await client.listTools();assert(tools.some(t=>t.name==='qq_task_models'));
  for(const name of ['qq_task_spawn','qq_task_input'])assert.deepEqual(tools.find(t=>t.name===name).inputSchema.properties.modelSelection.required,['provider','model','effort']);
  const modelSelection={provider:'magpie-responses',model:'codex/gpt-6.1-sol',effort:'high'};
  for(const [name,args] of [['qq_task_models',{}],['qq_task_spawn',{title:'fixture',task:'fixture',modelSelection}],['qq_task_input',{taskId:'fixture',input:'fixture',requestId:'fixture-input',modelSelection}]]){
   const out=await client.callTool({name,arguments:{token:'fixture-agent',...args}});assert(!out.isError,JSON.stringify(out));const req=requests.at(-1);assert.equal(req.body.tool,name.slice(3));assert.equal(req.headers['x-agent-token'],'fixture-agent');assert.equal(req.headers['x-agent-call'],'1');if(args.modelSelection)assert.deepEqual(req.body.input.modelSelection,modelSelection);
  }
  assert(isAdminPluginTool('task_models'));assert(isAdminToolName('mcp__snowluma__qq_task_models'));
 }finally{await client.close();server.closeAllConnections();await new Promise(r=>server.close(r));if(path.dirname(temp)!==os.tmpdir()||!path.basename(temp).startsWith('qq-task-model-mcp-'))throw Error('Unexpected cleanup path');fs.rmSync(temp,{recursive:true,force:true});}
});
