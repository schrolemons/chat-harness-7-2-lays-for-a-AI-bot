// 会话推进插件：把 conversation-drive.js 的判定从桥接主程序搬进插件目录。
// 插件只负责「这一轮要不要追问/起话题」，判定逻辑仍是仓库里的 conversation-drive 模块，
// 好处是：可以单独改概率、单独停用、单独看效果，不用动 bridge.js。

import { planConversationDrive } from '../../../src/conversation-drive.js';
import { createTurnPolicy } from '../schnie-core/turn-policy.mjs';

const NON_CHAT_REASONS = /^(selfReview|selfOptimize|memoryWrite|timeBubble|startupGreeting|reminder|newFriend|newsShare|careCheck|idleRescue|proactiveCheck|replyCheck)/;

export function createPlugin(ctx) {
  const phi = createTurnPolicy(ctx);
  const cfg = ctx.config || {};
  return {
    hooks: {
      beforePrompt(payload) {
        if (phi(payload).mode !== 'off') return '';
        if (payload?.reason && NON_CHAT_REASONS.test(String(payload.reason))) return '';
        const st = payload?.st;
        if (!st) return '';
        const plan = planConversationDrive({
          state: st,
          config: cfg,
          now: Date.now(),
          isGroup: String(payload?.key || '').startsWith('group:')
        });
        if (!plan || plan.kind === 'none' || !plan.line) return '';
        if (typeof payload.patchSession === 'function') payload.patchSession(plan.patch || {});
        return plan.line;
      }
    }
  };
}
