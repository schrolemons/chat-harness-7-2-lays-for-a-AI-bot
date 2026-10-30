// Transport capabilities only. Admission thresholds and recovery policy belong to O.
export function createSessionRecoveryCapability(caps){
 const recovering=new Set();
 return {isRecovering:key=>recovering.has(key),async recover(request){
  const {key,sessionId,signal}=request;
  if(!/^group:[1-9]\d*$/.test(String(key))||!sessionId||signal?.aborted||recovering.has(key))return {ok:false,skipped:true};
  recovering.add(key);
  try{
   const snapshot=await caps.inspect(request);
   if(signal?.aborted||snapshot?.sessionId!==sessionId||caps.confirm({...request,snapshot})!==true)return {ok:false,skipped:true};
   await caps.stop(sessionId);
   signal?.throwIfAborted();
   await caps.archive(sessionId);
   signal?.throwIfAborted();
   caps.detach(key,sessionId);
   const next=await caps.create(key);
   if(!next)throw Error('No replacement session');
   signal?.throwIfAborted();
   caps.resume(key);
   return {ok:true,sessionId:next};
  }catch{return {ok:false,error:'会话停止、归档或重建未能确认完成'};}
  finally{recovering.delete(key);}
 }};
}
export function sessionRecoveryObservation(event,meta){
 if(!['turn/start','turn/end','assistant/message','tool/call','tool/result'].includes(event?.type))return null;
 const progress=event.type==='tool/call'||event.type==='tool/result'||event.type==='assistant/message'&&(event.data?.message?.content||[]).some(b=>b.type==='tool-call'||typeof b.text==='string'&&b.text.trim());
 const reason=event.type==='turn/end'?event.data?.reason:null;
 return {...meta,type:event.type,seq:event.seq,turn:event.data?.turn,progress:!!progress,
  ...(reason?.kind==='error'?{failure:{code:reason.error?.code,status:reason.error?.status,message:reason.error?.message}}:{})};
}
