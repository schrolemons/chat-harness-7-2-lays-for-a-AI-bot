// ctx-context-dynamics（C 层｜心情与表情策略）
//
// 从 buildWakePromptV2 搬走两段「每轮动态生成」的提示词：
//   · 心情引导：心情值 → 语气/条数建议；被叫回来/恢复期的附注
//   · 表情策略：收藏表情候选、最近发过哪些，以及正文表情的统一使用规则
//
// 桥接只传事实：心情值/阈值/是否刚被叫回来/是否恢复期、sticker 配置、收藏表情列表。
// 表情候选排序仍由 ctx-media-sticker-pick 组件负责（这里只给策略与列表）。

import { buildStickerContext, buildStickerStrategyHint, findSticker } from '../../../src/sticker-lib.js';
import {splitPromptUnicode} from '../../../src/prompt-unicode.js';

function buildMoodExpression(moodState) {
  if(!moodState||moodState.enabled===false||!Number.isFinite(moodState.score))return '';
  return '【当前形态】'+moodState.modeName+'（'+moodState.score+'/100）。'+moodState.styleInstruction
    +'\n【聊天风格优先】这是本轮所有对用户可见文字的核心表达方式，完整示范用于校准语感，不照抄台词。形态风格优先于角色卡中的惯常语气；身份事实与安全边界保持，严肃任务先完成内容。';
}

function buildMoodBlock(moodState) {
  if(!moodState||moodState.enabled===false||!Number.isFinite(moodState.score))return '';
  const rules=[...(moodState.policy?.positiveRules||[]),...(moodState.policy?.negativeRules||[])];
  const history=(moodState.history||[]).slice(0,5);
  return [(rules.length?'【行为规则】'+rules.map(r=>r.id+': '+r.label+'（'+r.delta+'）'+r.description).join('；')+'。仅在实际语境支持时使用 qq_mood，不按关键词自动变分。':''),
    (history.length?'【最近真实变化】'+history.map(h=>h.source+' '+h.before+'→'+h.after+' '+h.reason).join('；'):'')].filter(Boolean).join('\n');
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
  const expressions=new Map();
  return {
    services:{chatExpression:{current({key}={}){const value=expressions.get(key);return value?{...value}:null;}}},
    hooks: {
      beforePrompt(payload = {}) {
        expressions.delete(payload.key);
        if (/^(memoryWrite|selfReview|selfOptimize|userFeedbackReview|slangLearn)$/.test(String(payload?.reason||''))) return '';
        if (!disabled.has('mood')) {
          const expression=buildMoodExpression(payload.moodState);
          if(expression){
            ctx.addPromptBlock(expression);
            if(/^(private|group):\d+$/.test(String(payload.key||''))){expressions.set(payload.key,{kind:'selected-admin-style',text:splitPromptUnicode(expression).join('\n\n')});if(expressions.size>256)expressions.delete(expressions.keys().next().value);}
          }
          if(referencePolicy(payload).mode !== 'off')return '';
          const mood = buildMoodBlock(payload.moodState);
          if (mood) ctx.addPromptBlock(mood);
        }
        if (referencePolicy(payload).mode === 'off' && !disabled.has('sticker')) {
          const sticker = buildStickerBlock(payload);
          if (sticker) ctx.addPromptBlock(sticker);
        }
        return '';
      }
    }
  };
}
