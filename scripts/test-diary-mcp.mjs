import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {TOOL_CONFIG_FLAGS} from '../src/tools/flags.js';import {isAdminToolName} from '../src/tools/admin-policy.js';

test('diary MCP is available to private/group chat, forwards scoped calls and follows the memory switch',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'whale-diary-mcp-')),requests=[];
 fs.cpSync('src',path.join(temp,'src'),{recursive:true});fs.copyFileSync('package.json',path.join(temp,'package.json'));fs.symlinkSync(path.resolve('node_modules'),path.join(temp,'node_modules'),'junction');
 fs.mkdirSync(path.join(temp,'plugins/qq-components/ctx-chat-reply-shape'),{recursive:true});fs.copyFileSync('plugins/qq-components/ctx-chat-reply-shape/send-rejection.mjs',path.join(temp,'plugins/qq-components/ctx-chat-reply-shape/send-rejection.mjs'));
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push({path:req.url,headers:req.headers,body:raw?JSON.parse(raw):null});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,day:'2026-11-02',text:'TODAY',sent:false}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 async function probe(enabled){
  fs.writeFileSync(path.join(temp,'config.json'),JSON.stringify({consolePort:server.address().port,consoleToken:'fixture-only',socialV2:{tools:{memory:enabled}}}));
  const client=new Client({name:'diary-test',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(temp,'src/mcp-snowluma-safe.js')],cwd:temp,stderr:'pipe'});
  try{await client.connect(transport);const {tools}=await client.listTools();assert.equal(tools.some(t=>t.name==='qq_diary'),enabled);if(!enabled)return;
   assert.equal(TOOL_CONFIG_FLAGS.qq_diary,'memory');assert.equal(isAdminToolName('mcp__snowluma__qq_diary'),false);
   for(const key of ['private:123','group:456']){
    const result=await client.callTool({name:'qq_diary',arguments:{key,token:'scoped-token',action:'read'}});assert(!result.isError);assert.equal(requests.at(-1).path,'/api/socialV2/diary?key='+encodeURIComponent(key));
    const write=await client.callTool({name:'qq_diary',arguments:{key,token:'scoped-token',action:'update',day:'2026-11-02',text:'NEW_DIARY'}});assert(!write.isError);assert.deepEqual(requests.at(-1).body,{key,day:'2026-11-02',text:'NEW_DIARY'});assert.equal(requests.at(-1).headers['x-agent-token'],'scoped-token');assert.equal(requests.at(-1).headers['x-agent-call'],'1');
   }
  }finally{await client.close();}
 }
 try{await probe(true);await probe(false);}finally{server.closeAllConnections?.();await new Promise(r=>server.close(r));assert.equal(path.dirname(temp),os.tmpdir());assert(path.basename(temp).startsWith('whale-diary-mcp-'));fs.rmSync(temp,{recursive:true,force:true});}
});
