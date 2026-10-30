const policyModule=new URL('./policy.mjs',import.meta.url);
policyModule.search=new URL(import.meta.url).search;
const {observeRecovery,recoveryDecision,recoveryConfig}=await import(policyModule.href);
export function createPlugin(ctx){
 const config=ctx.config||{},busy=new Set();
 const read=()=>ctx.state.get().groups||{};
 const write=(key,value)=>ctx.state.set({groups:{...read(),[key]:value}});
 function reportNote(key,phase,value){
  if(!value?.desktopIssueId)return;
  ctx.callService?.('desktopNotes','reportIssue',{id:value.desktopIssueId,key,phase,firstAt:value.desktopIssueFirstAt,
   summary:phase==='resolved'?'模型链路恢复了有效输出或工具活动；QQ投递仍以发送成功回执为准':phase==='failed'?'群聊会话自动恢复无效，已停止重复重建':value.desktopIssueSummary,
   impact:phase==='resolved'?'原模型请求阻塞已出现恢复进展':'群聊可能只能收到机械回执，无法完成正常模型回复',
   nextStep:phase==='resolved'?'核对真实QQ发送回执；不要将模型输出直接等同于已送达':'检查请求格式、上下文编码、会话日志附加上传；保留旧会话，排除额度与QQ禁言'});
 }
 // A crash during replacement has an unknown outcome: never repeat it blindly.
 for(const[key,value]of Object.entries(read()))if(value.recovering)write(key,{...value,recovering:false,blocked:true,alertPending:true,blockReason:'上次恢复被中断，结果未知，请人工检查'});
 async function alert(key,now){
  const value=read()[key];if(!value?.alertPending||now-Number(value.lastAlertAttemptAt||0)<60000)return;
  reportNote(key,'failed',value);
  write(key,{...value,lastAlertAttemptAt:now});
  try{const sent=await ctx.capabilities.notifyOwner?.('群聊会话自动恢复已停手 '+key+'：'+value.blockReason+'。本地历史保留，请在桥接控制中检查。');if(sent===true)write(key,{...read()[key],alertPending:false,lastAlertAt:now});}
  catch{ctx.log?.('自动恢复告警未能送达，将保留待通知状态');}
 }
 return {
  validateConfig(next){const normalized=recoveryConfig(next),errors=Object.keys(normalized).filter(key=>!Number.isSafeInteger(next[key])||next[key]!==normalized[key]).map(key=>key+' 必须为允许范围内的整数');return {ok:!errors.length,errors};},
  services:{sessionRecovery:{
   observe(event){if(ctx.signal?.aborted||!/^group:[1-9]\d*$/.test(String(event.key||'')))return null;
    if(event.reason!=null)event={...event,chatTurn:/^(bootstrap|private|message|poke|at|question|keyword|nameMention|reply|probability|replyCheck)$/.test(String(event.reason))};
    const previous=read()[event.key],next=observeRecovery(previous,event,config);
    if(event.progress===true&&previous?.desktopIssueId&&!previous.desktopIssueResolved){next.desktopIssueResolved=true;reportNote(event.key,'resolved',next);}
    write(event.key,next);return {failures:next.failures?.length||0,blocked:next.blocked===true};
   },
   confirm({key,sessionId,lastSeq,snapshot}){
    const value=read()[key];
    if(ctx.signal?.aborted||!value?.recovering||value.sessionId!==sessionId||value.lastSeq!==lastSeq||value.interruptedByProgress)return {ok:false};
    return {ok:recoveryDecision({...value,recovering:false,attempts:value.attempts.slice(0,-1)},snapshot,Date.now(),config).recover};
   }
  }},
  hooks:{async onTick({now=Date.now()}={}){
   for(const key of Object.keys(read())){
    if(ctx.signal?.aborted)return;
    await alert(key,now);
    const record=read()[key];
    if(busy.has(key)||!record||record.blocked||record.recovering||!record.failures?.length)continue;
    if(typeof ctx.capabilities.inspectGroupSessionRecovery!=='function'||typeof ctx.capabilities.recoverGroupSession!=='function')continue;
    busy.add(key);
    try{
     const snapshot=await ctx.capabilities.inspectGroupSessionRecovery({key,sessionId:record.sessionId});
     if(ctx.signal?.aborted)return;
     const current=read()[key];if(current.sessionId!==record.sessionId)continue;
     const decision=recoveryDecision(current,snapshot,now,config);if(!decision.recover)continue;
     const attempts=[...(current.attempts||[]).filter(at=>now-at<86400000),now];
     const issue={desktopIssueId:key+':'+record.sessionId+':'+(current.failureStartedAt||current.failures[0].at),desktopIssueFirstAt:current.failureStartedAt||current.failures[0].at,
      desktopIssueResolved:false,desktopIssueSummary:'模型持续请求失败（'+current.failures.at(-1).signature.split(':').slice(0,2).join(' / HTTP ')+')'};
     write(key,{...current,...issue,recovering:true,interruptedByProgress:false,attempts,lastRecoveryAt:now});reportNote(key,'open',{...current,...issue});
     let result;try{result=await ctx.capabilities.recoverGroupSession({key,sessionId:record.sessionId,lastSeq:current.lastSeq,signal:ctx.signal});}catch{result={ok:false,error:'停止或重建会话失败，结果需人工确认'};}
     const latest=read()[key]||current;
     if(result?.ok){write(key,{...latest,sessionId:result.sessionId,lastSeq:null,turn:null,failures:[],recovering:false,awaitingRecovery:true,blocked:false,lastRecoveryReason:decision.reason});ctx.log?.('已恢复单个群聊会话 '+key);}
     else if(result?.skipped){write(key,{...latest,recovering:false,attempts:attempts.slice(0,-1)});}
     else{write(key,{...latest,recovering:false,blocked:true,alertPending:true,blockReason:'停止或重建会话失败，请人工检查'});await alert(key,now);}
    }finally{busy.delete(key);}
   }
  }}
 };
}
