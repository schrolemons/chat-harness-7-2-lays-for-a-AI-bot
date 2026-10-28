// bridge.js 提示词迁移看板：列出仍内联在桥接里的用户可见提示词字面量。
// 用法：node scripts/audit-bridge-prompt.mjs
// 只提示、不阻断（退出码始终 0），用于决定下一批要搬哪个组件。
import fs from 'node:fs';

const FILE = 'src/bridge.js';
const text = fs.readFileSync(FILE, 'utf8');
const lines = text.split(/\r?\n/);

// 以「【xxx】」开头的话术片段（单行内），或者含常见指令关键词的长中文字符串
const PROMPT_RE = /【[^】]{2,40}】/;
const KEYWORDS = /(你|请|不要|记得|回复|发送|调用|工具|当|如果|先|然后).{6,}/;
const hits = [];

lines.forEach((line, i) => {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*')) return;
  if (!/['"`]/.test(line)) return;
  if (!PROMPT_RE.test(line) && !(KEYWORDS.test(line) && /[\u4e00-\u9fa5]{8,}/.test(line))) return;
  // 忽略纯日志/错误文案（log/sendJson/throw/Error 等）
  if (/^\s*(log|console|sendJson|throw|warn|res\.end|res\.writeHead)/.test(t)) return;
  const m = PROMPT_RE.exec(line);
  const marker = m ? m[0] : t.slice(0, 24);
  hits.push({ line: i + 1, marker, snippet: t.slice(0, 120) });
});

const groups = new Map();
for (const h of hits) {
  const key = h.marker;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(h);
}

console.log(`bridge.js 行数：${lines.length}`);
console.log(`疑似仍内联的提示词片段：${hits.length} 处（${groups.size} 组）\n`);
for (const [key, list] of groups) {
  console.log(`${key}  ×${list.length}  行：${list.map((x) => x.line).join(', ')}`);
  console.log('   ' + list[0].snippet.replace(/\s+/g, ' '));
}
console.log('\n提示：新能力请写成 plugins/qq-components/<id>/ 组件；桥接只保留钩子/能力/收发。见 AGENTS.md。');
