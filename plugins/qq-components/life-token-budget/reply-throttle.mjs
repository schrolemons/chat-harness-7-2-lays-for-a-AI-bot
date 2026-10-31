import {randomUUID} from 'node:crypto';
// Budget-specific admission and mechanical-send pacing. No QQ/DSH transport here.
const bounded=(value,fallback,min,max)=>Number.isFinite(value)?Math.max(min,Math.min(max,Math.round(value))):fallback;
export const MECHANICAL_LIMITS=Object.freeze({minIntervalMs:10000,maxPerMinute:4,maxPerHour:30});
export function mechanicalLimits(raw={}){return {minIntervalMs:bounded(raw.minIntervalMs,10000,1000,3600000),maxPerMinute:bounded(raw.maxPerMinute,4,1,60),maxPerHour:bounded(raw.maxPerHour,30,1,1000)};}
export const privateWakeEveryMessages=value=>bounded(value,5,1,100);
export function createReplyThrottle(ctx,{policy,isExempt}){
 const privateEvery=()=>privateWakeEveryMessages(ctx.config?.privateWakeEveryMessages);
 const put=(field,key,value)=>ctx.state.set({[field]:{...(ctx.state.get()[field]||{}),[key]:value}});
 const scheduleGroup=(key,at)=>{
  if(!ctx.scheduler)return;ctx.scheduler.schedule({id:'budget-weak:'+key,owner:'life-token-budget',type:'budget-weak',at,
   run:async({now=Date.now()}={})=>{
    const status=await ctx.capabilities?.budgetWeakStatus?.(key);
    if(!status||status.stage!=='weak'){ctx.scheduler.cancel('budget-weak:'+key);return;}
    if(status.allowed!==true||status.busy){scheduleGroup(key,now+60000);return;}
    if(status.pendingCount>0)await ctx.capabilities?.requestBudgetWake?.(key);
    const next=now+policy(key).weakMinIntervalMin*60000;put('weakGroupDue',key,next);scheduleGroup(key,next);
   }});
 };
 const schedulePrivate=(key,at)=>{
  if(!ctx.scheduler)return;ctx.scheduler.schedule({id:'budget-weak:'+key,owner:'life-token-budget',type:'budget-weak',at,run:async({now=Date.now()}={})=>{
   const status=await ctx.capabilities?.budgetWeakStatus?.(key);
   if(!status||status.stage!=='weak'||!(ctx.state.get().weakIncoming?.[key]?.count>=privateEvery())||!status.pendingCount)return;
   if(status.busy||status.allowed!==true){schedulePrivate(key,now+(status.busy?1000:60000));return;}
   await ctx.capabilities?.requestBudgetWake?.(key);
  }});
 };
 return {
  scheduleGroups(){for(const [key,at] of Object.entries(ctx.state.get().weakGroupDue||{}))scheduleGroup(key,Math.max(Date.now(),at));for(const [key,value] of Object.entries(ctx.state.get().weakIncoming||{}))if(value.count>=privateEvery())schedulePrivate(key,Date.now()+1000);},
  observeIncoming({key,messageId,stage,periodStart=0,at=Date.now()}={}){
   if(!/^(private|group):[1-9]\d*$/.test(String(key)))return {ok:false};
   if(stage!=='weak'||isExempt(key)){const dues={...(ctx.state.get().weakGroupDue||{})};if(dues[key]){delete dues[key];ctx.state.set({weakGroupDue:dues});ctx.scheduler?.cancel('budget-weak:'+key);}if(ctx.state.get().weakIncoming?.[key])put('weakIncoming',key,{periodStart,count:0,seenIds:[]});return {ok:true};}
   if(!key.startsWith('private:')){
    let due=ctx.state.get().weakGroupDue?.[key];if(!Number.isFinite(due)){const last=ctx.state.get().lastWeakDispatch?.[key]||at;due=last+policy(key).weakMinIntervalMin*60000;put('weakGroupDue',key,due);}
    scheduleGroup(key,due);return {ok:true,nextAt:due};
   }
   const saved=ctx.state.get().weakIncoming?.[key],old=saved?.periodStart===periodStart?saved:{periodStart,count:0,seenIds:[]};
   const id=String(messageId||'');if(id&&old.seenIds.includes(id))return {ok:true,duplicate:true,count:old.count};
   const next={periodStart,count:old.count+1,seenIds:[...old.seenIds,id].filter(Boolean).slice(-128),at};put('weakIncoming',key,next);if(next.count>=privateEvery())schedulePrivate(key,at+1000);return {ok:true,count:next.count};
  },
  canDispatch({key,stage,now=Date.now()}={}){
   if(isExempt(key)||stage==='normal')return true;if(stage==='silent')return false;if(stage!=='weak')return true;
   if(String(key).startsWith('private:'))return (ctx.state.get().weakIncoming?.[key]?.count||0)>=privateEvery();
   const due=ctx.state.get().weakGroupDue?.[key];if(Number.isFinite(due)&&now<due)return false;
   const last=Number(ctx.state.get().lastWeakDispatch?.[key])||0;return !last||now-last>=policy(key).weakMinIntervalMin*60000;
  },
  noteDispatch({key,stage,throughSeq,now=Date.now()}={}){
   if(stage!=='weak'||isExempt(key))return;
   put('lastWeakDispatch',key,now);
   if(String(key).startsWith('group:')){const due=now+policy(key).weakMinIntervalMin*60000;put('weakGroupDue',key,due);scheduleGroup(key,due);}
   const old=ctx.state.get().weakIncoming?.[key];if(old)put('weakIncoming',key,{...old,count:Math.max(0,old.count-(ctx.state.get().weakClaims?.[key]?.batchSize||privateEvery()))});
   if(Number.isSafeInteger(throughSeq))put('weakVisibleThrough',key,throughSeq);
  },
  claimWeakBatch({key,now=Date.now()}={}){
   const old=ctx.state.get().weakClaims?.[key];if(old&&old.pid===process.pid&&old.expiresAt>now)return {ok:false,reason:'batch_in_progress'};
   const claim={id:randomUUID(),pid:process.pid,expiresAt:now+600000,batchSize:privateEvery()};put('weakClaims',key,claim);return {ok:true,...claim};
  },
  releaseWeakBatch({key,id}={}){const old=ctx.state.get().weakClaims?.[key];if(old?.id===id)put('weakClaims',key,null);},
  visibleThrough({key}={}){return Number(ctx.state.get().weakVisibleThrough?.[key])||0;},
  reserveMechanical({key,now=Date.now(),physical=false}={}){
   const limits=mechanicalLimits(ctx.config?.mechanicalLimits),field=physical?'mechanicalPhysicalSends':'mechanicalSends',prior=ctx.state.get()[field]?.[key]||[],times=prior.filter(at=>now-at<3600000);
   const last=times.at(-1);let reason='';if(last!==undefined&&now-last<limits.minIntervalMs)reason='interval';else if(times.filter(at=>now-at<60000).length>=limits.maxPerMinute)reason='minute_limit';else if(times.length>=limits.maxPerHour)reason='hour_limit';
   if(reason)return {ok:false,reason};put(field,key,[...times,now]);return {ok:true};
  },
  mechanicalLimits:()=>mechanicalLimits(ctx.config?.mechanicalLimits)
 };
}
