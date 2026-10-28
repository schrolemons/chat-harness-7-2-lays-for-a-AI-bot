// 每日工作总结插件回归测试：node scripts/test-daily-worklog.mjs
//
// 在仓库根建一个临时 root（模拟 state/ 数据），跑插件 onTick，验证：
//  - 到点后会生成 state/memory/worklog/<日期>.md
//  - 日报里包含任务会话、进度记录、工具调用、token 用量四类数据
//  - 同一天不会重复生成（幂等）
// 注意：真实仓库的 state/ 目录 ACL 收紧过，普通进程写不进去；所以测试必须用临时 root。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlugin } from '../plugins/qq-components/life-daily-worklog/index.js';
import { dateKeyLocal } from '../plugins/qq-components/life-daily-worklog/worklog.js';

const tmpRoot = fs.mkdtempSync(path.join(process.cwd(), '_tmp-worklog-'));
const stateDir = path.join(tmpRoot, 'state');
const memoryDir = path.join(stateDir, 'memory');
fs.mkdirSync(memoryDir, { recursive: true });

const today = dateKeyLocal(new Date());
const [y, m, d] = today.split('-');

// 1) 中期进度：一条今天的、一条昨天的（昨天的应被过滤）
fs.writeFileSync(path.join(memoryDir, 'tasks-private_608.md'), [
  `## [2026/1/1 00:00:00]`,
  '旧的一天，不该出现在今天的日报里。',
  `## [${y}/${Number(m)}/${Number(d)} 17:32:38]`,
  '17:30-17:35 修好了 campus-watch 掉线问题，并补了日报。',
  ''
].join('\n'));

// 2) 任务会话（用「今天中午」的时间戳，避免跑在午夜附近时被日期过滤掉）
const todayNoon = new Date();
todayNoon.setHours(12, 0, 0, 0);
fs.writeFileSync(path.join(stateDir, 'tasks.json'), JSON.stringify({
  tasks: {
    't-test1': {
      id: 't-test1', title: '测试任务：统计代码量', status: 'done',
      createdAt: todayNoon.getTime() - 3600_000, updatedAt: todayNoon.getTime(),
      sessionId: 'session-x', result: '统计完成，29 个 js 文件。', error: ''
    }
  }
}));

// 3) 工具调用：一次成功、一次失败
const nowIso = new Date().toISOString();
fs.writeFileSync(path.join(stateDir, 'tool-calls.jsonl'), [
  JSON.stringify({ type: 'call', time: nowIso, key: 'private:10608', tool: 'qq_send_message' }),
  JSON.stringify({ type: 'result', time: nowIso, key: 'private:10608', tool: 'qq_send_message', ok: true }),
  JSON.stringify({ type: 'call', time: nowIso, key: 'private:10608', tool: 'qq_wait_for_messages' }),
  JSON.stringify({ type: 'result', time: nowIso, key: 'private:10608', tool: 'qq_wait_for_messages', ok: false, error: 'boom' }),
  ''
].join('\n'));

// 4) token 用量
fs.writeFileSync(path.join(stateDir, 'token-usage.jsonl'), [
  JSON.stringify({ k: 'turn', t: Date.now(), sid: 'session-x', key: 'private:10608', model: 'deepseek-flash', b: { cacheMiss: 100, cacheHit: 900, output: 50 } }),
  ''
].join('\n'));

const store = {};
const tools = new Map();
const ctx = {
  config: { hour: 0, minute: 0, sendToOwner: false, maxChars: 6000 },
  root: tmpRoot,
  state: { get: () => store, set: (patch) => Object.assign(store, patch) },
  log: () => {},
  warn: (msg) => console.error('warn:', msg),
  registerTool: (name, spec) => tools.set(name, spec),
  capabilities: { isConsoleConversationExcluded: key => key === 'group:10604' }
};

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('✅ ' + name); return; }
  failed += 1;
  console.error('❌ ' + name + (detail ? ' — ' + detail : ''));
};

const plugin = createPlugin(ctx);
const file = path.join(stateDir, 'memory', 'worklog', today + '.md');
plugin.hooks.onTick({ now: Date.now() });
check('到点后生成日报文件', fs.existsSync(file));
const md = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
check('包含今天的进度记录', md.includes('campus-watch 掉线问题'));
check('过滤掉昨天的进度', !md.includes('旧的一天'));
check('包含任务会话', md.includes('测试任务：统计代码量') && md.includes('[完成]'));
check('包含工具调用统计', md.includes('工具调用：2 次') && md.includes('失败 1 次'));
check('包含 token 用量', md.includes('Token 用量') && md.includes('deepseek-flash'));
check('统计标题正确', md.startsWith('# ' + today + ' 工作总结'));

// 手动生成工具（/api/plugins/call 会用到）
check('注册了 worklog_generate 工具', tools.has('worklog_generate'));
check('注册了只读 worklog_history 工具', tools.has('worklog_history'));
if (tools.has('worklog_generate')) {
  const out = await tools.get('worklog_generate').handler({ date: today });
  check('worklog_generate 返回 ok', out && out.ok === true, JSON.stringify(out));
  check('worklog_generate 写对路径', out && out.file === 'state/memory/worklog/' + today + '.md');
}
if (tools.has('worklog_history')) {
  const beforeRead = fs.statSync(file).mtimeMs;
  const history = await tools.get('worklog_history').handler({});
  check('日报历史只返回日期和元信息', history?.ok === true && history.reports?.some(x => x.date === today && x.chars > 0));
  const preview = await tools.get('worklog_history').handler({ date: today });
  check('可读取指定日报预览', preview?.ok === true && preview.date === today && preview.text?.includes('工作总结'));
  const invalid = await tools.get('worklog_history').handler({ date: '../tasks.json' });
  check('拒绝目录穿越日期', invalid?.ok === false);
  const invalidCalendarDate = await tools.get('worklog_history').handler({ date: '2026-99-99' });
  check('拒绝无效日历日期', invalidCalendarDate?.ok === false);
  check('读取历史不改写日报文件', fs.statSync(file).mtimeMs === beforeRead);
  const filteredDate = '2026-10-23';
  const filteredFile = path.join(stateDir, 'memory', 'worklog', filteredDate + '.md');
  fs.writeFileSync(filteredFile, [
    `# ${filteredDate} 工作总结`,
    '- 模型调用：20 步，输入 1000 tokens，输出 100 tokens',
    '## 五、Token 用量',
    '| 会话 | 步数 | 输入 | 输出 |',
    '| group:10604 | 10 | 800 | 80 |',
    '| private:10608 | 10 | 200 | 20 |',
    ''
  ].join('\n'));
  const filtered = await tools.get('worklog_history').handler({ date: filteredDate });
  check('排除会话不会导致整份日报预览丢失', filtered?.ok === true && filtered.text.includes('工作总结') && !filtered.text.includes('group:10604'));
  check('排除会话对应的汇总与明细不出现在预览', !filtered.text.includes('模型调用') && !filtered.text.includes('Token 用量'));
}

// 幂等：第二次 onTick 不应重写（文件 mtime 不变）
const before = fs.statSync(file).mtimeMs;
await new Promise((r) => setTimeout(r, 20));
plugin.hooks.onTick({ now: Date.now() });
check('同一天不重复生成', fs.statSync(file).mtimeMs === before);

fs.rmSync(tmpRoot, { recursive: true, force: true });
if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n每日工作总结插件测试通过');
