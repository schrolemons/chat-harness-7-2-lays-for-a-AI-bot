// 双击修复 SnowLuma（哈希锁死版）
//
// 用法：双击 patch-snowluma.bat，或 `node scripts/patch-snowluma.mjs`。
// 原理：只对「特定 SHA256 的 SnowLuma index.mjs」应用补丁；哈希对不上就停手，
//       提示「SnowLuma 已更新，需要调整本脚本」，绝不对新版本乱打补丁。
//
// 当前锁定的版本：SnowLuma 2.1.1（win32-x64），index.mjs SHA256 = E23E…
// 修复目标：私聊「引用」跨天串引 bug。
//   SnowLuma 用「被引消息 clientSeq + 会话」算 targetId（不含时间），跨天 clientSeq 复用会撞同一个 id；
//   backfillReplyTarget 里 `if (findEvent(targetId)) return;` 命中旧消息就直接跳过回填，导致 get_msg 吐昨晚旧消息。
// 补丁做法：回填前先比一下「已存消息时间」和「被引消息时间」，差 >6 小时就判为串引，继续回填覆盖。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── 配置区 ──────────────────────────────────────────────
const SNOWLUMA_DIR = process.env.SNOWLUMA_DIR || 'C:/example-workspace/Desktop/USTC GIT/DSH BOT/SnowLuma-v2.1.1-win-x64';
const TARGET_FILE = 'index.mjs';
const EXPECTED_SHA256 = 'E23ED3D4AA7E01E7F45400A7FFE6B0C4B67BB6D011F776F2FD04B959510435E6';

// 每项：{ find: '旧代码串', replace: '新代码串', note: '修什么' }
const PATCHES = [
  {
    // 唯一命中的那一行：\tif (await ref.messageStore.findEvent(targetId)) return;\n
    find: '\tif (await ref.messageStore.findEvent(targetId)) return;\n',
    replace:
      '\tconst _prevStored = await ref.messageStore.findEvent(targetId);\n' +
      '\tif (_prevStored) {\n' +
      '\t\tconst _qt = reply?.replyTime && reply.replyTime > 0 ? reply.replyTime : event.time;\n' +
      '\t\tif (typeof _prevStored.time === "number" && Math.abs(_prevStored.time - _qt) < 21600) return;\n' +
      '\t}\n',
    note: 'reply 回填：跨天 clientSeq 撞 id 时不轻信旧消息，时间差 >6h 则重新回填覆盖',
  },
];
// ────────────────────────────────────────────────────────

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
}

const file = path.join(SNOWLUMA_DIR, TARGET_FILE);
if (!fs.existsSync(file)) {
  console.error(`找不到 SnowLuma 文件：${file}`);
  console.error('请设置环境变量 SNOWLUMA_DIR 指向 SnowLuma 安装目录后重试。');
  process.exit(1);
}

const buf = fs.readFileSync(file);
const actual = sha256(buf);
console.log(`SnowLuma: ${file}`);
console.log(`期望 SHA256: ${EXPECTED_SHA256}`);
console.log(`实际 SHA256: ${actual}`);

if (actual !== EXPECTED_SHA256) {
  console.error('\n✗ 哈希不匹配：SnowLuma 文件已更新（或路径不对）。');
  console.error('  为防止对新版本打错补丁，脚本已停手，未做任何修改。');
  console.error('  请更新本脚本里的 EXPECTED_SHA256 和 PATCHES 后再试。');
  process.exit(2);
}

if (!PATCHES.length) {
  console.error('\n✗ 还没有可应用的补丁（PATCHES 为空）。');
  console.error('  补丁内容待定位到 reply 段 id 映射 bug 后填入。');
  process.exit(3);
}

let content = buf.toString('utf8');
let applied = 0;
for (const p of PATCHES) {
  const idx = content.indexOf(p.find);
  if (idx < 0) {
    console.error(`\n✗ 未找到待替换片段（${p.note || p.find.slice(0, 40)}），已中止，未修改文件。`);
    process.exit(4);
  }
  content = content.replaceAll(p.find, p.replace);
  applied += 1;
  console.log(`✓ 应用补丁：${p.note || p.find.slice(0, 40)}`);
}

// 先备份，再写回
const bak = file + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(bak, buf);
fs.writeFileSync(file, content, 'utf8');
console.log(`\n完成：共 ${applied} 处补丁，原文件备份到 ${bak}`);
console.log('重启 SnowLuma 生效。');
