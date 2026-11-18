import {slicePromptUnicode} from '../../../src/prompt-unicode.js';
// ctx-context-session（C 层｜会话事实与身份上下文）
//
// 这些以前是 buildWakePromptV2 里内联的：当前角色名、机器人身份（@/昵称/QQ 号）、
// 会话令牌、此刻状态（未读/最近来信/上次发言）、首次唤醒的初始提示词。
// 只依赖「bridge 传进来的事实」，所以整块搬进组件。
//
// 桥接仍负责：生成 agentToken、取机器人昵称、首次唤醒判断、formatInitialPromptV2 的读取。

import { describeAge } from '../../../src/qq-model-view.js';
import { looksLikeUnfinished } from '../../../src/v2-wait.js';
const interactionURL = new URL('./interaction-state.mjs', import.meta.url); interactionURL.search = new URL(import.meta.url).search;
const {buildInteractionState} = await import(interactionURL.href);
const addresseesURL=new URL('./addressees.mjs',import.meta.url);addresseesURL.search=new URL(import.meta.url).search;
const {ADDRESSEE_RULE,createAddresseeContext}=await import(addresseesURL.href);
const cardsURL=new URL('./share-cards.mjs',import.meta.url);cardsURL.search=new URL(import.meta.url).search;
const {createShareCardContext}=await import(cardsURL.href);
const participantsURL=new URL('./participants.mjs',import.meta.url);participantsURL.search=new URL(import.meta.url).search;
const {PARTICIPANT_IDENTITY_RULE,createParticipantIdentityContext}=await import(participantsURL.href);
const evidenceURL=new URL('./interaction-evidence.mjs',import.meta.url);evidenceURL.search=new URL(import.meta.url).search;
const {createInteractionEvidence}=await import(evidenceURL.href);

function buildIdentity(selfName, selfId) {
  const name = String(selfName || '').trim();
  const id = String(selfId || '').trim();
  if (!name && !id) return '';
  const label = name ? `「${name}」` : '（昵称未取到）';
  const idText = id ? `（QQ ${id}）` : '';
  const callBits = name
    ? `当前正文直接@${name}、叫「${name}」或引用你本人的发言，是与你互动的线索，不能覆盖本句@他人的收话对象`
    : '当前正文直接@你、叫你的昵称或引用你本人的发言时，结合正文判断说话对象';
  return `【你的身份】你在 QQ 上的昵称是${label}${idText}。私聊默认是对你说；群聊${callBits}。群名片可能不同，顶层at目标ID${id ? ` ${id} ` : '与你的QQ号相同'}可确认@你；他人引用的旧内容里出现@你，不代表本句又在叫你。`;
}

function buildStatus(st, now = Date.now()) {
  if (!st) return '';
  const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
  const unread = Array.isArray(st.unread) ? st.unread.filter(m => m?.replyDisposition !== 'history') : [];
  const bits = [`未读 ${unread.length} 条`];
  const lastMsg = [...recent].reverse().find((m) => m && !m.isSelf);
  const lastAiMin = st.lastAiReplyAt ? Math.max(0, Math.round((now - Number(st.lastAiReplyAt)) / 60000)) : null;
  if (lastMsg) {
    const lastAgo = describeAge(lastMsg.time, now);
    bits.push(`最近一条来自 ${slicePromptUnicode(lastMsg.sender || '未知',64)}${lastAgo ? `（${lastAgo} 前）` : ''}`);
  }
  if (lastMsg && looksLikeUnfinished(String(lastMsg.tail || lastMsg.plain || lastMsg.text || ''))) bits.push('对方可能没说完');
  if (lastAiMin != null) bits.push(`你上次发言 ${lastAiMin} 分钟前`);
  return `【此刻状态】${bits.join('；')}`;
}

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const disabled = new Set(Array.isArray(cfg.disabledBlocks) ? cfg.disabledBlocks.map(String) : []);
  const on = (name) => !disabled.has(name);
  const addresseeContext=createAddresseeContext(input=>ctx.capabilities?.readLocalConversationHistory?.(input));
  const shareCardContext=createShareCardContext(input=>ctx.capabilities?.readLocalConversationHistory?.(input));
  const participantContext=createParticipantIdentityContext({readHistory:input=>ctx.capabilities?.readLocalConversationHistory?.(input),getAliases:key=>ctx.callService?.('aliases','injectionPreview',{key})?.selected||[]});
  const interactionEvidence=createInteractionEvidence();

  return {
    services:{interactionEvidence},
    hooks: {
      beforePrompt(payload = {}) {
        interactionEvidence.observe(payload);
        const st = payload.st;
        if (on('role') && payload.roleName) ctx.addPromptBlock('【当前角色】' + String(payload.roleName) + '。自我介绍使用当前角色名与实际昵称；历史自称、自我介绍和群友绰号不改变当前身份，不把旧称呼重新补成身份设定。');
        if (on('identity')) {
          const id = buildIdentity(payload.selfName, payload.selfId);
          if (id) ctx.addPromptBlock(id);
          if(String(payload.key||'').startsWith('group:')){
            ctx.addPromptBlock(PARTICIPANT_IDENTITY_RULE,{placement:'stable'});
            const people=participantContext(payload);if(people)ctx.addPromptBlock(people);
            ctx.addPromptBlock(ADDRESSEE_RULE,{placement:'stable'});
            const addressed=addresseeContext(payload);if(addressed)ctx.addPromptBlock(addressed);
          }
        }
        if (on('token') && payload.agentToken) {
          ctx.addPromptBlock('【会话令牌】' + String(payload.agentToken) + '（调用二代状态工具时请在参数中带上此令牌）');
        }
        if (on('status')) {
          const cards=shareCardContext(payload);if(cards)ctx.addPromptBlock(cards);
          // The scheduled alert supplies its own verified balance facts and configured wording.
          const milk = payload.reason === 'milkStock' ? '' : ctx.callService?.('milkStock','context',{key:payload.key});
          if (typeof milk === 'string' && milk) ctx.addPromptBlock(milk);
          const status = buildStatus(st);
          if (status) ctx.addPromptBlock(status);
          const interactions = buildInteractionState(st);
          if (interactions) ctx.addPromptBlock(interactions);
        }
        if (on('initialPrompt') && payload.initialPromptText) {
          ctx.addPromptBlock(String(payload.initialPromptText));
        }
        return '';
      }
    }
  };
}
