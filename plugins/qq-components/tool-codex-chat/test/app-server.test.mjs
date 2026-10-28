import {test} from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { AppServer, safeOverrides } from '../src/app-server.mjs';
function fakeChildError(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin={on(){},write(){}};child.kill=()=>{child.killed=true;};child.pid=undefined;child.exitCode=null;setImmediate(()=>child.emit('error',Error('EACCES')));return child;}
function fakeChildLive(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin={on(){},write(){}};child.kill=()=>{child.killed=true;};child.pid=12345;child.exitCode=null;child.signalCode=null;return child;}
test('正确关闭继承的 MCP 和插件，不生成带字面引号的新服务器名',()=>{
 const config=safeOverrides({mcp_servers:{node_repl:{command:'node'},obsidian:{}},plugins:{'documents@openai-primary-runtime':{enabled:true}}});
 assert.equal(config['mcp_servers.node_repl.enabled'],false);
 assert.equal(config['plugins.documents@openai-primary-runtime.enabled'],false);
 assert.ok(!Object.keys(config).some(k=>k.includes('"')));
 assert.throws(()=>safeOverrides({mcp_servers:{'unexpected.name':{}}}),/UNSUPPORTED_CONFIG_NAME/);
});
test('只返回最终消息；拒绝所有审批，不执行客户端动作',()=>{
 const client=new AppServer({command:'none',cwd:'.'});const writes=[];client.write=m=>writes.push(m);
 let done;client.on('turn',v=>done=v);
 client.receive(JSON.stringify({id:4,method:'item/commandExecution/requestApproval',params:{}}));
 client.receive(JSON.stringify({id:5,method:'item/tool/call',params:{}}));
 assert.equal(writes[0].result.decision,'decline');assert.equal(writes[1].error.code,-32601);
 client.receive(JSON.stringify({method:'item/completed',params:{turnId:'t1',item:{id:'i1',type:'agentMessage',text:'答案',phase:'final_answer'}}}));
 client.receive(JSON.stringify({method:'turn/completed',params:{turn:{id:'t1',status:'completed',items:[]}}}));
 assert.equal(done.items[0].text,'答案');
});
test('新客户端取消持久回合时，先连接并恢复会话，再发中断',async()=>{
 const client=new AppServer({command:'NOT_EXECUTED',cwd:'.'});const calls=[];
 client.connect=async()=>{calls.push('connect');};client.rpc=async(method)=>{calls.push(method);return {};};
 await client.interrupt('restored-thread','restored-turn');
 assert.deepEqual(calls,['connect','thread/resume','turn/interrupt']);
});
test('connect 失败后清掉传输层，退避后可重试，不缓存 rejected promise',async t=>{
 let spawns=0;const spawnFn=()=>{spawns++;return fakeChildError();};
 const client=new AppServer({command:'none',cwd:'.',spawnFn,rpcTimeoutMs:200,retryBackoffMs:0});
 t.after(()=>client.close());
 await assert.rejects(()=>client.connect(),/CODEX_DISCONNECTED/);
 await assert.rejects(()=>client.connect(),/CODEX_DISCONNECTED/);
 assert.equal(spawns,2);
});
test('连接失败后的退避窗口内不再反复 spawn',async t=>{
 let spawns=0;const client=new AppServer({command:'none',cwd:'.',spawnFn:()=>{spawns++;return fakeChildError();},rpcTimeoutMs:200,retryBackoffMs:60000});
 t.after(()=>client.close());
 await assert.rejects(()=>client.connect(),/CODEX_DISCONNECTED/);
 await assert.rejects(()=>client.connect(),/CODEX_RECONNECT_BACKOFF/);
 assert.equal(spawns,1);
});
test('account/read 超时只记日志，不阻断只读面板连接',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-peer-log-'));
 const client=new AppServer({command:'none',cwd:'.',spawnFn:()=>fakeChildLive(),logFile:path.join(dir,'app-server.log')});
 t.after(async()=>{await client.close();fs.rmSync(dir,{recursive:true,force:true});});
 client.rpc=async method=>{
  if(method==='account/read')throw Error('CODEX_RPC_TIMEOUT');
  if(method==='config/read')return {config:{}};
  return {};
 };
 await client.connect();
 assert.equal(client.retryAfter,0);
 assert.match(fs.readFileSync(path.join(dir,'app-server.log'),'utf8'),/account-check-skipped/);
});
test('线程命名失败不影响线程创建',async()=>{
 const client=new AppServer({command:'none',cwd:'.'});
 client.connect=async()=>{};client.rpc=async(method)=>{if(method==='thread/start')return {thread:{id:'t1'}};throw Error('CODEX_RPC_ERROR');};
 assert.equal(await client.startThread(),'t1');
});
