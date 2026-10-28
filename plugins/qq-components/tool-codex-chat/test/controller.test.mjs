import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Controller } from '../src/controller.mjs';

class Fake extends EventEmitter {
  sends = 0;
  async startThread() { return 'thread-only'; }
  async resumeThread() { return {}; }
  async startTurn(threadId, text) { this.sends++; this.lastText=text; return { id:'turn-'+this.sends }; }
  async interrupt() { this.interrupted=true; }
  async readTurn() { return { id:'turn-1', status:'completed', items:[{ type:'agentMessage', text:'恢复的回答', phase:'final_answer' }] }; }
  async close() {}
}
function setup(t, opts={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-peer-'));
  const client=new Fake(); let time=1000000; let enabled=true;
  const c=new Controller({ dir, client, enabled:()=>enabled, now:()=>time, ...opts });
  t.after(async()=>{ await c.close(); fs.rmSync(dir,{recursive:true,force:true}); });
  return {c,client,dir,tick:()=>{time+=16000;},disable:()=>{enabled=false;}};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('重复 requestId 只发送一次；同 ID 不同文本拒绝',async t=>{
  const {c,client}=setup(t); const a=await c.send({requestId:'request-001',text:'你好'}); await flush();
  assert.equal(a.requestId,'request-001'); assert.equal(client.sends,1);
  assert.equal((await c.send({requestId:'request-001',text:'你好'})).requestId,'request-001');
  await assert.rejects(()=>c.send({requestId:'request-001',text:'不同'}),/ID_CONFLICT/);
  assert.equal(client.sends,1);
});
test('串行、完整最终回复；内部推理不返回',async t=>{
  const {c,client}=setup(t); await c.send({requestId:'request-001',text:'问题'}); await flush();
  await assert.rejects(()=>c.send({requestId:'request-002',text:'第二个'}),/BUSY/);
  client.emit('turn',{id:'turn-1',status:'completed',items:[{type:'reasoning',text:'隐藏'},{type:'agentMessage',phase:'commentary',text:'中间进度'},{type:'agentMessage',phase:'final_answer',text:'最终答案'}]});
  assert.equal((await c.poll({requestId:'request-001'})).reply,'最终答案');
});
test('停用插件后不能发送或读取；不创建聊天',async t=>{
  const {c,client,disable}=setup(t); disable();
  await assert.rejects(()=>c.send({requestId:'request-001',text:'问题'}),/DISABLED/);
  await assert.rejects(()=>c.poll({requestId:'request-001'}),/DISABLED/); assert.equal(client.sends,0);
});
test('拒绝空文本、超长文本、未知参数及路径输入',async t=>{
  const {c}=setup(t);
  for(const input of [{requestId:'request-001',text:''},{requestId:'request-001',text:'x'.repeat(8001)},{requestId:'request-001',text:'hi',threadId:'other'},{requestId:'../evil',text:'hi'}]) await assert.rejects(()=>c.send(input),/INVALID/);
});
test('完成后仍有节流；限制小时调用数',async t=>{
  const {c,client,tick}=setup(t,{hourLimit:1});
  await c.send({requestId:'request-001',text:'问题'}); await flush();
  client.emit('turn',{id:'turn-1',status:'completed',items:[]});
  await assert.rejects(()=>c.send({requestId:'request-002',text:'问题2'}),/RATE_LIMIT/); tick();
  await assert.rejects(()=>c.send({requestId:'request-002',text:'问题2'}),/RATE_LIMIT/);
});
test('认证或限流错误持久熔断，不自动重试',async t=>{
  const {c,client,tick,dir}=setup(t); client.startTurn=async()=>{client.sends++; throw Error('429 quota exceeded');};
  await c.send({requestId:'request-001',text:'问题'}); await flush();
  assert.equal((await c.poll({requestId:'request-001'})).status,'failed'); tick();
  await assert.rejects(()=>c.send({requestId:'request-002',text:'问题'}),/CIRCUIT_OPEN/);
  assert.equal(client.sends,1); assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'state.json'))).circuitOpen);
});
test('取消只作用于绑定回合',async t=>{
  const {c,client}=setup(t); await c.send({requestId:'request-001',text:'问题'}); await flush();
  await c.cancel({requestId:'request-001'}); assert.equal(client.interrupted,true);
});
test('重启后恢复同一请求，不重复发送，也不保存文本',async t=>{
  const {c,client,dir}=setup(t); await c.send({requestId:'request-001',text:'敏感文本示例'}); await flush();
  assert.equal(fs.readFileSync(path.join(dir,'state.json'),'utf8').includes('敏感文本示例'),false);
  await c.close(); const other=new Fake(); const restored=new Controller({dir,client:other}); t.after(()=>restored.close());
  const result=await restored.poll({requestId:'request-001'});
  assert.equal(result.reply,'恢复的回答'); assert.equal(other.sends,0); assert.equal(client.sends,1);
});
test('多个 MCP 进程不能同时拥有一个绑定会话',async t=>{
  const {dir}=setup(t); assert.throws(()=>new Controller({dir,client:new Fake()}),/LOCKED/);
});
test('完成回合后仍能读取重启前的旧回答，不重发模型请求',async t=>{
  const {c,dir}=setup(t);await c.send({requestId:'old-id-001',text:'原问题'});await flush();await c.close();
  const state=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));state.jobs[0].status='completed';state.jobs[0].at=0;fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));
  const other=new Fake();const restored=new Controller({dir,client:other});t.after(()=>restored.close());
  await restored.send({requestId:'new-id-002',text:'新问题'});await flush();
  const result=await restored.poll({requestId:'old-id-001'});assert.equal(result.reply,'恢复的回答');assert.equal(other.sends,1);
});
test('重启后仍在进行的回合恢复剩余超时，不能永久占用队列',async t=>{
 const {c,dir}=setup(t);await c.send({requestId:'request-001',text:'问题'});await flush();await c.close();
 const other=new Fake();other.readTurn=async()=>({id:'turn-1',status:'inProgress',items:[]});
 const restored=new Controller({dir,client:other,now:()=>1000000,turnTimeoutMs:10});t.after(()=>restored.close());
 await restored.poll({requestId:'request-001'});await new Promise(r=>setTimeout(r,25));
 assert.equal(restored.state.jobs[0].status,'uncertain');assert.equal(restored.state.circuitOpen,true);assert.equal(other.interrupted,true);
});
test('已收到最终完成通知时，稍后传输异常不能覆盖确定结果',async t=>{
 const {c,client}=setup(t);client.startTurn=async()=>{client.emit('turn',{id:'turn-1',status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:'已确认答案'}]});throw Error('CODEX_RPC_TIMEOUT');};
 await c.send({requestId:'request-001',text:'问题'});await c.task;
 const result=await c.poll({requestId:'request-001'});assert.equal(result.status,'completed');assert.equal(result.reply,'已确认答案');assert.equal(c.state.circuitOpen,false);
});
test('状态文件无效时同步释放锁，不产生二次异步异常',async t=>{
 const {c,dir}=setup(t);await c.close();
 for(const invalid of [null,{version:2,jobs:[]},{version:1,jobs:null}]){
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(invalid));
  assert.throws(()=>new Controller({dir,client:new Fake()}),/STATE_INVALID/);
  assert.equal(fs.existsSync(path.join(dir,'owner.lock')),false);
 }
});
test('已退出进程留下的 owner.lock 自动回收，不要求机主手工解锁',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-peer-'));const lock=path.join(dir,'owner.lock');
 fs.writeFileSync(lock,'2147483647'); // 超出正常 PID 范围，process.kill 必然 ESRCH
 const c=new Controller({dir,client:new Fake()});
 t.after(async()=>{await c.close();fs.rmSync(dir,{recursive:true,force:true});});
 assert.equal(fs.readFileSync(lock,'utf8'),String(process.pid));
});
test('空锁文件只有明显过旧才回收，避免误删正在初始化的锁',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-peer-'));const lock=path.join(dir,'owner.lock');
 fs.writeFileSync(lock,'');
 assert.throws(()=>new Controller({dir,client:new Fake()}),/LOCKED/);
 const old=new Date(Date.now()-120000);fs.utimesSync(lock,old,old);
 const c=new Controller({dir,client:new Fake()});
 t.after(async()=>{await c.close();fs.rmSync(dir,{recursive:true,force:true});});
 assert.equal(fs.readFileSync(lock,'utf8'),String(process.pid));
});
test('重启后未开始的残留请求标失败，不再永久占用队列',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-peer-'));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({version:1,threadId:'thread-old',jobs:[{requestId:'old-req-0001',hash:'x',at:1000000,status:'pending'}],circuitOpen:false}));
 const client=new Fake();let time=1000000;
 const c=new Controller({dir,client,now:()=>time});
 t.after(async()=>{await c.close();fs.rmSync(dir,{recursive:true,force:true});});
 time+=20000;
 await c.send({requestId:'new-req-0002',text:'新问题'});await flush();
 const old=await c.poll({requestId:'old-req-0001'});
 assert.equal(old.status,'failed');assert.equal(old.error,'INTERRUPTED_BEFORE_ROUND_START');
 assert.equal(client.sends,1);
});
test('重启后已完成的残留回合自动收口，新请求不必先 poll 旧 ID',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-peer-'));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({version:1,threadId:'thread-old',jobs:[{requestId:'old-req-0001',hash:'y',at:1000000,status:'running',turnId:'turn-old'}],circuitOpen:false}));
 const client=new Fake();
 client.readTurn=async()=>({id:'turn-old',status:'completed',items:[{type:'agentMessage',text:'旧回答',phase:'final_answer'}]});
 let time=1000000;const c=new Controller({dir,client,now:()=>time});
 t.after(async()=>{await c.close();fs.rmSync(dir,{recursive:true,force:true});});
 time+=20000;
 await c.send({requestId:'new-req-0002',text:'新问题'});await flush();
 assert.equal(client.sends,1);
 const old=await c.poll({requestId:'old-req-0001'});
 assert.equal(old.status,'completed');assert.equal(old.reply,'旧回答');
});
test('Codex 用量上限失败映射为 USAGE_LIMIT 并熔断，不自动重试',async t=>{
 const {c,client}=setup(t);
 await c.send({requestId:'request-001',text:'问题'});await flush();
 client.emit('turn',{id:'turn-1',status:'failed',error:{message:"You've hit your usage limit. Try again at 3:22 PM."}});
 const result=await c.poll({requestId:'request-001'});
 assert.equal(result.status,'failed');assert.equal(result.error,'USAGE_LIMIT');
 assert.equal(c.state.circuitOpen,true);
 await assert.rejects(()=>c.send({requestId:'request-002',text:'再来一次'}),/CIRCUIT_OPEN/);
 assert.equal(client.sends,1);
});
