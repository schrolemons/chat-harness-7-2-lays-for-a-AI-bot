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
    for(const [service,method,payload] of [
      ['proactive','observe',{...fact,at:fact.sentAt,kind:'sent',reason:fact.wakeReason,eventId:'sent:'+fact.deliveryId,episodeId:fact.proactiveId}],
      ['mood','sent',fact],
      ['conversationDrive','sent',{...fact,at:fact.sentAt,eventId:fact.deliveryId,episodeId:fact.proactiveId,kind:fact.conversationIntent}],
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
    const operationId=randomUUID(),plan=c.plan;
    if(plan && String(text).length>plan.maxMessageChars){const e=Error('发送计划拒绝：message_length');e.knownFailed=true;throw e;}
    const assertGuard=assertAllowed||guard(key,c);
    const reservation=call('replyPlan','reserve',{key,plan,operationId,kind,requestedDelay,now:clock()});
    if(!reservation?.ok){const e=Error('发送计划拒绝：'+(reservation?.reason||'service_unavailable'));e.statusCode=429;e.knownFailed=true;throw e;}
    let started=false,result;
    try {
      if(reservation.waitMs>0)await sleep(reservation.waitMs);
      assertGuard();started=true;result=await send();
      if(result?.status==='failed'||(result?.retcode!=null&&result.retcode!==0)){const e=Error('网关拒绝发送');e.knownFailed=true;throw e;}
    }catch(error){
      call('replyPlan','release',{key,operationId,knownFailed:!started||error?.knownFailed===true});
      throw error;
    }
    const sentAt=clock(),gatewayMessageId=result?.data?.message_id??result?.message_id??result?.messageId;
    const deliveryId=gatewayMessageId!=null?key+':gateway:'+gatewayMessageId:key+':attempt:'+operationId;
    try{call('replyPlan','commit',{key,operationId,sentAt,deliveryId});}catch(error){log('outbound commit: '+error.message);}
    const conversational=['proactiveCheck','timeBubble','startupGreeting','privateFollowup'].includes(c.reason);
    const ordinary=c.origin==='conversation'&&!conversational;
    const wakeReason=ordinary?'message':c.reason;
    reportDelivered({key,sourceKey:c.sourceKey,operationId,deliveryId,gatewayMessageId,kind,text,sentAt,success:true,
      origin:c.origin,originReason:c.reason,wakeReason,proactiveId:c.actionId,episodeId:c.actionId,
      expectsReply:conversational&&c.origin!=='operator',targetUserId:targetUserId ?? c.targetUserId ?? c.envelope?.targetUserId,
      mode:c.mode,conversationIntent:c.conversationIntent,topicId:c.topicId});
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
