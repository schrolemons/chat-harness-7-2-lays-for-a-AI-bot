// ctx-context-runtime（C 层｜参与度 + 时间感）
//
// 从 buildWakePromptV2 搬走：
//   · 【参与度参考】我这一小时说了几次 / 群里热不热 / 该不该接
//   · 【时间感】最近一条来信多久前、什么钟点，按“实时/可接/别接”分档提示
//
// 桥接只传 st、directUnread（确实在找“你/AI”的未读数）、wake 配置；
// 参与度复用纯统计；时间感策略由本组件拥有，不决定唤醒和结束。

import { buildParticipation } from '../../../src/context-runtime.js';
const timeURL = new URL('./time-sense.mjs', import.meta.url); timeURL.search = new URL(import.meta.url).search;
const {buildTimeSense} = await import(timeURL.href);

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const disabled = new Set(Array.isArray(cfg.disabledBlocks) ? cfg.disabledBlocks.map(String) : []);
  return {
    hooks: {
      beforePrompt(payload = {}) {
        if (/^(memoryWrite|selfReview|selfOptimize|userFeedbackReview|slangLearn)$/.test(String(payload?.reason||''))) return '';
        if (!disabled.has('participation') && payload.isPrivate !== true && !String(payload.key || '').startsWith('private:')) {
          const p = buildParticipation(payload.st, Number(payload.directUnread) || 0);
          if (p) ctx.addPromptBlock(p);
        }
        if (!disabled.has('timeSense')) {
          const t = buildTimeSense(payload.st, payload.wakeConfig || {});
          if (t) ctx.addPromptBlock(t);
        }
        return '';
      }
    }
  };
}
