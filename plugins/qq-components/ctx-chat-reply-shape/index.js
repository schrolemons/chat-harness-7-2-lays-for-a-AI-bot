import { createTurnPolicy } from '../schnie-core/turn-policy.mjs';
const moduleURL=relative=>{const u=new URL(relative,import.meta.url);u.search=new URL(import.meta.url).search;return u.href;};
const {planReplyShape,replyPolicy,validateReplyPolicy}=await import(moduleURL('../../../src/reply-shape.js'));
const {createSendLedger}=await import(moduleURL('./send-ledger.mjs'));
export function createPlugin(ctx) {
  const phi=createTurnPolicy(ctx),policy=()=>replyPolicy(ctx.config);
  const replyPlan=createSendLedger(ctx,policy);
  replyPlan.resolve=payload=>planReplyShape({...payload,config:ctx.config,phiMode:payload?.phiMode??phi(payload).mode});
  return {validateConfig:validateReplyPolicy,services:{replyPlan},hooks:{beforePrompt:payload=>payload?.replyPlan?.line||''}};
}
