// ctx-context-runtime（C 层｜参与度 + 时间感）
//
// 从 buildWakePromptV2 搬走：
//   · 【参与度参考】我这一小时说了几次 / 群里热不热 / 该不该接
//   · 【时间感】最近一条来信多久前、什么钟点，按“实时/可接/别接”分档提示
//
// 桥接只传 st、directUnread（确实在找“你/AI”的未读数）、wake 配置；
// 文案与判断在 src/context-runtime.js 纯函数里，组件负责产出块。

import { buildParticipation, buildTimeSense } from '../../../src/context-runtime.js';

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const disabled = new Set(Array.isArray(cfg.disabledBlocks) ? cfg.disabledBlocks.map(String) : []);
  return {
    hooks: {
      beforePrompt(payload = {}) {
        if (/^(memoryWrite|selfReview|selfOptimize|slangLearn)$/.test(String(payload?.reason||''))) return '';
        if (!disabled.has('participation')) {
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
