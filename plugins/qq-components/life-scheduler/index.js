// Central clock. Jobs contain callbacks supplied by the host/transport, never protocol clients.
import path from 'node:path';
import {createDeliveryLedger} from './delivery-ledger.mjs';
export function createPlugin(ctx) {
 const runtime=ctx.runtime||(ctx.runtime={});runtime.jobs??=new Map();runtime.serial??=0;
 runtime.bubbleRefreshPending=true;
 const jobs=runtime.jobs,max=Math.max(10,Number(ctx.config?.maxJobs)||1000);
 const receipts=ctx.root ? createDeliveryLedger({file:path.join(ctx.root,'state','plugins','delivery-receipts.json')}) : null;
 function cancel(handle){const id=typeof handle==='string'?handle:handle?.scheduledId;const j=jobs.get(id);if(j && (!handle?.generation || j.generation===handle.generation))return jobs.delete(id);return false;}
 function transportReady({now=Date.now()}={}){
  if(typeof ctx.capabilities?.getTransportReadiness!=='function')return true;
  let ready=false;
  try{ready=ctx.capabilities.getTransportReadiness()?.ready===true;}catch{}
  if(!ready){runtime.transportReadySince=null;return false;}
  if(!Number.isFinite(runtime.transportReadySince))runtime.transportReadySince=now;
  return now-runtime.transportReadySince>=30000;
 }
 function restoreSchedules(){
  const keys=ctx.capabilities?.listConversationKeys?.()||[];
  if(runtime.bubbleRefreshPending){
   runtime.bubbleRefreshPending=false;
   for(const key of keys)try{ctx.capabilities?.refreshTimeBubble?.({key});}catch(e){runtime.bubbleRefreshPending=true;ctx.warn?.('恢复冒泡计划失败：'+e.message);}
  }
  if(runtime.resumeGreetingPending){
   runtime.resumeGreetingPending=false;
   for(const key of keys)try{ctx.capabilities?.refreshStartupGreeting?.({key});}catch(e){ctx.warn?.('恢复起床问候失败：'+e.message);}
  }
 }
 function dispatch(id,j,now,ready){
  if(ctx.isActive?.()===false||jobs.get(id)!==j||j.busy||j.at>now)return;
  if(j.owner&&ctx.isPluginEnabled?.(j.owner)===false){jobs.delete(id);return;}
  const expired=Number.isFinite(j.expiresAt)&&now>j.expiresAt;
  if(!expired&&j.requiresTransport===true&&!ready)return;
  if(j.intervalMs>0){j.at=now+j.intervalMs;if(Number.isFinite(j.maxLateMs))j.expiresAt=j.at+j.maxLateMs;}else jobs.delete(id);
  if(expired){try{j.onExpire?.();}catch(e){ctx.warn?.('任务过期清理失败：'+e.message);}return;}
  j.busy=true;
  Promise.resolve().then(()=>ctx.isActive?.()===false?null:j.run({now}))
   .catch(e=>ctx.warn?.('定时任务失败：'+id+' '+e.message)).finally(()=>{j.busy=false;});
 }
 const scheduler={
  transportReady,
  wakePolicy({incomingReason='',activeReason=''}={}){
   const incoming=String(incomingReason).split(':')[0],active=String(activeReason).split(':')[0];
   const ordinary=new Set(['proactiveCheck','careCheck','newsShare','idleRescue']);
   const liveMessage=new Set(['private','message','atMention','nameMention','question','reply','poke','anyMessage','speaker','keyword']);
   const casual=new Set(['timeBubble','startupGreeting','proactiveCheck','careCheck','newsShare','idleRescue','privateFollowup']);
   return {preempt:(liveMessage.has(incoming)&&casual.has(active))||(active==='timeBubble'&&(ordinary.has(incoming)||incoming==='reminder')),supersedeBubble:ordinary.has(incoming)||liveMessage.has(incoming),protected:active==='reminder'};
  },
  schedule(spec={}){
   const id=String(spec.id||'');if(!id || !Number.isFinite(Number(spec.at)) || typeof spec.run!=='function')return null;
   if(!jobs.has(id)&&jobs.size>=max)return null;
   const generation=++runtime.serial;const job={...spec,id,at:Number(spec.at),generation,busy:false};jobs.set(id,job);
   // Immediate ingress wakes already passed admission. Keep them in the same
   // scheduler/lease system, but do not add up to one clock tick to each reply.
   if(job.type==='pendingWakeTimer'&&job.at<=Date.now()&&(!Number.isFinite(runtime.lastTickAt)||Date.now()-runtime.lastTickAt<=60000))Promise.resolve().then(()=>dispatch(id,job,Date.now(),transportReady()));
   return {scheduledId:id,generation,unref(){}};
  },cancel,
  cancelOwner(owner){for(const [id,j]of jobs)if(j.owner===owner)jobs.delete(id);},
  status(){return {pending:jobs.size,types:[...new Set([...jobs.values()].map(j=>j.type||'task'))],lastTickAt:runtime.lastTickAt||null,recoveryPending:!!(runtime.bubbleRefreshPending||runtime.resumeGreetingPending)};},
  inspect({id}={}){const j=jobs.get(String(id||''));return j?{id:j.id,owner:j.owner,type:j.type,at:j.at,busy:j.busy,generation:j.generation}:null;},
  claimDelivery(p){return receipts?.claim(p)||{ok:false,reason:'ledger_unavailable'};},
  finishDelivery(p){return receipts?.finish(p.id,p.sent)||false;},
  deliveryStatus(p){return receipts?.status(p?.id)||{ok:false,reason:'ledger_unavailable'};}
 };
 return {services:{scheduler},hooks:{async onTick({now=Date.now()}={}){
  if(Number.isFinite(runtime.lastTickAt)&&now-runtime.lastTickAt>60000){
   runtime.bubbleRefreshPending=true;runtime.resumeGreetingPending=true;runtime.transportReadySince=null;
  }
  if(Number.isFinite(runtime.lastTickAt)&&now<runtime.lastTickAt)runtime.transportReadySince=null;
  runtime.lastTickAt=now;
  const ready=transportReady({now});
  if(ready)restoreSchedules();
  for(const [id,j]of [...jobs]){
   if(ctx.isActive?.()===false)return;
   dispatch(id,j,now,ready);
  }
 }}};
}
