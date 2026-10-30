// 表情候选插件：桥接把「这轮允许发吗、有哪些表情、最近发过哪些」递进来，
// 插件用 sticker-picker.js 打分，只产出候选列表，不发送、不改表情开关。

import { pickStickers } from '../../../src/sticker-picker.js';
import { planReplyShape } from '../../../src/reply-shape.js';
import { createTurnPolicy } from '../personal-core/turn-policy.mjs';

const NON_CHAT_REASONS = /^(selfReview|selfOptimize|userFeedbackReview|memoryWrite|timeBubble|startupGreeting|reminder|newFriend|newsShare|careCheck|idleRescue|proactiveCheck|replyCheck)/;

export function createPlugin(ctx) {
  const referencePolicy = createTurnPolicy(ctx);
  const cfg = ctx.config || {};
  return {
    hooks: {
      beforePrompt(payload) {
        if (referencePolicy(payload).mode !== 'off') return '';
        if (payload?.reason && NON_CHAT_REASONS.test(String(payload.reason))) return '';
        if (payload?.stickerAllowed === false) return '';
        const entries = Array.isArray(payload?.stickerEntries) ? payload.stickerEntries : [];
        if (!entries.length) return '';
        const shape = payload?.replyPlan || {kind:'serious'};
        const pick = pickStickers({
          entries,
          incomingText: payload?.incomingText || '',
          recentStickerIds: Array.isArray(payload?.recentStickerIds) ? payload.recentStickerIds : [],
          serious: shape.kind === 'serious',
          limit: Number(cfg.limit) || 3,
          now: Date.now()
        });
        if (!pick || !pick.line) return '';
        ctx.state.set({ last: { picks: pick.picks.map((p) => p.entry.desc || p.entry.localNote || p.entry.id), at: Date.now() } });
        return pick.line;
      }
    }
  };
}
