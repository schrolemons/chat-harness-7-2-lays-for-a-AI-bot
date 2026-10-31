import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const fail=(code)=>{ throw Error(code); };
const hash=text=>createHash('sha256').update(text).digest('hex');
const live=s=>['pending','running','uncertain'].includes(s);
export function currentTime(now=Date.now(),timeZone='Asia/Shanghai') {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return {timeZone,local:`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} +08:00`,utc:new Date(now).toISOString(),epochMs:now};
}
// pid 存活检测：ESRCH 才算确定已退出；EPERM 等无法确认的情况按“仍存活”处理（fail closed）。
function processAlive(pid) {
  if(!Number.isSafeInteger(pid)||pid<1)return false;
  try { process.kill(pid,0); return true; }
  catch(error) { return error.code!=='ESRCH'; }
}
export function finalText(turn) {
  const messages=(turn.items||[]).filter(i=>i.type==='agentMessage');
  const final=messages.filter(i=>i.phase==='final_answer');
  return (final.length?final:messages.filter(i=>i.phase!=='commentary')).map(i=>i.text||'').join('\n\n').slice(0,64000);
}
export function finalResult(turn) {
  const text=finalText(turn);
  const images=[];
  for(const item of turn.items||[]) {
    if(!['imageGeneration','image_generation'].includes(item.type)||typeof item.result!=='string'||images.length>=3)continue;
    const data=item.result.replace(/^data:image\/(?:png|jpeg|webp);base64,/i,'');
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length>24*1024*1024*4/3)continue;
    const bytes=Buffer.from(data,'base64');
    let mimeType='image/png';
    if(bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])))mimeType='image/jpeg';
    else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')mimeType='image/webp';
    else if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))continue;
    images.push({type:'image',data,mimeType});
  }
  return {text,images};
}
export class Controller {
  constructor({dir,client,enabled=()=>true,now=Date.now,minGapMs=15000,hourLimit=20,dayLimit=60,turnTimeoutMs=300000}) {
    Object.assign(this,{dir,client,enabled,now,minGapMs,hourLimit,dayLimit,turnTimeoutMs});
    this.replies=new Map(); this.closed=false;
    fs.mkdirSync(dir,{recursive:true,mode:0o700}); this.lock=path.join(dir,'owner.lock');
    this.fd=this.acquireLock();
    fs.writeFileSync(this.fd,String(process.pid));
    this.file=path.join(dir,'state.json');
    try {this.state=JSON.parse(fs.readFileSync(this.file,'utf8'));}
    catch(e) {if(e.code!=='ENOENT'){fs.closeSync(this.fd);fs.unlinkSync(this.lock);throw Error('STATE_INVALID');} this.state={version:1,threadId:null,jobs:[],circuitOpen:false};}
    if(!this.state||this.state.version!==1||!Array.isArray(this.state.jobs)) {fs.closeSync(this.fd);fs.unlinkSync(this.lock);this.fd=undefined;this.closed=true;fail('STATE_INVALID');}
    this.onTurn=turn=>this.finish(turn);
    this.onFatal=()=>{ if(this.closed)return; this.state.circuitOpen=true; for(const j of this.state.jobs)if(live(j.status))j.status='uncertain'; this.save(); };
    client.on('turn',this.onTurn); client.on('fatal',this.onFatal);
  }
  save() {
    const temp=this.file+'.tmp'; fs.writeFileSync(temp,JSON.stringify(this.state,null,2),{mode:0o600}); fs.renameSync(temp,this.file);
  }
  // 抢占单写者锁。EEXIST 时先判断是不是已退出进程留下的锁；只有确认死锁才回收。
  acquireLock() {
    try { return fs.openSync(this.lock,'wx',0o600); }
    catch(error) {
      if(error.code!=='EEXIST') throw error;
      this.reclaimDeadLock();
      try { return fs.openSync(this.lock,'wx',0o600); }
      catch(again) { if(again.code==='EEXIST')fail('LOCKED'); throw again; }
    }
  }
  reclaimDeadLock() {
    let raw; try { raw=fs.readFileSync(this.lock,'utf8'); } catch { fail('LOCKED'); }
    const trimmed=String(raw).trim();
    if(/^\d+$/.test(trimmed)&&Number.isSafeInteger(Number(trimmed))&&Number(trimmed)>0) {
      // 进程仍存活，或权限不足无法确认时，绝不回收。
      if(processAlive(Number(trimmed)))fail('LOCKED');
    } else {
      // 空文件/坏内容：可能是崩溃在写入 pid 之前；只回收明显过旧的，避免误删正在初始化的锁。
      let age=0; try { age=Date.now()-fs.statSync(this.lock).mtimeMs; } catch { age=0; }
      if(age<60000)fail('LOCKED');
    }
    // 原子抢占：rename 只允许一个竞争者成功，避免两个启动互相删掉对方刚建的新锁。
    const grave=this.lock+'.stale-'+process.pid+'-'+Math.random().toString(36).slice(2,8);
    try { fs.renameSync(this.lock,grave); } catch { fail('LOCKED'); }
    try { fs.unlinkSync(grave); } catch {}
  }
  // 恢复上次进程中断时留下的 live 请求：
  //   · 没写进 turnId 的，说明回合从未真正开始（文本在落盘后才发网络），标失败且不重发；
  //   · 有 turnId 的，从绑定的 Codex 回合回读终态，避免“必须先用旧 ID poll 一次”才能继续。
  async recoverStale() {
    if(this.recovering)return this.recovering;
    this.recovering=(async()=>{
      try {
        for(const job of this.state.jobs){
          if(this.closed||!live(job.status)||job.requestId===this.runningRequest)continue;
          if(!job.turnId){ job.status='failed'; job.error='INTERRUPTED_BEFORE_ROUND_START'; continue; }
          try { this.finish(await this.client.readTurn(this.state.threadId,job.turnId)); }
          catch {
            if(this.closed)return;
            if(!live(job.status))continue;
            job.status='uncertain'; job.error='RECOVERY_CHECK_CHAT'; this.state.circuitOpen=true;
          }
        }
        if(!this.closed)this.save();
      } finally { this.recovering=null; }
    })();
    return this.recovering;
  }
  guard() {if(this.closed)fail('CLOSED');if(!this.enabled())fail('DISABLED');}
  status() {this.guard();return {enabled:true,threadId:this.state.threadId,circuitOpen:this.state.circuitOpen,activeRequest:this.state.jobs.find(j=>live(j.status))?.requestId??null,requests:this.state.jobs.length,...(this.viewerUrl?{viewerUrl:this.viewerUrl}:{})};}
  view(j) {const result=this.replies.get(j.requestId);return {requestId:j.requestId,threadId:this.state.threadId,turnId:j.turnId??null,status:j.status,...(result?{reply:result.text,imageCount:result.images.length}:{}),...(j.error?{error:j.error}:{})};}
  time() {this.guard();return currentTime(this.now());}
  async send(input) {
    this.guard(); const {requestId,text,...extra}=input||{};
    if(Object.keys(extra).length||typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)||typeof text!=='string'||!text.trim()||text.length>8000||text.includes('\u0000'))fail('INVALID_INPUT');
    const digest=hash(text);const old=this.state.jobs.find(j=>j.requestId===requestId);
    if(old){if(old.hash!==digest)fail('ID_CONFLICT');return this.view(old);}
    if(this.state.jobs.some(j=>live(j.status)&&j.requestId!==this.runningRequest))await this.recoverStale();
    if(this.state.circuitOpen)fail('CIRCUIT_OPEN');
    if(this.state.jobs.some(j=>live(j.status)))fail('BUSY');
    const now=this.now();const jobs=this.state.jobs;
    if(jobs.length>=200)fail('LEDGER_FULL');
    if(jobs.length&&(now-jobs.at(-1).at<this.minGapMs||jobs.filter(j=>now-j.at<3600000).length>=this.hourLimit||jobs.filter(j=>now-j.at<86400000).length>=this.dayLimit))fail('RATE_LIMIT');
    const job={requestId,hash:digest,at:now,status:'pending'};jobs.push(job);this.save();
    // Persist before touching the network: ambiguous failures are never silently retried.
    this.runningRequest=job.requestId;this.task=this.run(job,text); return this.view(job);
  }
  async run(job,text) {
    try {
      if(!this.state.threadId){this.state.threadId=await this.client.startThread();this.save();}
      else await this.client.resumeThread(this.state.threadId);
      this.guard();
      const stamp=currentTime(this.now());
      const turn=await this.client.startTurn(this.state.threadId,`【来自 DeepSeek 助手AI助手；经机主授权的助手间咨询】\n【当前时间 ${stamp.timeZone}：${stamp.local}】\n${text}`,job.requestId);
      job.turnId=turn.id;
      if(job.status==='pending')job.status='running';job.startedAt??=this.now();this.save();
      if(live(job.status)){
        this.armTimeout(job);
      }
    } catch (error) {
      if(this.closed)return;
      if(!live(job.status))return;
      job.status=job.turnId?'uncertain':'failed';job.error=error.message==='DESKTOP_OWNS_CHAT'?'DESKTOP_OWNS_CHAT':'CODEX_ERROR_NO_AUTO_RETRY';
      if(job.error!=='DESKTOP_OWNS_CHAT')this.state.circuitOpen=true;this.save();
    }
  }
  armTimeout(job) {
    clearTimeout(this.timer);this.timerRequestId=job.requestId;
    const remaining=Math.max(0,this.turnTimeoutMs-(this.now()-(job.startedAt??job.at)));
    this.timer=setTimeout(()=>{
      if(this.closed||!live(job.status))return;
      job.status='uncertain';job.error='TURN_TIMEOUT_CHECK_CHAT';this.state.circuitOpen=true;this.save();
      void this.client.interrupt(this.state.threadId,job.turnId).catch(()=>{});
    },remaining);this.timer.unref?.();
  }
  finish(turn) {
    if(this.closed)return;
    const job=this.state.jobs.find(j=>j.turnId===turn.id)||this.state.jobs.find(j=>j.status==='pending');
    if(!job)return;
    if(this.timerRequestId===job.requestId)clearTimeout(this.timer);job.turnId=turn.id;
    const status=turn.status;
    job.status=status==='completed'?'completed':status==='interrupted'?'cancelled':status==='inProgress'?'running':'failed';
    if(job.status==='failed'){
      // 只映射成错误码；Codex 的原始报错正文不写进账本、也不返回给模型。
      const failure=String(turn.error?.message??turn.error??'');
      job.error=/usage limit|quota|rate.?limit/i.test(failure)?'USAGE_LIMIT':'CODEX_TURN_FAILED';
      this.state.circuitOpen=true;
    }
    if(job.status==='completed'){delete job.error;this.replies.set(job.requestId,finalResult(turn));}
    if(job.status==='running')this.armTimeout(job);this.save();
  }
  async poll({requestId,waitMs=0}={}) {
    this.guard();if(!Number.isInteger(waitMs)||waitMs<0||waitMs>20000)fail('INVALID_WAIT');
    const job=this.state.jobs.find(j=>j.requestId===requestId);if(!job)fail('UNKNOWN_REQUEST');
    // 上次进程中断留下的“没开始过”的请求：标失败并释放队列，而不是永远 pending。
    if(live(job.status)&&!job.turnId&&job.requestId!==this.runningRequest)await this.recoverStale();
    if(job.turnId&&!this.replies.has(job.requestId)&&job.requestId!==this.runningRequest){
      try {this.finish(await this.client.readTurn(this.state.threadId,job.turnId));}
      catch {job.error='RECOVERY_CHECK_CHAT';this.state.circuitOpen=true;this.save();}
    }
    if(live(job.status)&&waitMs)await new Promise(resolve=>{const on=()=>{clearTimeout(timer);this.client.off('turn',on);resolve();};const timer=setTimeout(on,waitMs);this.client.on('turn',on);});
    this.guard();return {...this.view(job),...(this.replies.has(job.requestId)?{images:this.replies.get(job.requestId).images}: {})};
  }
  async cancel({requestId}={}) {
    this.guard();const job=this.state.jobs.find(j=>j.requestId===requestId);if(!job)fail('UNKNOWN_REQUEST');
    if(!live(job.status))return this.view(job);
    if(!job.turnId)fail('NOT_STARTED_CHECK_STATUS');
    await this.client.interrupt(this.state.threadId,job.turnId);return {...this.view(job),cancelRequested:true};
  }
  async close() {
    if(this.closed)return;this.closed=true;clearTimeout(this.timer);
    this.client.off('turn',this.onTurn);this.client.off('fatal',this.onFatal);
    await this.client.close();if(this.fd!==undefined){fs.closeSync(this.fd);try{fs.unlinkSync(this.lock);}catch{}}
  }
}
