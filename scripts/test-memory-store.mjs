// 记忆存储/调度组件回归测试：node scripts/test-memory-store.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createPlugin } from '../plugins/qq-components/ctx-memory-store/index.js';

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('✅ ' + name); return; }
  failed += 1;
  console.error('❌ ' + name + (detail ? ' — ' + detail : ''));
};

const tmpRoot = fs.mkdtempSync(path.join(process.cwd(), '_tmp-memory-store-'));
const stateFile = path.join(tmpRoot, 'state', 'plugins', 'ctx-memory-store.json');
fs.mkdirSync(path.join(tmpRoot, 'state', 'plugins'), { recursive: true });

let store = {};
let wakes = [];
let sent = [];
const registeredTools = new Map();
const cfg = {
  enabled: true,
  updateIntervalMin: 60,
  maxChars: 4000,
  dailyDiary: { enabled: true, hour: 0, minute: 0, maxChars: 500 }
};
const ctx = {
  root: tmpRoot,
  config: {},
  log: () => {},
  warn: (m) => console.error('warn:', m),
  state: {
    get: () => store,
    set: (patch) => { store = { ...store, ...patch }; fs.writeFileSync(stateFile, JSON.stringify(store)); }
  },
  capabilities: {
    isConsoleConversationExcluded: key => key === 'group:10604',
    memoryConfig: () => cfg,
    listConversationKeys: () => ['private:1'],
    requestMemoryWrite: (key) => { wakes.push(key); return true; },
    sendNotification: (key, body, meta) => { sent.push({ key, body, meta }); return true; },
    sendSessionText: (key, body) => { sent.push({ key, body }); return true; }
  },
  registerTool: (name, spec) => registeredTools.set(name, spec)
};
const plugin = createPlugin(ctx);

// 读写 + 捕获
const wrote = plugin.services.memory.write({ key: 'private:1', text: '【客观陈述】\n- 测试\n【日记】\n今天吃饭了。' });
check('写入持久记忆', wrote > 0);
check('读取持久记忆', plugin.services.memory.read({ key: 'private:1' }).text.includes('今天吃饭了'));
check('提取日记', plugin.services.memory.diaryText({ key: 'private:1' }).includes('今天吃饭了'));
plugin.services.memory.write({ key: 'private:1', text: '【客观陈述】\n正文提到了【日记】这个词，但这里不是段标题。\n【日记】\n真正的日记正文。\n【用户画像】\n后续段落不应混入日记。' });
check('只从独立标题行提取日记正文', plugin.services.memory.diaryText({ key: 'private:1' }) === '真正的日记正文。');
const cap = plugin.services.memory.capture({ key: 'private:1', text: '前文 <MEMORY>【日记】\n新的日记内容</MEMORY> 后文' });
check('捕获 <MEMORY>', cap.matched === true && cap.chars > 0);
check('捕获后写盘', plugin.services.memory.read({ key: 'private:1' }).text.includes('新的日记内容'));
check('无 <MEMORY> 不写', plugin.services.memory.capture({ key: 'private:1', text: '普通回复' }).matched === false);

// 调度：首次 tick（已到日记点）先强制刷新记忆，刷新未完成前不立即发日记
const t0 = Date.now();
const pad2n = (n) => String(n).padStart(2, '0');
const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad2n(d.getMonth() + 1) + '-' + pad2n(d.getDate()); };
const today = dayOf(t0);
const priorDay = dayOf(t0 - 86_400_000);
await plugin.hooks.onTick({ now: t0 });
check('到点强制刷新记忆（1 次唤醒）', wakes.length === 1 && wakes[0] === 'private:1');
check('刷新未完成前不立即发旧日记', sent.length === 0);

// 模拟记忆回合写盘（AI 捕获 <MEMORY> 后由桥接调 memory.capture，刷新 mtime）
plugin.services.memory.capture({ key: 'private:1', text: '<MEMORY>【日记】\n刷新后的日记</MEMORY>' });

// 下一次 tick：记忆已刷新，发当日日记
await plugin.hooks.onTick({ now: t0 + 30_000 });
check('刷新后发送目标日日记及明确时间窗', sent.length === 1 && sent[0].body.includes(today + ' 日日记') && sent[0].body.includes(dayOf(t0 - 86_400_000) + ' 22:00 至 ' + today + ' 22:00') && sent[0].body.includes('刷新后的日记'));
const alreadySentResult = await plugin.services.memory.sendDiaryDetailed({ key: 'private:1', now: t0 + 30_000, day: today });
check('手动重试明确返回已发送且不重复投递', alreadySentResult.reason === 'already_sent' && alreadySentResult.lastDiaryDate === today && sent.length === 1);
check('日记状态显示插件登记的已发送日期', (await plugin.services.memory.diaryStatus({ key: 'private:1' })).lastDiaryDate === today);
const missingDiaryResult = await plugin.services.memory.sendDiaryDetailed({ key: 'private:404', now: t0, day: today });
check('缺少日记时返回明确原因', missingDiaryResult.reason === 'missing_diary');
plugin.services.memory.write({ key: 'private:1', text: '【日记】\nYESTERDAY_DIARY' });
const memFile = path.join(tmpRoot, 'state', 'memory', 'private_1.md');
const priorNoon = new Date(priorDay + 'T12:00:00');
fs.utimesSync(memFile, priorNoon, priorNoon);
const olderCatchUp = await plugin.services.memory.sendDiaryDetailed({ key: 'private:1', now: t0 + 40_000, day: priorDay });
check('较新的发送日期不会压掉更早缺失日记的补发', olderCatchUp.ok === true && sent.length === 2 && store.lastDiaryDate['private:1'] === today);

// 设定时间前的凌晨不得把“昨天”当成目标日记发送。
const earlyRoot = fs.mkdtempSync(path.join(process.cwd(), '_tmp-memory-early-'));
fs.mkdirSync(path.join(earlyRoot, 'state', 'plugins'), { recursive: true });
let earlyStore = {};
const earlySent = [];
const earlyConfig = { enabled: true, updateIntervalMin: 60, dailyDiary: { enabled: true, hour: 22, minute: 0 } };
const earlyPlugin = createPlugin({ root: earlyRoot, config: {}, log: () => {}, warn: () => {},
  state: { get: () => earlyStore, set: (patch) => { earlyStore = { ...earlyStore, ...patch }; } },
  capabilities: { memoryConfig: () => earlyConfig, listConversationKeys: () => ['private:early'],
    requestMemoryWrite: () => true, sendSessionText: (key, body) => { earlySent.push({ key, body }); return true; } } });
const earlyNow = new Date(2026, 0, 2, 1, 0, 0, 0).getTime();
const earlyYesterday = dayOf(earlyNow - 86_400_000);
earlyPlugin.services.memory.write({ key: 'private:early', text: '【日记】\nYESTERDAY_MUST_WAIT' });
const earlyMemoryFile = path.join(earlyRoot, 'state', 'memory', 'private_early.md');
const yesterdayEvening = new Date(earlyYesterday + 'T22:00:00');
fs.utimesSync(earlyMemoryFile, yesterdayEvening, yesterdayEvening);
earlyStore = { lastWriteAt: { 'private:early': earlyNow }, lastIncomingAt: { 'private:early': earlyNow } };
await earlyPlugin.hooks.onTick({ now: earlyNow });
check('每日发送时刻之前不发送昨天的日记', earlySent.length === 0 && !earlyStore.lastDiaryDate?.['private:early']);
fs.rmSync(earlyRoot, { recursive: true, force: true });

// 同一天不重复发
const sentBefore = sent.length;
await plugin.hooks.onTick({ now: t0 + 60_000 });
check('同一天不重复发日记', sent.length === sentBefore);

// ── 日记按天归档（每日历史留档 + 控制台查看）────────────────────────────
const archiveDir = path.join(tmpRoot, 'state', 'memory', 'diary');
const todayFile = path.join(archiveDir, today + '.md');
const writtenArchive = fs.existsSync(todayFile) ? fs.readFileSync(todayFile, 'utf8') : '';
check('发送成功后按天归档', writtenArchive.startsWith('# ' + today + ' 日记') && writtenArchive.includes('## private:1 ·') && writtenArchive.includes('刷新后的日记'));
check('发送成功后立即在日记归档标记发送时间', writtenArchive.includes('> 已发送：'));

await plugin.hooks.onTick({ now: t0 + 90_000 });
check('同一日期同一会话只归档一次', fs.readFileSync(todayFile, 'utf8') === writtenArchive);

fs.appendFileSync(todayFile, '\n## group:10604 · 22:00\nEXCLUDED_GROUP_DIARY\n');
const diaryHistory = await registeredTools.get('diary_history')?.handler({ limit: 10 });
const diaryRead = await registeredTools.get('diary_read')?.handler({ date: today });
check('日记历史左侧统计排除隐藏会话', diaryHistory?.ok === true && diaryHistory.dates.find(x => x.date === today)?.count === 1);
check('日记历史预览只保留可见会话内容', diaryRead?.ok === true && diaryRead.text.includes('刷新后的日记') && !diaryRead.text.includes('EXCLUDED_GROUP_DIARY') && !diaryRead.text.includes('group:10604'));

const listed = await registeredTools.get('diary_history')?.handler({ limit: 30 });
check('归档列表含 date/count/keys/chars', listed.ok === true && listed.dates.length === 2
  && listed.dates[0].date === today && listed.dates[0].count === 1 && listed.dates[0].keys[0] === 'private:1' && listed.dates[0].chars > 0);

const oneDay = plugin.services.memory.diaryArchiveRead({ date: today });
check('读取某一天归档', oneDay.ok === true && oneDay.date === today && oneDay.text.includes('刷新后的日记'));
const priorFile = path.join(archiveDir, priorDay + '.md');
fs.writeFileSync(priorFile, '# ' + priorDay + ' 日记\n\n## private:2 · 21:30\n已归档但尚未发送的日记\n', 'utf8');
const beforeCatchUp = sent.length;
const archiveOnlyStatus = await plugin.services.memory.diaryStatus({ key: 'private:2', day: priorDay });
check('仅有归档内容不冒充已确认发送', archiveOnlyStatus.sentForDay === false && archiveOnlyStatus.deliveryStatus === 'archive_only');
const archiveOnlyAutomatic = await plugin.services.memory.sendDiaryDetailed({ key: 'private:2', now: t0, day: priorDay });
check('仅有归档且无回执时默认阻止重复投递', archiveOnlyAutomatic.reason === 'archive_only' && sent.length === beforeCatchUp);
const archivedCatchUp = await plugin.services.memory.sendDiaryDetailed({ key: 'private:2', now: t0, day: priorDay, allowArchiveRetry: true });
check('人工确认后补发指定日期：读取归档并记录发送', archivedCatchUp.ok === true && sent.length === beforeCatchUp + 1
  && sent.at(-1).meta?.id === 'diary:private:2:' + priorDay && store.lastDiaryDate['private:2'] === priorDay);
const olderA = dayOf(t0 - 4 * 86_400_000), olderB = dayOf(t0 - 2 * 86_400_000);
fs.writeFileSync(path.join(archiveDir, olderA + '.md'), '# ' + olderA + ' 日记\n\n## private:3 · 20:00\nCATCHUP_A\n');
fs.writeFileSync(path.join(archiveDir, olderB + '.md'), '# ' + olderB + ' 日记\n\n## private:3 · 20:00\nCATCHUP_B\n');
fs.writeFileSync(path.join(archiveDir, today + '.md'), '# ' + today + ' 日记\n\n## private:3 · 20:00\nTODAY_IS_NOT_BACKLOG\n');
const catchUpStart = sent.length;
const catchUpAll = await plugin.services.memory.catchUpDiaries({ key: 'private:3', now: t0 });
check('补发仅遍历今天之前的未发送归档，按日期发送且允许日期不连续', catchUpAll.ok === true
  && catchUpAll.results.map((item) => item.day).join(',') === [olderA, olderB].sort().join(',')
  && sent.length === catchUpStart + 2 && sent.at(-2).meta?.id === 'diary:private:3:' + [olderA, olderB].sort()[0]
  && sent.at(-1).meta?.id === 'diary:private:3:' + [olderA, olderB].sort()[1]);
check('逐条补发后及时在对应归档标记发送时间', [olderA, olderB].every(day => fs.readFileSync(path.join(archiveDir, day + '.md'), 'utf8').includes('> 已发送：')));
const noDay = plugin.services.memory.diaryArchiveRead({ date: '2000-01-01' });
check('没有这一天的归档返回错误', noDay.ok === false && noDay.error === '没有这一天的归档');

// 回填 + 截断 + 列表排序 + 工具注册：独立 fixture（关掉每日发送，只走 onTick 回填）
const archiveRoot = fs.mkdtempSync(path.join(process.cwd(), '_tmp-memory-archive-'));
fs.mkdirSync(path.join(archiveRoot, 'state', 'plugins'), { recursive: true });
fs.mkdirSync(path.join(archiveRoot, 'state', 'memory', 'diary'), { recursive: true });
let store2 = {};
const cfg2 = { enabled: true, updateIntervalMin: 60, maxChars: 4000, dailyDiary: { enabled: false } };
const tools2 = {};
const plugin2 = createPlugin({
  root: archiveRoot,
  config: {},
  log: () => {},
  warn: (m) => console.error('warn2:', m),
  state: { get: () => store2, set: (patch) => { store2 = { ...store2, ...patch }; } },
  capabilities: {
    memoryConfig: () => cfg2,
    listConversationKeys: () => ['private:1', 'private:2'],
    requestMemoryWrite: () => true,
    sendSessionText: () => true
  },
  registerTool: (name, spec) => { tools2[name] = spec; }
});
const yesterday = dayOf(t0 - 86_400_000);
const yesterdayFile = path.join(archiveRoot, 'state', 'memory', 'diary', yesterday + '.md');
fs.writeFileSync(yesterdayFile, '# ' + yesterday + ' 日记\n\n## group:9 · 21:00\n别人的日记\n', 'utf8');
plugin2.services.memory.write({ key: 'private:1', text: '【客观陈述】\n- 测试\n【日记】\n昨天写的日记' });
store2 = { lastDiaryDate: { 'private:1': yesterday } };
await plugin2.hooks.onTick({ now: t0 });
const yesterdayText = fs.readFileSync(yesterdayFile, 'utf8');
check('回填缺失的归档（追加，不覆盖别的会话）', yesterdayText.includes('## group:9 ·') && yesterdayText.includes('## private:1 ·') && yesterdayText.includes('昨天写的日记'));
check('回填记录 key+day', !!store2.diaryBackfill && !!store2.diaryBackfill['private:1|' + yesterday]);
const yesterdayOnce = fs.readFileSync(yesterdayFile, 'utf8');
await plugin2.hooks.onTick({ now: t0 + 60_000 });
check('回填不会重复追加', fs.readFileSync(yesterdayFile, 'utf8') === yesterdayOnce);

const longDiary = '这是一段很长的日记。'.repeat(80);
plugin2.services.memory.write({ key: 'private:2', text: '【日记】\n' + longDiary });
cfg2.diaryArchive = { maxChars: 400 };
store2 = { ...store2, lastDiaryDate: { 'private:1': yesterday, 'private:2': today } };
await plugin2.hooks.onTick({ now: t0 + 120_000 });
const todayFile2 = path.join(archiveRoot, 'state', 'memory', 'diary', today + '.md');
const truncatedText = fs.existsSync(todayFile2) ? fs.readFileSync(todayFile2, 'utf8') : '';
check('超过 maxChars 截断并注明', truncatedText.includes('## private:2 ·') && truncatedText.includes('…（已截断）') && truncatedText.length <= 400);

const listed2 = plugin2.services.memory.diaryArchiveList({ limit: 1 });
check('列表按日期倒序且受 limit 限制', listed2.ok === true && listed2.dates.length === 1 && listed2.dates[0].date === today);
const listedAll = plugin2.services.memory.diaryArchiveList({ limit: 30 });
check('多天归档分别统计', listedAll.dates.length === 2 && listedAll.dates[0].date === today && listedAll.dates[1].date === yesterday && listedAll.dates[0].keys.includes('private:2'));

const toolList = tools2.diary_history ? await tools2.diary_history.handler({ limit: 60 }) : null;
check('注册 diary_history 工具', !!toolList && toolList.ok === true && toolList.dates.length === 2);
const toolRead = tools2.diary_read ? tools2.diary_read.handler({ date: today }) : null;
check('注册 diary_read 工具', !!toolRead && toolRead.ok === true && toolRead.text.includes('…（已截断）'));
const toolMissing = tools2.diary_read.handler({ date: '1999-12-31' });
check('diary_read 缺归档返回错误', toolMissing.ok === false && toolMissing.error === '没有这一天的归档');

const hiddenRoot = fs.mkdtempSync(path.join(process.cwd(), '_tmp-memory-hidden-'));
fs.mkdirSync(path.join(hiddenRoot, 'state', 'plugins'), { recursive: true });
fs.mkdirSync(path.join(hiddenRoot, 'state', 'memory', 'diary'), { recursive: true });
fs.writeFileSync(path.join(hiddenRoot, 'state', 'memory', 'diary', today + '.md'),
  '# ' + today + ' 日记\n\n## group:10604 · 08:00\nHIDDEN_GROUP_DIARY\n\n## private:1 · 09:00\nVISIBLE_PRIVATE_DIARY\n');
const hiddenTools = {};
createPlugin({
  root: hiddenRoot, config: {}, log: () => {}, warn: () => {}, state: { get: () => ({}), set: () => {} },
  capabilities: { memoryConfig: () => ({}), isConsoleConversationExcluded: (key) => key === 'group:10604',
    deliveryStatus: async () => ({ ok: true, status: 'sent', finishedAt: 1792990000000 }) },
  registerTool: (name, spec) => { hiddenTools[name] = spec; }
});
const visibleHistory = await hiddenTools.diary_history.handler({ limit: 10 });
const visibleArchive = await hiddenTools.diary_read.handler({ date: today });
check('控制台日记历史隐藏指定群并保留其他会话', visibleHistory.ok === true && visibleHistory.dates[0].keys.includes('private:1')
  && !visibleHistory.dates[0].keys.includes('group:10604') && visibleHistory.dates[0].count === 1);
check('控制台日记正文隐藏指定群内容', visibleArchive.ok === true && !visibleArchive.text.includes('10604')
  && !visibleArchive.text.includes('HIDDEN_GROUP_DIARY') && visibleArchive.text.includes('VISIBLE_PRIVATE_DIARY'));
check('日记历史显示成功回执时间戳', visibleHistory.dates[0].deliveries[0]?.status === 'sent'
  && visibleHistory.dates[0].deliveries[0]?.sentAt === 1792990000000);
fs.rmSync(hiddenRoot, { recursive: true, force: true });

fs.rmSync(archiveRoot, { recursive: true, force: true });
fs.rmSync(tmpRoot, { recursive: true, force: true });

// bridge 回归：捕获/读写/调度都应交给组件
const bridge = fs.readFileSync('src/bridge.js', 'utf8');
check('bridge 不再解析 <MEMORY>', !bridge.includes('const memMatch'));
check('bridge 捕获改调服务', bridge.includes("callService('memory', 'capture'"));
check('bridge 读写委托服务', bridge.includes("callService('memory', 'read'") && bridge.includes("callService('memory', 'write'"));
check('bridge 调度改为组件负责', bridge.includes('调度已由 ctx-memory-store 组件'));
check('bridge 暴露记忆能力', ['taskCaps.memoryConfig', 'taskCaps.listConversationKeys', 'taskCaps.requestMemoryWrite'].every((k) => bridge.includes(k)));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n记忆存储/调度组件测试通过');
