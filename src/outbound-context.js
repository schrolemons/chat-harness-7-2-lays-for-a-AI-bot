import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// Transport identity only. Policy and durable counters live in component services.
export const outboundScope=new AsyncLocalStorage();
export function createOutboundTransport({callService,guard=()=>()=>{},log=()=>{},clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
  const call=(s,m,p)=>callService(s,m,p);
  const chains=new Map();
  function capture({key,envelope,origin='operator',reason='operator',agent=false,conversationIntent,topicId}={}) {
    const actionId=envelope?.actionId||randomUUID();
    const mood=envelope?.mood||call('mood','read',{key});
    const plan=envelope?.replyPlan||call('replyPlan','resolve',{key,turnId:agent?'':actionId,agent,incomingText:'',mood});
    const originReason=envelope?.reason||reason;
    const ordinary=/^(message|reply|private|question|atMention|nameMention|keyword|probability|anyMessage|speaker|poke|bootstrap)(:|$)/.test(originReason);
    if(origin==='conversation'&&!ordinary&&!['proactiveCheck','timeBubble','startupGreeting','privateFollowup'].includes(originReason))origin='purpose';
    return Object.freeze({key,sourceKey:envelope?.key||key,envelope,actionId,plan,origin,reason:originReason,agent,mode:mood?.mode,
      conversationIntent:['reply','followup','newTopic'].includes(conversationIntent)?conversationIntent:undefined,
      topicId:typeof topicId==='string'?topicId.slice(0,120):undefined});
  }
  function reportDelivered(fact) {
    // A failed observer cannot convert a completed physical operation into a retry.
    let drive; try { drive = call('conversationDrive','sent',{...fact,at:fact.sentAt,eventId:fact.deliveryId,episodeId:fact.proactiveId,kind:fact.conversationIntent}); } catch(error) { log('outbound fact conversationDrive: '+error.message); }
    const active = drive?.isProactive === true || ['followup','newTopic'].includes(fact.conversationIntent) || fact.originReason === 'privateFollowup';
    for(const [service,method,payload] of [
      ['proactive','observe',{...fact,isProactive:active,at:fact.sentAt,kind:'sent',reason:fact.wakeReason,eventId:'sent:'+fact.deliveryId,episodeId:drive?.episodeId||fact.proactiveId}],
      ['mood','sent',fact],
      ['biliRecommendations','sent',fact],
      ['proactive','refresh',{key:fact.key,now:fact.sentAt}]
    ])try{call(service,method,payload);}catch(error){log('outbound fact '+service+': '+error.message);}
  }
  function perform(args={}) {
    const {key}=args,context=args.context||outboundScope.getStore()||capture({key});
    const assertAllowed=args.assertAllowed||guard(key,context);
    const operation=(chains.get(key)||Promise.resolve()).then(()=>performNow({...args,context,assertAllowed}));
    const tail=operation.catch(()=>{});chains.set(key,tail);
    void tail.finally(()=>{if(chains.get(key)===tail)chains.delete(key);});
    return operation;
  }
  async function performNow({key,context,kind='text',text='',send,assertAllowed,requestedDelay,targetUserId}={}) {
    const c=context||outboundScope.getStore()||capture({key});
    const operationId=randomUUID();
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
    const assertGuard=assertAllowed||guard(key,c);
    const metered=!(c.agent===false&&c.origin==='mechanical'&&['thinkingAck','budgetExceeded'].includes(c.reason));
    const reservation=metered?call('replyPlan','reserve',{key,plan,operationId,kind,text,inputSeq:c.envelope?.replyGrantThroughSeq,deduplicate:c.origin==='conversation'||!!c.conversationIntent,requestedDelay,now:clock()}):{ok:true,waitMs:0};
    if(!reservation?.ok){call('conversationDrive','release',{lease:topicLease});const e=Error('发送计划拒绝：'+(reservation?.reason||'service_unavailable')+(reservation?.hint?'；'+reservation.hint:''));e.statusCode=429;e.knownFailed=true;throw e;}
    let started=false,result;
    try {
      if(reservation.waitMs>0)await sleep(reservation.waitMs);
      assertGuard();
      if(c.agent===false&&c.origin==='mechanical'&&c.reason==='budgetExceeded'&&call('tokenBudget','authorizeMechanicalSend',{key,now:clock()})?.ok!==true){const error=Error('满额固定回复已限流，不排队补发');error.knownFailed=true;throw error;}
      assertRecommendation();
      if(call('conversationDrive','authorize',{key,lease:topicLease})?.ok===false){const e=Error('话题动作已因新来信失效');e.knownFailed=true;throw e;}
      started=true;result=await send();
      if(result?.status==='failed'||(result?.retcode!=null&&result.retcode!==0)){const e=Error('网关拒绝发送');e.knownFailed=true;throw e;}
    }catch(error){
      if(metered)call('replyPlan','release',{key,operationId,knownFailed:!started||error?.knownFailed===true});
      call('conversationDrive','release',{lease:topicLease});
      throw error;
    }
    const sentAt=clock(),gatewayMessageId=result?.data?.message_id??result?.message_id??result?.messageId;
    const deliveryId=gatewayMessageId!=null?key+':gateway:'+gatewayMessageId:key+':attempt:'+operationId;
    try{if(metered)call('replyPlan','commit',{key,operationId,sentAt,deliveryId});}catch(error){log('outbound commit: '+error.message);}
    const conversational=['proactiveCheck','timeBubble','startupGreeting','privateFollowup'].includes(c.reason);
    const ordinary=c.origin==='conversation'&&!conversational;
    const wakeReason=ordinary?'message':c.reason;
    reportDelivered({key,sourceKey:c.sourceKey,operationId,deliveryId,gatewayMessageId,kind,text,sentAt,success:true,
      origin:c.origin,originReason:c.reason,wakeReason,proactiveId:c.actionId,episodeId:c.actionId,
      expectsReply:conversational&&c.origin!=='operator',targetUserId:targetUserId ?? c.targetUserId ?? c.envelope?.targetUserId,
      mode:c.mode,topicLease,conversationIntent:topicLease?.kind||c.conversationIntent,topicId:topicLease?.topicId||c.topicId,recommendationPlanId:c.envelope?.biliPlanId});
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
