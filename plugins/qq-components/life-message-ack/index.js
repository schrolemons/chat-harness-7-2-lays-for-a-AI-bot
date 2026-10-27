// life-message-ack（L 层｜未回复补话）
// 话术和激活参数由组件配置；bridge 只负责计时、校验投递条件和发送。

const GROUPS = {
  privateWait: { delayMs: 8000, lines: [] },
  privateApology: { delayMs: 8300, lines: [] },
  groupWait: { delayMs: 8000, lines: [] },
  groupApology: { delayMs: 8300, lines: [] }
};

function cleanLines(value) {
  if (!Array.isArray(value)) return [];
  return value.map((line) => String(line ?? '').trim()).filter(Boolean).slice(0, 100);
}

function normalizeGroup(value, fallback) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const delay = Number(input.delayMs);
  const lines = Array.isArray(input.lines) ? cleanLines(input.lines) : fallback.lines;
  return {
    enabled: input.enabled !== false,
    delayMs: Number.isFinite(delay) ? Math.max(0, Math.min(600000, Math.round(delay))) : fallback.delayMs,
    lines
  };
}

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  return {
    services: {
      messageAck: {
        plan({ key = '' } = {}) {
          const isPrivate = String(key).startsWith('private:');
          const first = normalizeGroup(cfg[isPrivate ? 'privateWait' : 'groupWait'], GROUPS[isPrivate ? 'privateWait' : 'groupWait']);
          const apology = normalizeGroup(cfg[isPrivate ? 'privateApology' : 'groupApology'], GROUPS[isPrivate ? 'privateApology' : 'groupApology']);
          const choose = (lines) => lines.length ? lines[Math.floor(Math.random() * lines.length)] : '';
          return {
            wait: { enabled: first.enabled && first.lines.length > 0, delayMs: first.delayMs, text: choose(first.lines) },
            apology: { enabled: apology.enabled && apology.lines.length > 0, delayMs: apology.delayMs, text: choose(apology.lines) }
          };
        }
      }
    }
  };
}
