// Persistent reservations cover every physical transport, not HTTP request batches.
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
    initialize({conversations=[],now=Date.now()}={}) {
      const s=load();let imported=0;
      for(const item of conversations)if(validKey(item.key)&&!s.conversations[item.key]){
        const e=entry(s,item.key);e.receipts=(item.sendTimes||[]).filter(t=>typeof t==='number'&&Number.isFinite(t)&&now-t<3600000).map((at,i)=>({at,deliveryId:'import:'+i}));imported++;
      }
      if(imported)save(s);return {ok:true,imported};
    },
    preview({key,now=Date.now()}={}) {
      const e=load().conversations[key]||{receipts:[],reservations:{},turns:{},nextAt:0},c=counts(e,now),p=policy();
      return {...c,successful:e.receipts.length,inflight:Object.keys(e.reservations).length,allowed:(!p.maxSendPerMinute||c.minute<p.maxSendPerMinute)&&(!p.maxSendPerHour||c.hour<p.maxSendPerHour),nextAt:e.nextAt};
    },
    remaining({key,plan}={}) {
      if(!plan)return 0;const s=load();
      const pending=Object.values(s.conversations).flatMap(e=>Object.values(e.reservations||{})).filter(r=>r.turnId===plan.turnId).length;
      return plan.agent?Math.max(0,plan.maxMessages-(s.turns[plan.turnId]||0)-pending):Number.MAX_SAFE_INTEGER;
    },
    delay({plan,requested,random=Math.random}={}) {
      const d=plan.delayPlan;
      if(Number.isFinite(requested))return Math.max(d.min,Math.min(Math.max(d.max,d.longProbability>0?d.longMax:0),requested));
      const long=random()<d.longProbability,min=long?d.longMin:d.min,max=long?d.longMax:d.max;
      return Math.round(min+random()*(max-min));
    },
    reserve({key,plan,operationId,now=Date.now(),requestedDelay,kind}={}) {
      if(!validKey(key)||!operationId||!plan)return {ok:false,reason:'invalid_plan'};
      if(plan.agent&&!plan.turnId)return {ok:false,reason:'turn_required'};
      const s=load(),e=entry(s,key),c=counts(e,now);
      if(e.reservations[operationId]||e.receipts.some(r=>r.operationId===operationId))return {ok:false,reason:'duplicate_attempt'};
      if(plan.maxSendPerMinute>0&&c.minute>=plan.maxSendPerMinute)return {ok:false,reason:'minute_limit'};
      if(plan.maxSendPerHour>0&&c.hour>=plan.maxSendPerHour)return {ok:false,reason:'hour_limit'};
      if(this.remaining({key,plan})<=0)return {ok:false,reason:'turn_limit'};
      const at=Math.max(now,e.nextAt||0),delay=this.delay({plan,requested:requestedDelay});
      e.reservations[operationId]={at:now,scheduledAt:at,turnId:plan.agent?plan.turnId:null,kind,delay};e.nextAt=at+delay;
      save(s);return {ok:true,waitMs:Math.max(0,at-now),operationId};
    },
    commit({key,operationId,sentAt=Date.now(),deliveryId}={}) {
      const s=load(),e=s.conversations[key],r=e?.reservations?.[operationId];
      if(!r)return {ok:false,reason:'reservation_missing'};
      delete e.reservations[operationId];
      e.receipts.push({at:sentAt,deliveryId,operationId});
      if(r.turnId)s.turns[r.turnId]=(s.turns[r.turnId]||0)+1;
      e.nextAt=Math.max(e.nextAt||0,sentAt+(r.delay||0));
      save(s);return {ok:true};
    },
    release({key,operationId,knownFailed}={}) {
      if(knownFailed!==true)return {ok:false,reason:'uncertain_delivery'};
      const s=load(),e=s.conversations[key];if(!e?.reservations?.[operationId])return {ok:false,reason:'reservation_missing'};
      delete e.reservations[operationId];save(s);return {ok:true};
    }
  };
}
