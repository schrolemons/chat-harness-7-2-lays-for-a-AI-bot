// Central clock. Jobs contain callbacks supplied by the host/transport, never protocol clients.
import path from 'node:path';
import {createDeliveryLedger} from './delivery-ledger.mjs';
export function createPlugin(ctx) {
 const runtime=ctx.runtime||(ctx.runtime={});runtime.jobs??=new Map();runtime.serial??=0;
 const jobs=runtime.jobs,max=Math.max(10,Number(ctx.config?.maxJobs)||1000);
 const receipts=ctx.root ? createDeliveryLedger({file:path.join(ctx.root,'state','plugins','delivery-receipts.json')}) : null;
 function cancel(handle){const id=typeof handle==='string'?handle:handle?.scheduledId;const j=jobs.get(id);if(j && (!handle?.generation || j.generation===handle.generation))return jobs.delete(id);return false;}
 const scheduler={
  schedule(spec={}){
   const id=String(spec.id||'');if(!id || !Number.isFinite(Number(spec.at)) || typeof spec.run!=='function')return null;
   if(!jobs.has(id)&&jobs.size>=max)return null;
   const generation=++runtime.serial;const job={...spec,id,at:Number(spec.at),generation,busy:false};jobs.set(id,job);
   return {scheduledId:id,generation,unref(){}};
  },cancel,
  cancelOwner(owner){for(const [id,j]of jobs)if(j.owner===owner)jobs.delete(id);},
  status(){return {pending:jobs.size,types:[...new Set([...jobs.values()].map(j=>j.type||'task'))]};},
  claimDelivery(p){return receipts?.claim(p)||{ok:false,reason:'ledger_unavailable'};},
  finishDelivery(p){return receipts?.finish(p.id,p.sent)||false;},
  deliveryStatus(p){return receipts?.status(p?.id)||{ok:false,reason:'ledger_unavailable'};}
 };
 return {services:{scheduler},hooks:{async onTick({now=Date.now()}={}){
  for(const [id,j]of [...jobs]){
   if(ctx.isActive?.()===false)return;
   if(j.busy||j.at>now)continue;
   if(j.owner && ctx.isPluginEnabled?.(j.owner)===false){jobs.delete(id);continue;}
   const expired=Number.isFinite(j.expiresAt)&&now>j.expiresAt;
   if(j.intervalMs>0){j.at=now+j.intervalMs;if(Number.isFinite(j.maxLateMs))j.expiresAt=j.at+j.maxLateMs;}else jobs.delete(id);
   if(expired){try{j.onExpire?.();}catch(e){ctx.warn?.('任务过期清理失败：'+e.message);}continue;}
   j.busy=true;
   Promise.resolve().then(()=>ctx.isActive?.()===false ? null : j.run({now}))
    .catch(e=>ctx.warn?.('定时任务失败：'+id+' '+e.message)).finally(()=>{j.busy=false;});
  }
 }}};
}
