// Real wall-clock transport check. Only a temporary MCP fixture and loopback fake API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOLD_MS=300000, SDK_TIMEOUT_MS=390000;
const AUDIT=path.join(ROOT,'state','audits','bot-issues-2026-11-01');
const RESULT=path.join(AUDIT,'mcp-long-poll-300s-result.json');
const start=performance.now(),startedAt=new Date().toISOString();
const record={status:'running',startedAt,holdMs:HOLD_MS,sdkTimeoutMs:SDK_TIMEOUT_MS,
 sdkSignature:'client.callTool(params, resultSchema?, options?: RequestOptions); options.timeout/maxTotalTimeout (local SDK declarations inspected)',
 isolation:'temporary descendant MCP fixture, fake config/credentials, loopback fake API; no real QQ/model/runtime-state access',requests:0,prematureClose:false};
let fixture,client,api,heartbeat,holdTimer;
let stderrBytes=0;
const expected={ok:true,key:'private:123',timeout:true,arrived:false,endRound:true,canSleepNow:true,messages:[],newMessages:[],marker:'fixture-complete-300-second-result'};
await fs.mkdir(AUDIT,{recursive:true});
await fs.writeFile(RESULT,JSON.stringify(record,null,2)+'\n');
const save=()=>fs.writeFile(RESULT,JSON.stringify(record,null,2)+'\n');

try{
 api=http.createServer(async(req,res)=>{
  try{
   assert.equal(req.method,'POST');assert.equal(req.url,'/api/socialV2/wait');
   let raw='';for await(const chunk of req)raw+=chunk;
   assert.deepEqual(JSON.parse(raw),{key:'private:123',purpose:'messages',timeoutMs:HOLD_MS});
   assert.equal(req.headers['x-agent-token'],'fixture-agent');assert.equal(req.headers['x-console-token'],'fixture_console_token_123');assert.equal(req.headers['x-agent-call'],'1');
   record.requests++;assert.equal(record.requests,1,'long poll must not silently retry');
   const received=performance.now();record.requestReceivedAt=new Date().toISOString();
   res.once('close',()=>{if(!res.writableEnded)record.prematureClose=true;});
   const finishWhenDue=()=>{
    const elapsed=performance.now()-received;
    if(elapsed<HOLD_MS){holdTimer=setTimeout(finishWhenDue,Math.ceil(HOLD_MS-elapsed));return;}
    record.serverHeldMs=Math.round(elapsed);record.respondedAt=new Date().toISOString();
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(expected));
   };
   holdTimer=setTimeout(finishWhenDue,HOLD_MS);
   await save();console.log('FAKE_API_WAIT_STARTED holdMs='+HOLD_MS+' requests=1');
  }catch(error){record.fakeApiError=error.message;res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'fixture validation failed'}));}
 });
 api.requestTimeout=0;api.headersTimeout=0;api.timeout=0;
 await new Promise((resolve,reject)=>{api.once('error',reject);api.listen(0,'127.0.0.1',resolve);});
 fixture=await fs.mkdtemp(path.join(ROOT,'.tmp-mcp-long-poll-300s-'));
 await fs.mkdir(path.join(fixture,'src','tools'),{recursive:true});
 for(const name of ['mcp-snowluma-safe.js','qq-model-view.js','sensitive.js','mcp-bilibili-tools.mjs'])await fs.copyFile(path.join(ROOT,'src',name),path.join(fixture,'src',name));
 await fs.copyFile(path.join(ROOT,'src','tools','flags.js'),path.join(fixture,'src','tools','flags.js'));
 const replyHelpers=path.join(fixture,'plugins','qq-components','ctx-chat-reply-shape');await fs.mkdir(replyHelpers,{recursive:true});
 await fs.copyFile(path.join(ROOT,'plugins','qq-components','ctx-chat-reply-shape','send-rejection.mjs'),path.join(replyHelpers,'send-rejection.mjs'));
 await fs.writeFile(path.join(fixture,'config.json'),JSON.stringify({consolePort:api.address().port,consoleToken:'fixture_console_token_123'}));
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(fixture,'src','mcp-snowluma-safe.js')],cwd:fixture,stderr:'pipe'});
 client=new Client({name:'isolated-wall-clock-long-poll-test',version:'1.0.0'});
 await client.connect(transport);transport.stderr?.on('data',chunk=>{stderrBytes+=chunk.length;});
 const tools=await client.listTools();assert(tools.tools.some(tool=>tool.name==='qq_wait_for_messages'));
 heartbeat=setInterval(()=>console.log('WAIT_PROGRESS elapsedMs='+Math.round(performance.now()-start)+' prematureClose='+record.prematureClose),30000);
 const callStarted=performance.now();
 const result=await client.callTool({name:'qq_wait_for_messages',arguments:{key:'private:123',token:'fixture-agent',timeoutMs:HOLD_MS,purpose:'messages'}},undefined,{timeout:SDK_TIMEOUT_MS,maxTotalTimeout:SDK_TIMEOUT_MS});
 record.callElapsedMs=Math.round(performance.now()-callStarted);
 assert.notEqual(result.isError,true);const content=result.content.filter(part=>part.type==='text');assert.equal(content.length,1);
 const data=JSON.parse(content[0].text);assert.deepEqual(data,expected);assert.equal(record.requests,1);assert.equal(record.prematureClose,false);assert(record.serverHeldMs>=HOLD_MS);assert(record.callElapsedMs>=HOLD_MS);
 record.status='passed';record.result=data;record.resultComplete=true;
}catch(error){record.status='failed';record.error=String(error?.stack||error);process.exitCode=1;}
finally{
 clearInterval(heartbeat);clearTimeout(holdTimer);
 try{if(client)await client.close();}catch(error){record.cleanupError=error.message;process.exitCode=1;record.status='failed';}
 if(api){api.closeAllConnections();await new Promise(resolve=>api.close(resolve));}
 if(fixture){const resolved=path.resolve(fixture);assert.equal(path.dirname(resolved),ROOT);assert(path.basename(resolved).startsWith('.tmp-mcp-long-poll-300s-'));await fs.rm(resolved,{recursive:true,force:true});record.fixtureRemoved=true;}
 record.finishedAt=new Date().toISOString();record.totalElapsedMs=Math.round(performance.now()-start);record.stderrBytes=stderrBytes;await save();
 console.log(JSON.stringify({status:record.status,callElapsedMs:record.callElapsedMs,serverHeldMs:record.serverHeldMs,requests:record.requests,prematureClose:record.prematureClose,resultComplete:record.resultComplete,fixtureRemoved:record.fixtureRemoved,resultFile:RESULT}));
}
