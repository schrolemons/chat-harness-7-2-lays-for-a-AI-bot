import {messageContentComplete} from '../../../src/outbound-context.js';
// Durable admission retry policy. Only core-verified, already awakened task groups enter here.
const TERMINAL=new Set(['accepted','unknown','cancelled']);
const MESSAGE_WAKE=/^(?:message|private|atMention|question|nameMention|keyword|probability|reply|anyMessage|speaker|poke|budgetWeak)(?::|$)/;
const retryAt=(now,value)=>Number.isFinite(value)&&value>now?value:now+60000;
export function createTaskAdmissionQueue(ctx){
 const scheduled=new Set(),running=new Set();
 const read=()=>ctx.state.get().taskAdmissionQueue||{};
 const put=(id,row)=>ctx.state.set({taskAdmissionQueue:{...read(),[id]:row}});
 const jobId=id=>'task-admission:'+id;
 const active=()=>ctx.isActive?.()!==false;
 const snapshot=row=>row?JSON.parse(JSON.stringify(row)):null;
 const schedule=row=>{
  if(!active()||TERMINAL.has(row.status)||scheduled.has(row.groupId))return;
  const id=jobId(row.groupId),handle=ctx.scheduler?.schedule({id,owner:'life-token-budget',type:'task-admission',at:row.nextAt,requiresTransport:true,
   run:async({now=Date.now()}={})=>{scheduled.delete(row.groupId);await attempt(row.groupId,now);}});
  if(handle)scheduled.add(row.groupId);
 };
 const wait=(row,now,reason,nextAt)=>{
  const updated={...row,status:row.creditClaimedAt?'creditClaimed':'waiting',reason:String(reason||'not_ready').slice(0,160),nextAt:retryAt(now,nextAt),updatedAt:now};
  put(row.groupId,updated);schedule(updated);
 };
 async function attempt(groupId,now){
  if(!active()||running.has(groupId))return;
  let row=read()[groupId];if(!row||TERMINAL.has(row.status))return;
  running.add(groupId);
  try{
   const status=await ctx.capabilities?.taskAdmissionStatus?.(snapshot(row));
   if(!active())return;
   row=read()[groupId];if(!row||TERMINAL.has(row.status))return;
   if(status?.terminal===true){put(groupId,{...row,status:'cancelled',reason:String(status.reason||'source_no_longer_pending'),updatedAt:now});return;}
   if(status?.allowed!==true){wait(row,now,status?.reason,status?.nextAt);return;}
   if(!row.creditClaimedAt){
    const credit=await ctx.callService?.('replyPlan','claimTaskGroup',{key:row.key,groupId,plan:status.plan,now});
    if(!active())return;
    if(TERMINAL.has(read()[groupId]?.status))return;
    if(credit?.ok!==true){wait(row,now,credit?.reason||'task_credit_unavailable',credit?.nextAt);return;}
    row={...row,status:'creditClaimed',creditClaimedAt:now,updatedAt:now,reason:''};put(groupId,row);
   }
   if(TERMINAL.has(read()[groupId]?.status))return;
   if(typeof ctx.capabilities?.requestTaskAdmissionWake!=='function'){wait(row,now,'task_dispatch_capability_unavailable');return;}
   // A crash or transport exception after this write cannot cause an automatic replay.
   row={...row,status:'dispatching',dispatchStartedAt:now,updatedAt:now};put(groupId,row);
   try{
    const result=await ctx.capabilities?.requestTaskAdmissionWake?.(snapshot(row));
    if(result?.accepted===true){put(groupId,{...row,status:'accepted',acceptedAt:now,updatedAt:now,reason:''});return;}
    if(result?.notAdmitted===true){wait(row,now,result.reason||'not_admitted',result.nextAt);return;}
    put(groupId,{...row,status:'unknown',reason:'dispatch_result_unknown',updatedAt:now});
   }catch(error){
    if(error?.notAdmitted===true){wait(row,now,error.message,error.nextAt);return;}
    put(groupId,{...row,status:'unknown',reason:String(error?.message||'dispatch_result_unknown').slice(0,160),updatedAt:now});
   }
  }catch(error){
   // Before dispatch starts, read/credit errors have not executed the task.
   row=read()[groupId];if(row&&!TERMINAL.has(row.status)&&row.status!=='dispatching')wait(row,now,error?.message||'admission_check_failed');
  }finally{running.delete(groupId);}
 }
 function restoreTaskAdmissions({now=Date.now()}={}){
  for(const row of Object.values(read())){
   if(!row||typeof row.groupId!=='string')continue;
   if(row.status==='dispatching'&&!running.has(row.groupId)){put(row.groupId,{...row,status:'unknown',reason:'interrupted_dispatch',updatedAt:now});continue;}
   if(!TERMINAL.has(row.status))schedule({...row,nextAt:Math.max(now,Number(row.nextAt)||now)});
  }
 }
 function queueTaskAdmission({key,groupId,sourceSeqs=[],messages=[],originActionId,originAdmission,wakeReason,now=Date.now()}={}){
  if(!/^(?:private|group):[1-9]\d*$/.test(String(key))||typeof groupId!=='string'||!groupId||groupId.length>200||!MESSAGE_WAKE.test(String(wakeReason)))return {ok:false,reason:'invalid_task_admission_source'};
  if(!Array.isArray(sourceSeqs)||!sourceSeqs.length||sourceSeqs.some(n=>!Number.isSafeInteger(n)||n<=0))return {ok:false,reason:'invalid_task_admission_source'};
  const seqs=[...new Set(sourceSeqs)].sort((a,b)=>a-b),old=read()[groupId];
  if(typeof originActionId!=='string'||!originActionId||originActionId.length>200||!Array.isArray(messages)||messages.length!==seqs.length||messages.some(m=>!m||m.isSelf===true||!messageContentComplete(m))||JSON.stringify(messages.map(m=>m.seq).sort((a,b)=>a-b))!==JSON.stringify(seqs))return {ok:false,reason:'invalid_task_admission_snapshot'};
  let frozenMessages;try{frozenMessages=JSON.parse(JSON.stringify(messages));}catch{return {ok:false,reason:'invalid_task_admission_snapshot'};}
  if(old){
   if(old.key!==key||JSON.stringify(old.sourceSeqs)!==JSON.stringify(seqs)||old.wakeReason!==wakeReason||JSON.stringify(old.messages)!==JSON.stringify(frozenMessages))return {ok:false,reason:'task_admission_binding_conflict'};
   if(!TERMINAL.has(old.status))schedule(old);
   return {ok:true,duplicate:true,...snapshot(old)};
  }
  const row={key,groupId,sourceSeqs:seqs,messages:frozenMessages,originActionId,originAdmission:originAdmission?JSON.parse(JSON.stringify(originAdmission)):undefined,wakeReason,status:'waiting',createdAt:now,updatedAt:now,nextAt:now+1000};put(groupId,row);schedule(row);
  return {ok:true,...snapshot(row)};
 }
 function beginTaskAdmissionDispatch(spec={}){
  const existing=read()[spec.groupId];
  if(existing&&(TERMINAL.has(existing.status)||running.has(existing.groupId)))return {ok:false,reason:'task_admission_already_dispatched',status:existing.status};
  const queued=existing?{ok:true,...snapshot(existing)}:queueTaskAdmission(spec);
  if(!queued.ok)return queued;
  const now=spec.now??Date.now(),row={...read()[spec.groupId],status:'dispatching',creditClaimedAt:read()[spec.groupId].creditClaimedAt||now,dispatchStartedAt:now,updatedAt:now};
  ctx.scheduler?.cancel(jobId(row.groupId));scheduled.delete(row.groupId);running.add(row.groupId);put(row.groupId,row);
  return {ok:true,...snapshot(row)};
 }
 function acceptActiveTaskAdmission({key,groupId,now=Date.now()}={}){
  const row=read()[groupId];if(!row||row.key!==key)return {ok:false,reason:'task_admission_not_found'};
  if(row.status==='accepted')return {ok:true,reused:true,...snapshot(row)};
  if(!['waiting','creditClaimed'].includes(row.status))return {ok:false,reason:'task_admission_dispatch_conflict'};
  ctx.scheduler?.cancel(jobId(groupId));scheduled.delete(groupId);
  const accepted={...row,status:'accepted',creditClaimedAt:row.creditClaimedAt||now,acceptedAt:now,updatedAt:now,reason:''};put(groupId,accepted);return {ok:true,...snapshot(accepted)};
 }
 function finishTaskAdmissionDispatch({groupId,outcome,reason='',now=Date.now(),nextAt}={}){
  const row=read()[groupId];if(!row||!running.has(groupId)||!['accepted','notAdmitted','unknown'].includes(outcome))return {ok:false,reason:'task_dispatch_not_running'};
  running.delete(groupId);
  if(outcome==='notAdmitted'){wait(row,now,reason||'not_admitted',nextAt);return {ok:true,...snapshot(read()[groupId])};}
  const next={...row,status:outcome,reason:String(reason).slice(0,160),updatedAt:now,...(outcome==='accepted'?{acceptedAt:now}:{})};put(groupId,next);return {ok:true,...snapshot(next)};
 }
 function taskAdmissionQueueStatus({groupId,key}={}){
  if(groupId)return snapshot(read()[groupId]);
  return Object.values(read()).filter(row=>!key||row.key===key).map(snapshot);
 }
 return {queueTaskAdmission,taskAdmissionQueueStatus,restoreTaskAdmissions,beginTaskAdmissionDispatch,finishTaskAdmissionDispatch,acceptActiveTaskAdmission};
}
