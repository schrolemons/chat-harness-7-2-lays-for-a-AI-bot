// Physical reservations retain receipts and dedupe; grounded chat groups share one rate credit.
import {createHash} from 'node:crypto';
const grantsURL=new URL('./scheduled-grants.mjs',import.meta.url);grantsURL.search=new URL(import.meta.url).search;
const {scheduledSources,availableScheduled,overflowAvailable}=await import(grantsURL.href);
export function createSendLedger(ctx,policy) {
  const validKey=k=>/^(private|group):\d+$/.test(String(k));
  const load=()=>({conversations:{},turns:{},...structuredClone(ctx.state.get().sendLedger||{})});
  const save=s=>ctx.state.set({sendLedger:s});
  const entry=(s,key)=>s.conversations[key]||={receipts:[],reservations:{},turns:{},initialized:true,nextAt:0};
  const deliveries=e=>[...e.receipts,...Object.values(e.reservations)];
  const rateGroup=(plan,content)=>plan?.agent&&!plan.scheduledGrant&&content?.kind==='chat'?content.id:null;
  const rateTimes=e=>{
    const groups=new Map(),times=(e.taskCredits||[]).map(r=>r.at);
    for(const r of deliveries(e)){
      if(r.taskExempt)continue;
      if(r.rateGroupId)groups.set(r.rateGroupId,Math.min(groups.get(r.rateGroupId)??r.at,r.at));
      else times.push(r.at); // Imported and pre-group receipts retain their original charge.
    }
    return times.concat([...groups.values()]);
  };
  const counts=(e,now)=>{
    const times=rateTimes(e);
    return {minute:times.filter(t=>now-t<60000).length,hour:times.filter(t=>now-t<3600000).length};
  };
  const nextRateAt=(times,now,period,limit)=>{
    const active=times.filter(at=>now-at<period).sort((a,b)=>a-b);
    return active[active.length-limit]+period+1;
  };
  return {
    policy,
    canContinueReply({key,plan,contentId=plan?.contentId,budget}={}){
      if(!validKey(key)||plan?.key!==key||!plan.turnId||budget?.stage!=='silent')return false;
      const groupId=rateGroup(plan,this.getContent?.({key,contentId}));
      if(!groupId)return false;
      const admission=load().conversations[key]?.receipts.find(r=>r.rateGroupId===groupId&&r.turnId===plan.turnId&&r.replyBudget)?.replyBudget;
      if(!admission||admission.periodStart!==budget.periodStart||admission.hardLimitYuan!==budget.hardLimitYuan||admission.globalHardLimitYuan!==budget.globalHardLimitYuan)return false;
      if(budget.globalHardLimitYuan>0&&budget.globalCost>=budget.globalHardLimitYuan)return budget.cost+admission.outsideCost>=budget.globalHardLimitYuan;
      return budget.hardLimitYuan>0&&budget.cost>=budget.hardLimitYuan;
    },
    getTaskGroup({key,groupId}={}){return load().conversations[key]?.taskAdmissions?.[groupId]||null;},
    claimTaskGroup({key,groupId,plan,now=Date.now()}={}){
      if(!validKey(key)||!plan||plan.key!==key||typeof groupId!=='string'||!groupId)return {ok:false,reason:'invalid_task_group'};
      const content=this.getContent?.({key,contentId:groupId});
      if(content&&content.kind!=='task')return {ok:false,reason:'invalid_task_group'};
      if(!content&&plan.taskExempt!==true)return {ok:false,reason:'invalid_task_group'};
      groupId=content?.id||groupId;
      const s=load(),e=entry(s,key),existing=e.taskAdmissions?.[groupId];
      if(existing)return {ok:true,admission:existing,reused:true};
      const c=counts(e,now),times=rateTimes(e);
      const minute=plan.maxSendPerMinute>0&&c.minute>=plan.maxSendPerMinute,hour=plan.maxSendPerHour>0&&c.hour>=plan.maxSendPerHour;
      if(minute||hour)return {ok:false,reason:hour?'hour_limit':'minute_limit',nextAt:Math.max(minute?nextRateAt(times,now,60000,plan.maxSendPerMinute):now,hour?nextRateAt(times,now,3600000,plan.maxSendPerHour):now)};
      const admission={key,groupId,at:now,id:'task-credit:'+createHash('sha256').update(JSON.stringify([key,groupId])).digest('hex').slice(0,32)};
      e.taskAdmissions||={};e.taskAdmissions[groupId]=admission;e.taskCredits||=[];e.taskCredits.push(admission);
      if(content&&s.contents?.[content.id])s.contents[content.id].taskGroupAdmission=admission;
      save(s);return {ok:true,admission,reused:false};
    },
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
    preview({key,now=Date.now(),scheduled,plan,taskExempt=false}={}) {
      const grant=scheduled?this.scheduledGrant({...scheduled,key,now}):null;
      const e=load().conversations[key]||{receipts:[],reservations:{},turns:{},nextAt:0},c=counts(e,now),p=plan||policy();
      const ordinary=(!p.maxSendPerMinute||c.minute<p.maxSendPerMinute)&&(!p.maxSendPerHour||c.hour<p.maxSendPerHour);
      const burstAllowed=!ordinary&&!!availableScheduled(load(),grant,key,now)&&overflowAvailable(e,now);
      const admittedTask=plan?.contentId?this.getContent?.({key:plan.sourceKey||plan.key,contentId:plan.contentId})?.taskExempt:!!this.getTaskGroup({key:plan?.sourceKey||plan?.key||key,groupId:plan?.taskGroupId});
      const groupId=rateGroup(plan,plan?.contentId&&this.getContent?.({key:plan.sourceKey||plan.key,contentId:plan.contentId}));
      const admittedReply=!!groupId&&deliveries(e).some(r=>r.rateGroupId===groupId);
      return {...c,successful:e.receipts.length,inflight:Object.keys(e.reservations).length,allowed:admittedTask||admittedReply||ordinary||burstAllowed,burstAllowed,nextAt:e.nextAt,taskCredits:(e.taskCredits||[]).length};
    },
    remaining({key,plan,contentId=plan?.contentId}={}) {
      if(!plan)return 0;
      if(!plan.agent||(!contentId&&plan.taskExempt===true))return Number.MAX_SAFE_INTEGER;
      const progress=this.progress({plan,contentId});
      return progress?.remaining??(contentId?0:Number.MAX_SAFE_INTEGER);
    },
    progress({plan,contentId=plan?.contentId}={}) {
      if(!plan?.agent)return null;
      const content=this.getContent?.({key:plan.sourceKey||plan.key,contentId});
      if(!content)return null;
      const s=load(),successful=s.contentCounts?.[content.id]||0;
      const inflight=Object.values(s.conversations).flatMap(e=>Object.values(e.reservations||{})).filter(r=>r.contentId===content.id).length;
      return {contentId:content.id,seqs:content.seqs,kind:content.kind,maxParts:content.maxParts,successful,inflight,remaining:content.taskExempt?Number.MAX_SAFE_INTEGER:Math.max(0,content.maxParts-successful-inflight),taskExempt:content.taskExempt,taskPending:content.taskPending,taskGroupAdmission:content.taskGroupAdmission};
    },
    delay({plan,requested,random=Math.random}={}) {
      const d=plan.delayPlan;
      if(Number.isFinite(requested))return Math.max(d.min,Math.min(Math.max(d.max,d.longProbability>0?d.longMax:0),requested));
      const long=random()<d.longProbability,min=long?d.longMin:d.min,max=long?d.longMax:d.max;
      return Math.round(min+random()*(max-min));
    },
    reserve({key,plan,contentId=plan?.contentId,operationId,now=Date.now(),requestedDelay,kind,text='',inputSeq,deduplicate=true}={}) {
      if(!validKey(key)||!operationId||!plan)return {ok:false,reason:'invalid_plan'};
      if(plan.agent&&!plan.turnId)return {ok:false,reason:'turn_required'};
      const s=load(),e=entry(s,key),c=counts(e,now);
      const content=contentId?this.getContent?.({key:plan.sourceKey||plan.key,contentId}):null;
      const taskGroupId=content?.kind==='task'?content.id:plan.taskGroupId;
      const taskAdmission=taskGroupId?this.getTaskGroup({key:plan.sourceKey||plan.key,groupId:taskGroupId}):null;
      if(content?.kind==='task'&&!taskAdmission||!content&&plan.taskExempt===true&&!taskAdmission)return {ok:false,reason:'task_group_pending'};
      const taskExempt=content?content.taskExempt===true:!!taskAdmission;
      const activeScheduledId=taskExempt?null:availableScheduled(s,plan.scheduledGrant,key,now);
      const scheduledId=activeScheduledId||(taskExempt?null:availableScheduled(s,plan.scheduledGrant,key,now,true));
      if(!taskExempt&&plan.scheduledGrant&&!scheduledId)return {ok:false,reason:'scheduled_grant_spent_or_expired'};
      if(contentId&&!content)return {ok:false,reason:'content_not_found'};
      if(plan.agent&&!taskExempt&&!scheduledId&&!content)return {ok:false,reason:'content_required'};
      const textScope=content?.id||taskAdmission?.groupId||(Number.isSafeInteger(inputSeq)&&inputSeq>0?'seq:'+inputSeq:null);
      const crossTaskPoke=kind==='poke'&&taskExempt&&key!==plan.sourceKey;
      const dedupeBody=crossTaskPoke?'[poke]':kind==='text'?String(text).replace(/\s+/g,' ').trim():'';
      const textKey=deduplicate&&plan.agent&&textScope&&dedupeBody?createHash('sha256').update(textScope+'\n'+dedupeBody).digest('hex'):null;
      if(textKey&&[...e.receipts,...Object.values(e.reservations)].some(r=>r.textKey===textKey))return {ok:false,reason:'duplicate_delivery',hint:'这批来信已发送或正在发送相同内容。核对真实发送与回执，不要因回执报错再次发送；等待新来信。'};
      if(e.reservations[operationId]||e.receipts.some(r=>r.operationId===operationId))return {ok:false,reason:'duplicate_attempt'};
      const rateGroupId=taskExempt?null:rateGroup(plan,content);
      const needsRate=!taskExempt&&(!rateGroupId||!deliveries(e).some(r=>r.rateGroupId===rateGroupId));
      let rateAt=now;
      const overMinute=needsRate&&plan.maxSendPerMinute>0&&c.minute>=plan.maxSendPerMinute,overHour=needsRate&&plan.maxSendPerHour>0&&c.hour>=plan.maxSendPerHour;
      const scheduledOverflow=!!activeScheduledId&&(overMinute||overHour)&&overflowAvailable(e,now);
      if(!scheduledOverflow&&(overMinute||overHour)){
        const times=rateTimes(e);
        if(overMinute)rateAt=nextRateAt(times,now,60000,plan.maxSendPerMinute);
        const blockedMinute=overMinute&&plan.budgetStage!=='weak';
        if(blockedMinute||overHour)return {ok:false,reason:blockedMinute?'minute_limit':'hour_limit',nextAt:Math.max(rateAt,overHour?nextRateAt(times,now,3600000,plan.maxSendPerHour):now)};
      }
      if(!taskExempt&&content&&this.remaining({key,plan,contentId:content.id})<=0)return {ok:false,reason:'content_limit'};
      const at=taskExempt?now:Math.max(rateAt,e.nextAt||0),delay=taskExempt?0:this.delay({plan,requested:requestedDelay});
      if(scheduledId)s.scheduled[scheduledId].operationId=operationId;
      e.reservations[operationId]={at:now,scheduledAt:at,turnId:plan.agent?plan.turnId:null,contentId:content?.id,rateGroupId,taskExempt,kind,delay,textKey,scheduledId,scheduledOverflow};if(!taskExempt)e.nextAt=at+delay;
      save(s);return {ok:true,waitMs:Math.max(0,at-now),operationId};
    },
    authorize({key,operationId,now=Date.now()}={}){
      const s=load(),r=s.conversations[key]?.reservations?.[operationId];
      if(!r)return {ok:false,reason:'reservation_missing'};
      if((r.scheduledOverflow||r.scheduledTurnExtra)&&!(now<s.scheduled?.[r.scheduledId]?.expiresAt))return {ok:false,reason:'scheduled_grant_expired'};
      return {ok:true};
    },
    commit({key,operationId,sentAt=Date.now(),deliveryId,replyBudget}={}) {
      const s=load(),e=s.conversations[key],r=e?.reservations?.[operationId];
      if(!r)return {ok:false,reason:'reservation_missing'};
      delete e.reservations[operationId];
      const receipt={at:sentAt,deliveryId,operationId,contentId:r.contentId,taskExempt:r.taskExempt,...(r.rateGroupId?{rateGroupId:r.rateGroupId,turnId:r.turnId}:{}),...(r.textKey?{textKey:r.textKey}:{}),...(r.scheduledOverflow?{scheduledOverflow:true}:{})};
      if(r.rateGroupId&&replyBudget&&['normal','weak'].includes(replyBudget.stage)){
        const {periodStart,hardLimitYuan,globalHardLimitYuan,cost,globalCost}=replyBudget;
        receipt.replyBudget={periodStart,hardLimitYuan,globalHardLimitYuan,outsideCost:globalCost-cost};
      }
      e.receipts.push(receipt);
      if(r.contentId){s.contentCounts||={};s.contentCounts[r.contentId]=(s.contentCounts[r.contentId]||0)+1;}
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
