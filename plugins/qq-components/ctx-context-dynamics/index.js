// ctx-context-dynamics（C 层｜心情与表情策略）
//
// 从 buildWakePromptV2 搬走两段「每轮动态生成」的提示词：
//   · 心情引导：心情值 → 语气/条数建议；被叫回来/恢复期的附注
//   · 表情策略：收藏表情候选、最近发过哪些，以及正文表情的统一使用规则
//
// 桥接只传事实：心情值/阈值/是否刚被叫回来/是否恢复期、sticker 配置、收藏表情列表。
// 表情候选排序仍由 ctx-media-sticker-pick 组件负责（这里只给策略与列表）。

import { buildStickerContext, buildStickerStrategyHint, findSticker } from '../../../src/sticker-lib.js';

function buildMoodBlock(moodState) {
  if (!moodState || !moodState.config || moodState.config.enabled === false) return '';
  const cfg = moodState.config;
  const eff = Number(moodState.value);
  if (!Number.isFinite(eff)) return '';
  const label = eff >= cfg.highThreshold ? '不错' : eff >= cfg.lowThreshold ? '还行' : '有点低';
  const guide = eff >= cfg.highThreshold
    ? '心情好：可以活跃点，2~3 条短句 + 1~2 张表情，主动接梗开玩笑'
    : eff >= cfg.lowThreshold
      ? '心情一般：1~2 条短句 + 1 张表情，正常聊'
      : '心情低落（刚被嫌吵或被凶）：短一点、安静一点，允许委屈，温和表达感受，尊重对方需要的距离';
  const extra = eff >= cfg.highThreshold
    ? '心情好时可以更主动：追问对方的细节、接住话题往下聊、主动起新话题；偶尔可以连发 2~3 条（允许重复强调同一句，像真人激动刷屏），别太克制。'
    : '';
  let text = '【小鲸鱼的心情】' + label + '（' + eff + '/100）。' + guide + '。' + extra;
  if (moodState.unmuteBurst) {
    text += '\n【刚被叫回来】对方之前让你别吵/说忙，现在主动找你（问“在吗”之类）：可以先把憋着的一两句话说完整（最多 2~3 条 + 1~2 张表情），热情一点但别刷屏，然后看他反应。';
  }
  if (moodState.recovering) {
    text += '\n【恢复期】刚从静音恢复，别一上来就潜水；正常接话，慢慢回到日常频率，别变社恐。';
  }
  return text;
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

import { createTurnPolicy } from '../schnie-core/turn-policy.mjs';

export function createPlugin(ctx) {
  const phi = createTurnPolicy(ctx);
  const cfg = ctx.config || {};
  const disabled = new Set(Array.isArray(cfg.disabledBlocks) ? cfg.disabledBlocks.map(String) : []);
  return {
    hooks: {
      beforePrompt(payload = {}) {
        if (phi(payload).mode !== 'off') return '';
        if (/^(memoryWrite|selfReview|selfOptimize|slangLearn)$/.test(String(payload?.reason||''))) return '';
        if (!disabled.has('mood')) {
          const mood = buildMoodBlock(payload.moodState);
          if (mood) ctx.addPromptBlock(mood);
        }
        if (!disabled.has('sticker')) {
          const sticker = buildStickerBlock(payload);
          if (sticker) ctx.addPromptBlock(sticker);
        }
        return '';
      }
    }
  };
}
