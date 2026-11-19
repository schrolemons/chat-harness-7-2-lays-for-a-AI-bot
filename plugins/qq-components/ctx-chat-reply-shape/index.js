import { createTurnPolicy } from '../personal-core/turn-policy.mjs';
const moduleURL=relative=>{const u=new URL(relative,import.meta.url);u.search=new URL(import.meta.url).search;return u.href;};
const {planReplyShape,replyPolicy,validateReplyPolicy}=await import(moduleURL('../../../src/reply-shape.js'));
const {createSendLedger}=await import(moduleURL('./send-ledger.mjs'));
const {createBatchGrants}=await import(moduleURL('./batch-grants.mjs'));
const {createContentUnits}=await import(moduleURL('./content-units.mjs'));
const {validateContextSend}=await import(moduleURL('./context-send-policy.mjs'));
export const TOOL_LOADING_RULE='【按需工具调用】以当前请求实际提供的工具参数为准，历史加载回执不保证本轮仍可用。已经提供完整参数的工具直接调用，不再用 qq_select_tools 确认。缺少所需工具时按需加载；成功回执已列出某工具，就继续原任务，不重复选择该工具，也不为了确认加载成功调用其他工具。';
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
    const plan=payload?.replyPlan;if(!plan)return TOOL_LOADING_RULE;
    const progress=replyPlan.progress({plan});
    const awaitingDelivery=replyPlan.pendingDeliverySources({key:plan.key,messages:[...(payload.st?.unread||[]),...(payload.st?.recentMessages||[])]});
    const delivered=replyPlan.turnProgress({plan}).filter(p=>p.successful>0);
    const receiptPending=new Set(payload?.st?.receiptSendPendingSeqs||[]);
    const pendingReceipts=delivered.flatMap(p=>p.seqs).filter(seq=>receiptPending.has(seq));
    const line=progress?plan.line.replace('先根据已实际读到的完整来信声明语义分组，发送时选择对应 contentId','当前内容已由服务端绑定，直接使用下方 contentId 发送，不再调用 qq_reply_contents 重复声明；只有出现不同的新内容且未绑定时才分组'):plan.line;
    return [line+' 必答由入栈tag决定，不按新旧判断：replyRequirement=required且仍在双戳上下文域的消息按收件seq升序回应，同义片段可合并，不同问题不可漏答；其余新入站和历史消息均可自由选答。不能仅凭needsReply、未读数或入栈时间扩大必答范围。普通闲聊同一批意思合成一条完整回复，不按入站条数拆回、不逐句引用、不为友好交流或收尾再发一条。确有不同问题或必要细节才分开，每条推进新内容。条数是上限而非目标；普通群聊可以选择不插话。',progress?'【所选语义内容发送进度】contentId='+progress.contentId+'；已成功发送 '+progress.successful+' 条；发送中 '+progress.inflight+' 条；投递待核对 '+progress.uncertain+' 条；'+(progress.uncertain?'本内容的发送结果尚未确认，不改写、不换工具或补发；保留待核对，不报已回复':progress.taskExempt?'可信任务免除分条额度':'此内容最多还可发送 '+progress.remaining+' 条')+'。同一内容跨调用共用记录；已经回应的内容不要换说法再次发送，不补满条数。完成后直接结束，无需另写发送流水、额度说明或内部工作汇报。':'',
      awaitingDelivery.length?'【投递待核对】以下来信先保留待核对：seq '+JSON.stringify(awaitingDelivery)+'。这些来源暂缓发送与登记回复。同一窗口的独立新来信单独分组，正常回答。':'',
      delivered.length?'【本回合实际答复凭据】'+JSON.stringify(delivered.map(p=>({contentId:p.contentId,sourceSeqs:p.seqs,successful:p.successful})))+'。以上来源已有真实答复，不改写重发。'+(pendingReceipts.length?'仍待登记回复回执的seq：'+JSON.stringify([...new Set(pendingReceipts)])+'；确认这一份答复已表达完整后，一次提交这些seq的replied。':'当前没有待补的回复回执，不再次提交这些来源的seen/replied/complete。')+'当前待答以C36收件索引为准，缓存未读数不是必答数量。':'',
      '【回执收尾】当前索引已有seenAt的消息不再报seen；已有repliedAt/complete的消息不再提交回执。普通消息若选择只作上下文，可一次报context并说明原因，已经replyDisposition=history就不再报context。工具成功后采用返回状态，不为核对同一状态再调用；没有新的待答内容或待登记回执时，直接qq_wait_for_messages，不写收尾独白。仍在连发且内容确实不完整时才qq_wait_for_quiet；读消息和思考已经经过的静默时间也算等待。',
      '【合并声明与发送】qq_send_message可直接携带本轮一份完整意思的准确sourceSeqs，程序先按同一规则完成分组再发送，免去单独qq_reply_contents往返；已有contentId则沿用。不同意思仍分别分组，额度、必答顺序及来源检查不变。qq_relay_image的sourceSeqs应是当前发起私聊的完整传图指令，按task接手后再发送；messageId指原图片的真实QQ消息ID，不能用缓存引用串冒充imageId。只有当前参数确实提供sourceSeqs时才使用此合并方式。',TOOL_LOADING_RULE].filter(Boolean).join('\n');
  }}};
}
