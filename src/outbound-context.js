import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID, createHash } from 'node:crypto';

const messageDigest=m=>createHash('sha256').update(JSON.stringify([String(m?.messageId??''),String(m?.text??m?.plain??'')])).digest('hex');
export const messageContentComplete=m=>m?.truncated!==true&&m?.bodyComplete!==false&&!m?.unresolvedReplyIds?.length
  // The previous store clipped unmarked bodies at exactly 200 UTF-16 units.
  // Such legacy rows require a fresh detail read rather than guessed recovery.
  &&(m?.bodyComplete===true||String(m?.text??m?.plain??'').length!==200);
export function recordAdmittedMessages(envelope,messages=[]){
  if(!envelope)return;
  const records=envelope.admittedMessages||=new Map();
  for(const m of messages)if(Number.isSafeInteger(m?.seq)&&m.seq>0&&!m.isSelf){
    // A clipped window item is visible for bookkeeping, not complete enough to
    // authorize a semantic reply. A subsequent full tool read can promote it.
    if(messageContentComplete(m))records.set(m.seq,messageDigest(m));
    else if(!records.has(m.seq))records.set(m.seq,null);
  }
  while(records.size>2000)records.delete(records.keys().next().value);
}
export function messageAdmitted(envelope,message){
  return !!envelope?.admittedMessages?.get(message?.seq)&&messageContentComplete(message)
    &&envelope.admittedMessages.get(message.seq)===messageDigest(message);
}

// Transport identity only. Policy and durable counters live in component services.
export const outboundScope=new AsyncLocalStorage();
export function createOutboundTransport({callService,contextFacts=()=>({}),contentFacts=()=>({}),guard=()=>()=>{},log=()=>{},clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
  const call=(s,m,p)=>callService(s,m,p);
  const chains=new Map();
  function capture({key,envelope,origin='operator',reason='operator',agent=false,conversationIntent,topicId,scheduledNotifications,contentId}={}) {
    const actionId=envelope?.actionId||randomUUID();
    const mood=envelope?.mood||call('mood','read',{key});
    let plan=envelope?.replyPlan||call('replyPlan','resolve',{key,turnId:agent?'':actionId,agent,incomingText:'',mood,reason,scheduledNotifications});
    if(agent&&contentId){const bound=call('replyPlan','bindContent',{key,sourceKey:envelope?.key||key,plan,contentId,...contentFacts(envelope?.key||key,envelope)});if(bound?.ok)plan=bound.plan;}
    const originReason=envelope?.reason||reason;
    const ordinary=/^(message|reply|private|question|atMention|nameMention|keyword|probability|anyMessage|speaker|poke|bootstrap)(:|$)/.test(originReason);
    if(origin==='conversation'&&!ordinary&&!['proactiveCheck','timeBubble','startupGreeting','privateFollowup','milkStock'].includes(originReason))origin='purpose';
    return Object.freeze({key,sourceKey:envelope?.key||key,envelope,actionId,plan,contentId,origin,reason:originReason,agent,mode:mood?.mode,
      conversationIntent:['reply','followup','newTopic'].includes(conversationIntent)?conversationIntent:undefined,
      topicId:typeof topicId==='string'?topicId.slice(0,120):undefined});
  }
  function reportDelivered(fact) {
    // A failed observer cannot convert a completed physical operation into a retry.
    let drive; try { drive = call('conversationDrive','sent',{...fact,at:fact.sentAt,eventId:fact.deliveryId,episodeId:fact.proactiveId,kind:fact.conversationIntent}); } catch(error) { log('outbound fact conversationDrive: '+error.message); }
    const active = drive?.isProactive === true || ['followup','newTopic'].includes(fact.conversationIntent) || ['privateFollowup','timeBubble','reminder','milkStock'].includes(fact.originReason);
    for(const [service,method,payload] of [
      ['proactive','observe',{...fact,isProactive:active,at:fact.sentAt,kind:'sent',reason:fact.wakeReason,eventId:'sent:'+fact.deliveryId,episodeId:drive?.episodeId||fact.proactiveId}],
      ['mood','sent',fact],
      ['biliRecommendations','sent',fact],
      ['proactive','refresh',{key:fact.key,now:fact.sentAt}]
    ])try{call(service,method,payload);}catch(error){log('outbound fact '+service+': '+error.message);}
  }
  function perform(args={}) {
    const {key}=args,context=args.context||outboundScope.getStore()||capture({key});
    const operation=(chains.get(key)||Promise.resolve()).then(()=>performNow({...args,context}));
    const tail=operation.catch(()=>{});chains.set(key,tail);
    void tail.finally(()=>{if(chains.get(key)===tail)chains.delete(key);});
    return operation;
  }
  async function performNow({key,context,kind='text',text='',send,assertAllowed,requestedDelay,targetUserId,replyToMessageId}={}) {
    let c=context||outboundScope.getStore()||capture({key});
    const operationId=randomUUID();
    const selectedContentId=c.contentId;
    const assertContext=()=>{
      if(!c.agent)return;
      const checked=call('replyPlan','validateContext',{...contextFacts(c.sourceKey,c.envelope,replyToMessageId,{contentId:selectedContentId}),agent:c.agent,reason:c.envelope?.reason||c.reason});
      if(checked?.ok===false){const error=Error(checked.reason+'；'+checked.hint);error.knownFailed=true;throw error;}
    };
    assertContext();
    if(c.agent&&!c.plan?.scheduledGrant){
      const bound=call('replyPlan','bindContent',{key,sourceKey:c.sourceKey,plan:c.plan,contentId:c.contentId||c.plan?.contentId,replyToMessageId,...contentFacts(c.sourceKey,c.envelope,{targetKey:key,context:c})});
      if(bound?.ok!==true){const error=Error('发送内容范围拒绝：'+(bound?.reason||'content_scope_unavailable'));error.knownFailed=true;error.statusCode=409;throw error;}
      c=Object.freeze({...c,plan:bound.plan,contentId:bound.content?.id||c.contentId});
      assertContext();
    }
    const scheduled=c.envelope?.scheduledEvent;
    if(scheduled&&(key!==scheduled.key||(Array.isArray(scheduled.allowedKinds)&&!scheduled.allowedKinds.includes(kind)))){const e=Error('定时事件不允许此发送目标或消息类型');e.knownFailed=true;throw e;}
    if(c.agent){const expression=call('chatExpression','validate',{key,text,kind});if(expression?.ok===false){const error=Error(expression.reason+'；'+expression.hint);error.knownFailed=true;throw error;}}
    const assertRecommendation=()=>{
      if(String(c.reason||'').split(':')[0]!=='newsShare')return;
      const checked=call('biliRecommendations','validateOutbound',{key,sourceKey:c.sourceKey,reason:c.reason,kind,text,planId:c.envelope?.biliPlanId});
      if(checked?.ok!==true){const error=Error('视频推荐校验拒绝：'+(checked?.reason||'service_unavailable'));error.knownFailed=true;throw error;}
    };
    assertRecommendation();
    const scope=c.envelope?.sessionId && c.envelope?.turn!=null ? c.envelope.sessionId+':'+c.envelope.turn : undefined;
    const topicLease=call('conversationDrive','reserve',{key,scope,operationId,kind:c.conversationIntent,topicId:c.topicId,text,episodeId:c.actionId,originReason:c.reason,now:clock()});
    if(topicLease?.ok===false){const e=Error('话题动作拒绝：'+topicLease.reason+(topicLease.hint?'；'+topicLease.hint:''));e.knownFailed=true;throw e;}
    const plan=topicLease?.timeoutAction ? call('replyPlan','resolve',{key,turnId:topicLease.episodeId,incomingText:'',mood:call('mood','read',{key})||c.envelope?.mood,agent:c.agent})||c.plan : c.plan;
    if(plan && String(text).length>plan.maxMessageChars){call('conversationDrive','release',{lease:topicLease});const e=Error('发送计划拒绝：message_length');e.knownFailed=true;throw e;}
    const policyGuard=guard(key,{...c,transportKind:kind,transportTargetUserId:targetUserId,transportReplyTo:replyToMessageId});
    const assertGuard=()=>{assertAllowed?.();return policyGuard();};
    const metered=!(c.agent===false&&c.origin==='mechanical'&&['thinkingAck','budgetExceeded'].includes(c.reason));
    const reservation=metered?call('replyPlan','reserve',{key,plan,operationId,kind,text,inputSeq:c.envelope?.replyGrantThroughSeq,deduplicate:c.origin==='conversation'||!!c.conversationIntent,requestedDelay,now:clock()}):{ok:true,waitMs:0};
    if(!reservation?.ok){
      call('conversationDrive','release',{lease:topicLease});
      const {reason='service_unavailable',hint,nextAt}=reservation||{};
      const detail=[reason,hint,Number.isFinite(nextAt)?'nextAt='+new Date(nextAt).toISOString():null].filter(Boolean).join('；');
      throw Object.assign(Error('发送计划拒绝：'+detail),{statusCode:429,nextAt,knownFailed:true});
    }
    let started=false,result,replyBudget;
    try {
      if(reservation.waitMs>0)await sleep(reservation.waitMs);
      replyBudget=assertGuard();
      assertContext();
      const authorization=metered?call('replyPlan','authorize',{key,operationId,now:clock()}):null;
      if(metered&&authorization?.ok!==true){const error=Error('发送计划拒绝：'+(authorization?.reason||'authorization_unavailable'));error.knownFailed=true;throw error;}
      if(c.agent===false&&c.origin==='mechanical'&&c.reason==='budgetExceeded'&&call('tokenBudget','authorizeMechanicalSend',{key,now:clock()})?.ok!==true){const error=Error('满额固定回复已限流，不排队补发');error.knownFailed=true;throw error;}
      assertRecommendation();
      if(call('conversationDrive','authorize',{key,lease:topicLease})?.ok===false){const e=Error('话题动作已因新来信失效');e.knownFailed=true;throw e;}
      started=true;result=await send();
      if(result?.status==='failed'||(result?.retcode!=null&&result.retcode!==0)){const e=Error('网关拒绝发送');e.knownFailed=true;throw e;}
    }catch(error){
      if(metered)call('replyPlan','release',{key,operationId,knownFailed:!started||error?.knownFailed===true});
      call('conversationDrive','release',{lease:topicLease});
      if(started&&error?.knownFailed!==true)throw Object.assign(Error(error?.message||String(error),{cause:error}),{deliveryUnknown:true});
      throw error;
    }
    const sentAt=clock(),gatewayMessageId=result?.data?.message_id??result?.message_id??result?.messageId;
    const deliveryId=gatewayMessageId!=null?key+':gateway:'+gatewayMessageId:key+':attempt:'+operationId;
    try{if(metered)call('replyPlan','commit',{key,operationId,sentAt,deliveryId,replyBudget});}catch(error){log('outbound commit: '+error.message);}
    const conversational=['proactiveCheck','timeBubble','startupGreeting','privateFollowup','milkStock'].includes(c.reason);
    const ordinary=c.origin==='conversation'&&!conversational;
    const wakeReason=ordinary?'message':c.reason;
    const fact={key,sourceKey:c.sourceKey,operationId,deliveryId,gatewayMessageId,kind,text,sentAt,success:true,
      origin:c.origin,originReason:c.reason,wakeReason,proactiveId:c.actionId,episodeId:c.actionId,
      expectsReply:conversational&&c.reason!=='milkStock'&&c.origin!=='operator',targetUserId:targetUserId ?? c.targetUserId ?? c.envelope?.targetUserId,
      mode:c.mode,topicLease,conversationIntent:topicLease?.kind||c.conversationIntent,topicId:topicLease?.topicId||c.topicId,recommendationPlanId:c.envelope?.biliPlanId};
    reportDelivered(fact);
    try{c.envelope?.scheduledEvent?.onDelivered?.(fact);}catch(error){log('scheduled delivery receipt: '+error.message);}
    return result;
  }
  return {capture,perform,reportDelivered};
}
export function reportHumanIncoming(callService,fact) {
  const observed=callService('proactive','observe',{...fact,kind:'incoming',eventId:'incoming:'+fact.messageId});
  const result=callService('mood','incoming',{...fact,reengaged:observed?.reengaged===true});
  callService('proactive','refresh',{key:fact.key,now:fact.at});
  return result;
}
