import { createTurnPolicy } from '../personal-core/turn-policy.mjs';
const moduleURL=relative=>{const u=new URL(relative,import.meta.url);u.search=new URL(import.meta.url).search;return u.href;};
const {planReplyShape,replyPolicy,validateReplyPolicy}=await import(moduleURL('../../../src/reply-shape.js'));
const {createSendLedger}=await import(moduleURL('./send-ledger.mjs'));
const {createBatchGrants}=await import(moduleURL('./batch-grants.mjs'));
const {createContentUnits}=await import(moduleURL('./content-units.mjs'));
const {validateContextSend}=await import(moduleURL('./context-send-policy.mjs'));
export function createPlugin(ctx) {
  const referencePolicy=createTurnPolicy(ctx),policy=()=>replyPolicy(ctx.config);
  const replyPlan=createSendLedger(ctx,policy);
  Object.assign(replyPlan,createContentUnits(ctx));
  replyPlan.validateContext=validateContextSend;
  replyPlan.resolve=payload=>{const plan=planReplyShape({...payload,willingness:ctx.callService?.('proactive','availability',{key:payload?.key})?.willingness??payload?.willingness??100,config:ctx.config,referenceMode:payload?.referenceMode??referencePolicy(payload).mode});return payload?.budgetStage==='weak'?Object.freeze({...plan,budgetStage:'weak',line:plan.line+' 冷漠固定窗口：处理窗口后结束，不追问或等待；每个语义内容仍分别计数。'}):plan;};
  const resolve=replyPlan.resolve;
  replyPlan.resolve=payload=>{const plan=resolve(payload);return payload?.reason==='milkStock'?Object.freeze({...plan,maxMessages:1,line:plan.line.replace(/合计最多 \d+ 条/,'合计最多 1 条')+' 本次是定时API预算告警：只发送一条短句，不追加媒体或追问。'}):plan;};
  const resolveScheduled=replyPlan.resolve;
  replyPlan.resolve=payload=>{
    const plan=resolveScheduled(payload),grant=payload?.budgetStage&&payload.budgetStage!=='normal'?null:replyPlan.scheduledGrant(payload);
    if(!grant)return plan;
    return Object.freeze({...plan,scheduledGrant:grant,line:plan.line+' 本次有 '+grant.ids.length+' 项真实定时事件，每项最多一条；额外频率额度仅短时有效，勿补发旧消息或凑满条数。'});
  };
  const resolveContents=replyPlan.resolve;
  replyPlan.resolve=payload=>{
    const plan=resolveContents(payload),messages=(payload?.messages||[]).filter(m=>m?.isSelf!==true&&Number.isSafeInteger(m?.seq)&&m.seq>0);
    if(!messages.length&&payload?.taskGroupId){
      const admission=replyPlan.getTaskGroup({key:payload.key,groupId:payload.taskGroupId});
      return Object.freeze({...plan,taskGroupId:payload.taskGroupId,taskExempt:!!admission,taskPending:!admission});
    }
    if(!plan.taskExempt&&!messages.length&&payload?.autonomousSource){
      const declared=replyPlan.declareAutonomous({key:payload.key,plan,autonomousSource:payload.autonomousSource});
      if(declared.ok)return replyPlan.bindContent({key:payload.key,plan,contentId:declared.content.id}).plan;
    }
    if(messages.length!==1)return plan;
    const taskSources=payload?.taskSources||payload?.taskEligible,source=taskSources?.[messages[0].seq],task=source===true||source?.eligible===true;
    const declared=replyPlan.declareContents({key:payload.key,plan,messages,groups:[{seqs:[messages[0].seq],kind:task?'task':'chat'}],taskEligible:taskSources});
    if(!declared.ok)return plan;
    const content=declared.contents[0];
    if(content.taskPending)return Object.freeze({...plan,contentId:content.id,taskGroupId:content.id,taskPending:true,taskExempt:false});
    return replyPlan.bindContent({key:payload.key,plan,contentId:declared.contents[0].id}).plan;
  };
  const preview=replyPlan.preview;
  replyPlan.preview=payload=>preview.call(replyPlan,{...payload,plan:payload?.plan||planReplyShape({key:payload?.key,config:ctx.config,mood:payload?.mood??ctx.callService?.('mood','read',{key:payload?.key})??{},willingness:ctx.callService?.('proactive','availability',{key:payload?.key})?.willingness??payload?.willingness??100})});
  const forMessages=createBatchGrants(payload=>replyPlan.resolve(payload));
  replyPlan.forMessages=payload=>forMessages({...payload,canRenew:!['milkStock','reminder','timeBubble','scheduledContact'].includes(String(payload?.reason||'').split(':')[0])&&payload?.canRenew!==false});
  return {validateConfig:validateReplyPolicy,services:{replyPlan},hooks:{beforePrompt:payload=>{
    const plan=payload?.replyPlan;if(!plan)return '';
    const progress=replyPlan.progress({plan});
    return [plan.line,progress?'【所选语义内容发送进度】contentId='+progress.contentId+'；已成功发送 '+progress.successful+' 条；发送中或结果待确认 '+progress.inflight+' 条；'+(progress.taskExempt?'可信任务免除分条额度':'此内容最多还可发送 '+progress.remaining+' 条')+'。同一内容跨调用共用记录；已经回应的内容不要换说法再次发送，不补满条数。完成后直接结束，无需另写发送流水、额度说明或内部工作汇报。':''].filter(Boolean).join('\n');
  }}};
}
