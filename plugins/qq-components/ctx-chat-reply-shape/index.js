// 回复形态插件：把 reply-shape.js 的判定搬进插件目录，桥接只负责把上下文递过来。

import { planReplyShape } from '../../../src/reply-shape.js';
import { createTurnPolicy } from '../schnie-core/turn-policy.mjs';

const NON_CHAT_REASONS = /^(selfReview|selfOptimize|memoryWrite|timeBubble|startupGreeting|reminder|newFriend|newsShare|careCheck|idleRescue|proactiveCheck|replyCheck)/;

export function createPlugin(ctx) {
  const phi = createTurnPolicy(ctx);
  const cfg = ctx.config || {};
  return {
    hooks: {
      beforePrompt(payload) {
        if (phi(payload).mode !== 'off') return '【本轮节奏】认真回应当前问题，最多1条完整消息，不拆成零碎多条，不带表情。';
        if (payload?.reason && NON_CHAT_REASONS.test(String(payload.reason))) return '';
        const plan = planReplyShape({
          state: payload?.st,
          incomingText: payload?.incomingText || '',
          mood: payload?.mood,
          moodLowThreshold: payload?.moodLowThreshold,
          config: cfg,
          now: Date.now()
        });
        if (!plan || !plan.line) return '';
        ctx.state.set({ last: { kind: plan.kind, maxMessages: plan.maxMessages, at: Date.now() } });
        return plan.line;
      }
    }
  };
}
