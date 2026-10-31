import { createTurnPolicy } from '../personal-core/turn-policy.mjs';
const moduleURL=relative=>{const u=new URL(relative,import.meta.url);u.search=new URL(import.meta.url).search;return u.href;};
const {planReplyShape,replyPolicy,validateReplyPolicy}=await import(moduleURL('../../../src/reply-shape.js'));
const {createSendLedger}=await import(moduleURL('./send-ledger.mjs'));
const {createBatchGrants}=await import(moduleURL('./batch-grants.mjs'));
export function createPlugin(ctx) {
  const referencePolicy=createTurnPolicy(ctx),policy=()=>replyPolicy(ctx.config);
  const replyPlan=createSendLedger(ctx,policy);
  replyPlan.resolve=payload=>{const plan=planReplyShape({...payload,willingness:ctx.callService?.('proactive','availability',{key:payload?.key})?.willingness??100,config:ctx.config,referenceMode:payload?.referenceMode??referencePolicy(payload).mode});if(payload?.budgetStage!=='weak')return plan;const maxMessages=String(payload.key).startsWith('private:')?1:Math.max(1,Math.min(60,Number(payload.batchMessageCount)||1));return Object.freeze({...plan,budgetStage:'weak',maxMessages,line:plan.line.replace(/合计最多 \d+ 条/,'合计最多 '+maxMessages+' 条')+' 冷漠固定批次：处理窗口后结束，不追问或等待。'});};
  replyPlan.forMessages=createBatchGrants(payload=>replyPlan.resolve(payload));
  return {validateConfig:validateReplyPolicy,services:{replyPlan},hooks:{beforePrompt:payload=>{
    const plan=payload?.replyPlan;if(!plan)return '';
    const progress=replyPlan.progress({plan});
    return [plan.line,progress?'【本回复批次发送进度】已成功发送 '+progress.successful+' 条；发送中或结果待确认 '+progress.inflight+' 条；本批次最多还可发送 '+progress.remaining+' 条。这是同一回复批次的当前进度，不是新的发送指令。已经回应的内容不要换说法再次发送；剩余额度只是上限，需求已完成就确认真实回执并等待或结束，不补满条数。完成后直接结束，无需另写发送流水、额度说明或内部工作汇报。':''].filter(Boolean).join('\n');
  }}};
}
