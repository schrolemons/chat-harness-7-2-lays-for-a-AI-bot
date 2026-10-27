// Local operator recovery only. Not exposed as an MCP tool.
import fs from 'node:fs';
import path from 'node:path';
import { STATE } from './src/runtime.mjs';
const lock=path.join(STATE,'owner.lock');
try{
 if(fs.existsSync(lock)){
  const raw=fs.readFileSync(lock,'utf8').trim();
  const pid=/^\d+$/.test(raw)?Number(raw):0;
  let alive=false;
  if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);alive=true;}catch(e){if(e.code!=='ESRCH')throw e;}}
  if(alive)throw Error('MCP 进程仍在线；先断开 codex-peer 或关闭 DSH，再恢复。');
  if(!process.argv.includes('--unlock-dead'))throw Error('存在已退出进程或损坏的锁；确认没有并发启动后运行 --unlock-dead。');
  fs.unlinkSync(lock);console.log('已清除已退出进程或损坏的锁。');
 }
 const file=path.join(STATE,'state.json');
 if(!fs.existsSync(file)){console.log('尚未创建专用聊天。');process.exit(0);}
 const state=JSON.parse(fs.readFileSync(file,'utf8'));
 if(process.argv.includes('--new-chat')){
  if(!process.argv.includes('--acknowledge-reviewed'))throw Error('先确认旧聊天已结束，再加 --acknowledge-reviewed。');
  fs.renameSync(file,file+'.archive-'+new Date().toISOString().replace(/[:.]/g,'-'));
  fs.writeFileSync(file,JSON.stringify({version:1,threadId:null,jobs:[],circuitOpen:false},null,2),{mode:0o600});
  console.log('旧请求账本已归档；下一次发送创建新专用聊天。Codex 原聊天记录仍保留。');process.exit(0);
 }
 if(process.argv.includes('--clear-circuit')){
  if(!process.argv.includes('--acknowledge-reviewed'))throw Error('请先在 Codex 中确认回合已结束、认证和限流问题已解决，再加 --acknowledge-reviewed。');
  for(const job of state.jobs)if(['pending','running','uncertain'].includes(job.status)){job.status='abandoned';job.error='OWNER_REVIEWED_NO_REPLAY';}
  state.circuitOpen=false;const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(temp,file);
 }
 console.log(JSON.stringify({threadId:state.threadId,circuitOpen:state.circuitOpen,requests:state.jobs.length,active:state.jobs.filter(j=>['pending','running','uncertain'].includes(j.status)).map(j=>({requestId:j.requestId,status:j.status}))},null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
