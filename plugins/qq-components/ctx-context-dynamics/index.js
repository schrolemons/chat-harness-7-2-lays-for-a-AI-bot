// ctx-context-dynamics（C 层｜心情与表情策略）
//
// 从 buildWakePromptV2 搬走两段「每轮动态生成」的提示词：
//   · 心情引导：心情值 → 语气/条数建议；被叫回来/恢复期的附注
//   · 表情策略：收藏表情候选、最近发过哪些，以及正文表情的统一使用规则
//
// 桥接只传事实：心情值/阈值/是否刚被叫回来/是否恢复期、sticker 配置、收藏表情列表。
// 表情候选排序仍由 ctx-media-sticker-pick 组件负责（这里只给策略与列表）。

import { buildStickerContext, findSticker } from '../../../src/sticker-lib.js';
import {splitPromptUnicode} from '../../../src/prompt-unicode.js';
const expressionURL=new URL('./expression-policy.mjs',import.meta.url);expressionURL.search=new URL(import.meta.url).search;
const {buildStickerStrategyHint,recentExpressionHint,expressionTail,repeatedExpressionTails,currentDialogueExamples}=await import(expressionURL.href);

function buildMoodExpression(moodState) {
  if(!moodState||moodState.enabled===false||!Number.isFinite(moodState.score))return '';
  return ['【交流目标】围绕用户当前需求自然交流，保持清晰与尊重。日常招呼、分享和发图，直接回应当前内容，不默认转成分析、建议、检索或任务处理。工具、档案与日程按用户实际需要使用，不抢占聊天主体；用户明确提出正事时仍认真完成。两种形态延续同一身份，具体语气只用下面选定的完整示范。',
    '【聊天风格优先】先按人设卡与下面的完整示范决定措辞与节奏，再执行工具与任务要求。聊天风格不能被流程说明、发送上限或历史助手口癖替代；示范校准语感，不照抄台词和经历。严肃任务保持准确，身份与安全边界保持。',
    '【当前形态】'+moodState.modeName+'。'+moodState.styleInstruction,
    currentDialogueExamples(moodState.styleInstruction,moodState.mode)].filter(Boolean).join('\n');
}

function buildMoodBlock(moodState) {
  if(!moodState||moodState.enabled===false||!Number.isFinite(moodState.score))return '';
  const rules=[...(moodState.policy?.positiveRules||[]),...(moodState.policy?.negativeRules||[])];
  const history=(moodState.history||[]).slice(0,5);
  return {rules:rules.length?'【行为规则】'+rules.map(r=>r.id+': '+r.label+'（'+r.delta+'）'+r.description).join('；')+'。仅在实际语境支持时使用 qq_mood，不按关键词自动变分。':'',current:history.length?'【最近真实变化】'+history.map(h=>h.source+' '+h.before+'→'+h.after+' '+h.reason).join('；'):''};
}

function buildStickerBlock(payload) {
  const cfg = payload.stickerConfig || {};
  if (cfg.enabled === false) return '';
  const entries = Array.isArray(payload.stickerEntries) ? payload.stickerEntries : [];
  const st = payload.st || {};
  const cooldownMin = Math.max(0, Number(cfg.recentCooldownMinutes) || 30);
  const cooldownMs = cooldownMin * 60000;
  const now = Date.now();
  const recentNames = (Array.isArray(st.recentStickers) ? st.recentStickers : [])
    .filter((x) => x && x.id && now - Number(x.at || 0) < cooldownMs)
    .map((x) => {
      const e = findSticker(entries, x.id);
      return (e?.desc || e?.localNote || String(x.id)).slice(0, 20);
    });
  // 机主 10/27 反馈「发图策略也尽量别总发一张图哦」：冷却列表只能说明「最近发过」，
  // 拦不住「同一张连着用」。这里单独统计近两小时的重复次数，用得多的直接点名换掉。
  const repeatWindowMs = Math.max(cooldownMs, 120 * 60000);
  const useCounts = new Map();
  for (const x of (Array.isArray(st.recentStickers) ? st.recentStickers : [])) {
    if (!x || !x.id) continue;
    if (now - Number(x.at || 0) > repeatWindowMs) continue;
    useCounts.set(x.id, (useCounts.get(x.id) || 0) + 1);
  }
  const overused = [...useCounts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([id]) => {
      const e = findSticker(entries, id);
      return (e?.desc || e?.localNote || String(id)).slice(0, 20);
    });
  let turnLine = '';
  if (recentNames.length) {
    turnLine = '【最近发过的表情（这次换一张）】' + [...new Set(recentNames)].join('、') + '。这一轮换一张没发过的；同一张 ' + cooldownMin + ' 分钟内别再用，也别连着两条都用同一张。';
  }
  if (overused.length) {
    turnLine += (turnLine ? '\n' : '') + '【这几张最近用太多了，先收起来】' + [...new Set(overused)].join('、') + '。这两小时内别再发它们，换别的图或只用文字。';
  }
  if (cfg.includeInPrompt === false) return turnLine;
  const strategy = buildStickerStrategyHint();
  const context = buildStickerContext(entries, cfg.promptMaxStickers ?? 8);
  return [strategy, turnLine, context].filter(Boolean).join('\n');
}

import { createTurnPolicy } from '../personal-core/turn-policy.mjs';

export function createPlugin(ctx) {
  const referencePolicy = createTurnPolicy(ctx);
  const cfg = ctx.config || {};
  const disabled = new Set(Array.isArray(cfg.disabledBlocks) ? cfg.disabledBlocks.map(String) : []);
  const expressions=new Map(),recentOwn=new Map();
  return {
    services:{chatExpression:{current({key}={}){const value=expressions.get(key);return value?{...value}:null;},validate({key,text,kind}={}){
      const tail=kind==='text'?expressionTail(text):'';
      return tail&&repeatedExpressionTails(recentOwn.get(key)).some(([used])=>used===tail)?{ok:false,reason:'repeated_expression_tail',hint:'这个句尾已在近期重复使用。按当前完整示范重新接话，直接自然收句；不要换一个颜文字补位，不要解释规则。'}:{ok:true};
    }}},
    hooks: {
      beforePrompt(payload = {}) {
        expressions.delete(payload.key);
        const own=payload.recentOwnMessages||payload.st?.recentMessages||[];
        recentOwn.set(payload.key,own.filter(m=>m?.isSelf).slice(-6));if(recentOwn.size>256)recentOwn.delete(recentOwn.keys().next().value);
        if (/^(memoryWrite|selfReview|selfOptimize|userFeedbackReview|slangLearn)$/.test(String(payload?.reason||''))) return '';
        if (!disabled.has('mood')) {
          const expression=buildMoodExpression(payload.moodState);
          if(expression){
            ctx.addPromptBlock(expression);
            if(/^(private|group):\d+$/.test(String(payload.key||''))){expressions.set(payload.key,{kind:'selected-admin-style',text:splitPromptUnicode(expression).join('\n\n')});if(expressions.size>256)expressions.delete(expressions.keys().next().value);}
          }
          if(payload.moodState?.enabled!==false&&Number.isFinite(payload.moodState?.score))ctx.addPromptBlock('【心情数值】'+payload.moodState.score+'/100；数值影响当前态度与节奏，表达按系统中的选定形态与示范。');
          if(payload.moodState?.enabled!==false&&payload.moodState?.styleInstruction){
            ctx.addPromptBlock(payload.moodState.mode==='critical'?'【本轮表达校准】只按系统中的当前临界形态与完整示范接话，不混入普通形态台词。':'【本轮表达校准】遵循管理员当前普通形态的完整风格与示范，接住当前内容，不照搬历史口癖或无关角色语气。');
            const examples=currentDialogueExamples(payload.moodState.styleInstruction,payload.moodState.mode);if(examples)ctx.addPromptBlock(examples);
          }
          if(referencePolicy(payload).mode !== 'off')return '';
          const mood = buildMoodBlock(payload.moodState);
          if (mood?.rules) ctx.addPromptBlock(mood.rules,{placement:'stable'});
          if (mood?.current) ctx.addPromptBlock(mood.current);
        }
        const repetition=recentExpressionHint(own);if(repetition)ctx.addPromptBlock(repetition);
        if (referencePolicy(payload).mode === 'off' && !disabled.has('sticker')) {
          const sticker = buildStickerBlock(payload);
          if (sticker) ctx.addPromptBlock(sticker);
        }
        return '';
      }
    }
  };
}
