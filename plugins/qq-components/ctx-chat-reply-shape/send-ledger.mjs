// Persistent reservations cover every physical transport, not HTTP request batches.
import {createHash} from 'node:crypto';
const grantsURL=new URL('./scheduled-grants.mjs',import.meta.url);grantsURL.search=new URL(import.meta.url).search;
const {scheduledSources,availableScheduled,overflowAvailable}=await import(grantsURL.href);
export function createSendLedger(ctx,policy) {
  const validKey=k=>/^(private|group):\d+$/.test(String(k));
  const load=()=>({conversations:{},turns:{},...(ctx.state.get().sendLedger||{})});
  const save=s=>ctx.state.set({sendLedger:s});
  const entry=(s,key)=>s.conversations[key]||={receipts:[],reservations:{},turns:{},initialized:true,nextAt:0};
  const counts=(e,now)=>{
    const times=[...e.receipts.map(r=>r.at),...Object.values(e.reservations).map(r=>r.at)];
    return {minute:times.filter(t=>now-t<60000).length,hour:times.filter(t=>now-t<3600000).length};
  };
  return {
    policy,
    scheduledGrant(payload={}){
      const now=payload.now??Date.now(),sources=scheduledSources({...payload,now});
      if(!validKey(payload.key)||!sources.length)return null;
      const s=load();s.scheduled||={};let changed=false;
      for(const source of sources)if(!s.scheduled[source.id]){s.scheduled[source.id]={key:payload.key,expiresAt:source.expiresAt};changed=true;}
      for(const [id,g]of Object.entries(s.scheduled))if(now-g.expiresAt>86400000){delete s.scheduled[id];changed=true;}
      if(changed)save(s);
      return Object.freeze({key:payload.key,ids:Object.freeze(sources.map(x=>x.id))});
    },
    initialize({conversations=[],now=Date.now()}={}) {
      const s=load();let imported=0;
      for(const item of conversations)if(validKey(item.key)&&!s.conversations[item.key]){
        const e=entry(s,item.key);e.receipts=(item.sendTimes||[]).filter(t=>typeof t==='number'&&Number.isFinite(t)&&now-t<3600000).map((at,i)=>({at,deliveryId:'import:'+i}));imported++;
      }
      if(imported)save(s);return {ok:true,imported};
    },
    preview({key,now=Date.now(),scheduled}={}) {
      const grant=scheduled?this.scheduledGrant({...scheduled,key,now}):null;
      const e=load().conversations[key]||{receipts:[],reservations:{},turns:{},nextAt:0},c=counts(e,now),p=policy();
      const ordinary=(!p.maxSendPerMinute||c.minute<p.maxSendPerMinute)&&(!p.maxSendPerHour||c.hour<p.maxSendPerHour);
      const burstAllowed=!ordinary&&!!availableScheduled(load(),grant,key,now)&&overflowAvailable(e,now);
      return {...c,successful:e.receipts.length,inflight:Object.keys(e.reservations).length,allowed:ordinary||burstAllowed,burstAllowed,nextAt:e.nextAt};
    },
    remaining({key,plan}={}) {
      if(!plan)return 0;const s=load();
      const pending=Object.values(s.conversations).flatMap(e=>Object.values(e.reservations||{})).filter(r=>r.turnId===plan.turnId).length;
      return plan.agent?Math.max(0,plan.maxMessages-(s.turns[plan.turnId]||0)-pending):Number.MAX_SAFE_INTEGER;
    },
    progress({plan}={}) {
      if(!plan?.agent||!plan.turnId)return null;
      const s=load(),successful=s.turns[plan.turnId]||0;
      const inflight=Object.values(s.conversations).flatMap(e=>Object.values(e.reservations||{})).filter(r=>r.turnId===plan.turnId).length;
      return {successful,inflight,remaining:Math.max(0,plan.maxMessages-successful-inflight)};
    },
    delay({plan,requested,random=Math.random}={}) {
      const d=plan.delayPlan;
      if(Number.isFinite(requested))return Math.max(d.min,Math.min(Math.max(d.max,d.longProbability>0?d.longMax:0),requested));
      const long=random()<d.longProbability,min=long?d.longMin:d.min,max=long?d.longMax:d.max;
      return Math.round(min+random()*(max-min));
    },
    reserve({key,plan,operationId,now=Date.now(),requestedDelay,kind,text='',inputSeq,deduplicate=true}={}) {
      if(!validKey(key)||!operationId||!plan)return {ok:false,reason:'invalid_plan'};
      if(plan.agent&&!plan.turnId)return {ok:false,reason:'turn_required'};
      const s=load(),e=entry(s,key),c=counts(e,now);
      const activeScheduledId=availableScheduled(s,plan.scheduledGrant,key,now);
      const scheduledId=activeScheduledId||availableScheduled(s,plan.scheduledGrant,key,now,true);
      if(plan.scheduledGrant&&!scheduledId)return {ok:false,reason:'scheduled_grant_spent_or_expired'};
      const progress=this.progress({plan});
      const scheduledTurnExtra=!!scheduledId&&plan.agent&&progress.successful+progress.inflight>=plan.baseMaxMessages;
      if(scheduledTurnExtra&&!activeScheduledId)return {ok:false,reason:'scheduled_grant_expired'};
      const textKey=deduplicate&&plan.agent&&kind==='text'&&Number.isSafeInteger(inputSeq)&&inputSeq>0&&String(text).trim()?createHash('sha256').update(inputSeq+'\n'+String(text).replace(/\s+/g,' ').trim()).digest('hex'):null;
      if(textKey&&[...e.receipts,...Object.values(e.reservations)].some(r=>r.textKey===textKey))return {ok:false,reason:'duplicate_delivery',hint:'这批来信已发送或正在发送相同内容。核对真实发送与回执，不要因回执报错再次发送；等待新来信。'};
      if(e.reservations[operationId]||e.receipts.some(r=>r.operationId===operationId))return {ok:false,reason:'duplicate_attempt'};
      let rateAt=now;
      const overMinute=plan.maxSendPerMinute>0&&c.minute>=plan.maxSendPerMinute,overHour=plan.maxSendPerHour>0&&c.hour>=plan.maxSendPerHour;
      const scheduledOverflow=!!activeScheduledId&&(overMinute||overHour)&&overflowAvailable(e,now);
      if(overMinute&&!scheduledOverflow){if(plan.budgetStage!=='weak')return {ok:false,reason:'minute_limit'};const times=[...e.receipts.map(r=>r.at),...Object.values(e.reservations).map(r=>r.at)].filter(t=>now-t<60000).sort((a,b)=>a-b);rateAt=times[times.length-plan.maxSendPerMinute]+60001;}
      if(overHour&&!scheduledOverflow)return {ok:false,reason:'hour_limit'};
      if(this.remaining({key,plan})<=0)return {ok:false,reason:'turn_limit'};
      const at=Math.max(rateAt,e.nextAt||0),delay=this.delay({plan,requested:requestedDelay});
      if(scheduledId)s.scheduled[scheduledId].operationId=operationId;
      e.reservations[operationId]={at:now,scheduledAt:at,turnId:plan.agent?plan.turnId:null,kind,delay,textKey,scheduledId,scheduledOverflow,scheduledTurnExtra};e.nextAt=at+delay;
      save(s);return {ok:true,waitMs:Math.max(0,at-now),operationId};
    },
    authorize({key,operationId,now=Date.now()}={}){
      const s=load(),r=s.conversations[key]?.reservations?.[operationId];
      if(!r)return {ok:false,reason:'reservation_missing'};
      if((r.scheduledOverflow||r.scheduledTurnExtra)&&!(now<s.scheduled?.[r.scheduledId]?.expiresAt))return {ok:false,reason:'scheduled_grant_expired'};
      return {ok:true};
    },
    commit({key,operationId,sentAt=Date.now(),deliveryId}={}) {
      const s=load(),e=s.conversations[key],r=e?.reservations?.[operationId];
      if(!r)return {ok:false,reason:'reservation_missing'};
      delete e.reservations[operationId];
      e.receipts.push({at:sentAt,deliveryId,operationId,...(r.textKey?{textKey:r.textKey}:{}),...(r.scheduledOverflow?{scheduledOverflow:true}:{})});
      if(r.turnId)s.turns[r.turnId]=(s.turns[r.turnId]||0)+1;
      e.nextAt=Math.max(e.nextAt||0,sentAt+(r.delay||0));
      save(s);return {ok:true};
    },
    release({key,operationId,knownFailed}={}) {
      if(knownFailed!==true)return {ok:false,reason:'uncertain_delivery'};
      const s=load(),e=s.conversations[key];if(!e?.reservations?.[operationId])return {ok:false,reason:'reservation_missing'};
      const id=e.reservations[operationId].scheduledId;
      if(id&&s.scheduled?.[id]?.operationId===operationId)delete s.scheduled[id].operationId;
      delete e.reservations[operationId];save(s);return {ok:true};
    }
  };
}
