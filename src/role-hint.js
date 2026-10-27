// 角色卡提示词清洗（纯函数）：从 bridge.js 的 currentRoleHintV2 内部逻辑抽出。
//
// 规则：
//   · 二代模式去掉第一代专属指令行（[SILENT] / 空格分条 / 自动转发等）；
//   · 「回复示例」小节里的中文空格改写为「，」，避免示例被桥接当成多条消息；
//   · 其余行原样保留。

import { GEN1_ROLE_LINE_RE } from './role-card.js';

function isCjkLikeChar(ch) {
  if (!ch) return false;
  const code = ch.codePointAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3000 && code <= 0x303f)
  );
}

// 空格两侧只要有一侧是中文/全角标点，且另一侧不是 / \ ( ) [ ] { } " ' < > | 等符号，就转成中文逗号。
const NO_REPLACE = new Set(['/', '\\', '(', ')', '[', ']', '{', '}', '"', "'", '<', '>', '|', '&', '=', ':', ';', ',', '.', '。', '，', '、']);

export function convertExampleSpacesToComma(line) {
  const chars = Array.from(String(line ?? ''));
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === ' ' || ch === '\t') {
      const prev = chars[i - 1];
      const next = chars[i + 1];
      const prevCjk = !!prev && isCjkLikeChar(prev);
      const nextCjk = !!next && isCjkLikeChar(next);
      const prevBlocked = !!prev && NO_REPLACE.has(prev);
      const nextBlocked = !!next && NO_REPLACE.has(next);
      if ((prevCjk || nextCjk) && !prevBlocked && !nextBlocked) {
        out += '，';
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** 二代模式专用角色卡清洗。 */
export function cleanRoleHint(raw) {
  const text = String(raw || '');
  if (!text) return '';
  const lines = text.split('\n');
  const kept = [];
  let inExampleSection = false;
  for (const line of lines) {
    if (/^##\s*.*回复示例/.test(line)) {
      inExampleSection = true;
      kept.push(line.replace(/（空格就是多条消息的意思）/g, '（示例：用多条表示停顿，别分多条发出去）'));
      continue;
    }
    if (inExampleSection && /^##\s/.test(line)) {
      inExampleSection = false;
    }
    if (inExampleSection) {
      kept.push(convertExampleSpacesToComma(line));
    } else if (!GEN1_ROLE_LINE_RE.test(line)) {
      kept.push(line);
    }
  }
  return kept.join('\n');
}
