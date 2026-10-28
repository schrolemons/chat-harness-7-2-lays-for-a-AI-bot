// 记忆注入组件回归测试：node scripts/test-memory-context.mjs
import fs from 'node:fs';
import { createPlugin } from '../plugins/qq-components/ctx-memory-context/index.js';
import { createPlugin as createMemoryUpdatePlugin } from '../plugins/qq-components/ctx-memory-update/index.js';
import { createPluginHost } from '../src/plugin-host.js';

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('✅ ' + name); return; }
  failed += 1;
  console.error('❌ ' + name + (detail ? ' — ' + detail : ''));
};

function build(payload, config = {}) {
  const blocks = [];
  const ctx = { config, promptBlocks: blocks, addPromptBlock: (t) => blocks.push(String(t)) };
  createPlugin(ctx).hooks.beforePrompt(payload);
  return blocks;
}

const st = {
  activeTopics: [{ text: '周末去哪玩', lastMentionAt: Date.now() - 5 * 60 * 1000, pendingQuestion: '要不要去爬山' }],
  pendingThoughts: [{ text: '想问问他加班到几点', motivation: 'curiosity' }],
  memberImpressions: { 管理员: { traits: ['爱吃肉', '话多'], interactionCount: 7 } }
};
const blocks = build({
  st,
  persistentMemory: { text: '【客观陈述】\n- 今天修了桥接', updatedAt: Date.now() - 3600_000 },
  midTermText: '## [2026/10/25 23:00]\n23:00 完成记忆注入组件化',
  maxChars: 4000
});

const all = blocks.join('\n\n');
check('轻量记忆：话题', all.includes('【进行中的话题】') && all.includes('周末去哪玩'));
check('轻量记忆：想说未说', all.includes('【想说还没说的】') && all.includes('加班到几点'));
check('轻量记忆：群友印象', all.includes('【对本会话未发言成员的临时印象】') && all.includes('爱吃肉'));
check('长期记忆注入', all.includes('【持久化记忆（长期）】') && all.includes('今天修了桥接'));
check('中期记忆注入', all.includes('【中期记忆·任务进度') && all.includes('记忆注入组件化'));
check('分段压入', blocks.length >= 3, 'blocks=' + blocks.length);

const long = build({ st: {}, persistentMemory: { text: 'x'.repeat(9000), updatedAt: 0 }, midTermText: 'y'.repeat(5000), maxChars: 4000 });
const longText = long.join('\n');
check('长期记忆按 maxChars 截断', longText.includes('x'.repeat(4000)) && !longText.includes('x'.repeat(4001)));
check('中期记忆按 slice 截断', longText.includes('y'.repeat(1500)) && !longText.includes('y'.repeat(1501)));

check('无数据时不注入', build({ st: {} }).length === 0);

const host = createPluginHost({ root: process.cwd(), capabilities: {} });
const summary = await host.loadAll();
check('插件宿主加载（至少 27 个）', summary.count >= 27, 'count=' + summary.count);
check('宿主加载无警告', summary.warnings.length === 0, JSON.stringify(summary.warnings));
const hostBlocks = host.collectPromptBlocks({
  key: 'private:1',
  st,
  persistentMemory: { text: '长期记忆内容', updatedAt: Date.now() },
  midTermText: '中期记忆内容',
  maxChars: 4000
});
const hostText = hostBlocks.join('\n');
check('宿主 collectPromptBlocks 注入记忆', hostText.includes('长期记忆内容') && hostText.includes('中期记忆内容') && hostText.includes('周末去哪玩'));

const memoryUpdate = createMemoryUpdatePlugin({ config: { maxChars: 4000 } }).hooks.beforePrompt({ reason: 'memoryWrite' });
check('持久化记忆偏向可核对的行为与经历', /可核对.{0,12}(行为|经历)|谁.{0,10}(做了什么|说了什么)/s.test(memoryUpdate));
check('细腻偏好和边界归人物档案', /(偏好|回避项).{0,30}人物档案|人物档案.{0,30}细腻/s.test(memoryUpdate));
check('未做事项与习惯归人物档案', /未做|没做|习惯/.test(memoryUpdate));
check('记忆格式标签保留', ['<MEMORY>', '【客观陈述】', '【重要信息】', '【用户画像】', '【日记】', '</MEMORY>'].every((x) => memoryUpdate.includes(x)));
check('记忆写入仍受长度上限约束', memoryUpdate.includes('不超过 4000 字'));
check('日记日期明确表示前一日 22 点至命名日当晚 22 点窗口', /前一日.{0,16}22:00.{0,30}XX 日当晚 22:00/s.test(memoryUpdate));

const bridge = fs.readFileSync('src/bridge.js', 'utf8');
for (const marker of ['memoryLine', 'persistMemoryLine', 'midTermLine', 'const memoryText = formatMemoryV2']) {
  check('bridge 已移除 ' + marker, !bridge.includes(marker));
}
check('bridge payload 传 persistentMemory/midTermText', bridge.includes('persistentMemory: readPersistMemoryV2(key)') && bridge.includes('midTermText: readTaskNotesV2(key).trim()'));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n记忆注入组件测试通过');
