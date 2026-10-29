import { readConsoleTestSource } from './console-test-source.mjs';
// 日程工具/提醒调度组件回归测试：node scripts/test-schedule-reminder.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createPlugin } from '../plugins/qq-components/life-schedule-reminder/index.js';
import { bridgeHarness } from './audit-bridge-harness.mjs';
import './test-schedule-display.mjs';

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('✅ ' + name); return; }
  failed += 1;
  console.error('❌ ' + name + (detail ? ' — ' + detail : ''));
};

const tmpRoot = fs.mkdtempSync(path.join(process.cwd(), '_tmp-schedule-reminder-'));
fs.mkdirSync(path.join(tmpRoot, 'state', 'plugins'), { recursive: true });
const stateFile = path.join(tmpRoot, 'state', 'plugins', 'life-schedule-reminder.json');
let store = {};
const persist = () => fs.writeFileSync(stateFile, JSON.stringify(store));

let wakes = [];
let wakeAllowed = true;
const ctx = {
  root: tmpRoot,
  config: { enabled: true, advanceMinutes: 30, lateMinutes: 120, horizonDays: 14, maxItems: 200, maxPromptItems: 8 },
  log: () => {},
  warn: (m) => console.error('warn:', m),
  state: {
    get: () => JSON.parse(JSON.stringify(store)),
    set: (patch) => { store = { ...store, ...patch }; persist(); }
  },
  capabilities: {
    requestReminderWake: (key, items) => { if (!wakeAllowed) return false; wakes.push({ key, items }); return true; }
  },
  promptBlocks: [],
  addPromptBlock: (t) => ctx.promptBlocks.push(String(t))
};

const plugin = createPlugin(ctx);
const S = plugin.services.schedules;

// ── 解析与登记 ────────────────────────────────────────────────────────────
const f = (n) => String(n).padStart(2, '0');
const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const soonISO = soon.getFullYear() + '-' + f(soon.getMonth() + 1) + '-' + f(soon.getDate()) + 'T14:30:00+08:00';

const added = S.add({ key: 'group:1', title: '计算机系统大作业截止', when: soonISO, place: 'bb 平台', detail: '满分 20', repeat: 'none' });
check('add：ISO 带时区登记成功', added.ok === true && added.item && added.item.title === '计算机系统大作业截止');
check('add：dueAt 是具体时刻', Number.isFinite(added.item.dueAt) && new Date(added.item.dueAt).getMinutes() === 30);
const id1 = added.item.id;

const dup = S.add({ key: 'group:1', title: '计算机系统大作业截止', when: soonISO });
check('add：同一条日程去重', dup.ok === true && dup.duplicated === true);

const localWhen = (() => {
  const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  return d.getFullYear() + '-' + f(d.getMonth() + 1) + '-' + f(d.getDate()) + ' 08:15';
})();
const localAdded = S.add({ key: 'group:1', title: '早八实验', when: localWhen });
check('add：YYYY-MM-DD HH:MM 按本地时间解析', localAdded.ok === true && new Date(localAdded.item.dueAt).getHours() === 8 && new Date(localAdded.item.dueAt).getMinutes() === 15);

const dateOnlyWhen = (() => {
  const d = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
  return d.getFullYear() + '-' + f(d.getMonth() + 1) + '-' + f(d.getDate());
})();
const dateOnly = S.add({ key: 'group:1', title: '只有日期的活动', when: dateOnlyWhen });
check('add：只有日期 → 当天 09:00', dateOnly.ok === true && new Date(dateOnly.item.dueAt).getHours() === 9);

check('add：时间解析失败要明确报错', S.add({ key: 'group:1', title: '含糊的事', when: '下周吧' }).ok === false);
check('add：空标题要拒绝', S.add({ key: 'group:1', title: '  ', when: soonISO }).ok === false);
check('add：key 不合法要拒绝', S.add({ key: 'nope', title: 'x', when: soonISO }).ok === false);
const past = S.add({ key: 'group:1', title: '昨天的事', when: '2020-01-01 09:00' });
check('add：过去时间要拒绝', past.ok === false);
check('add：repeat 归一化（每天）', S.add({ key: 'group:1', title: '每天喝水', when: localWhen, repeat: '每天' }).item.repeat === 'daily');
const intervalDefault = S.add({ key: 'group:1', title: '默认周期', when: soonISO });
check('add：未指定间歇周期时返回全局默认 30 分钟', intervalDefault.ok === true && intervalDefault.item.intervalMinutes === 30);
check('add：间歇周期必须在 1–1440 分钟内', S.add({ key: 'group:1', title: '非法周期', when: soonISO, intervalMinutes: 0 }).ok === false);

// ── 列表 / 取消 ──────────────────────────────────────────────────────────
const listed = S.list({ key: 'group:1' });
check('list：按时间升序返回', listed.ok === true && listed.count >= 3 && listed.items.every((it, i, arr) => i === 0 || arr[i - 1].dueAt <= it.dueAt));
check('list：带 when/dueISO 便于模型复述', typeof listed.items[0].when === 'string' && /T.*Z$/.test(listed.items[0].dueISO));
check('list：别的会话看不到', S.list({ key: 'private:2' }).count === 0);
check('listAll：无需会话状态也能发现独立存储的日程', S.listAll().conversations.some((c) => c.key === 'group:1' && c.items.length === listed.count));

const cancelled = S.cancel({ key: 'group:1', id: id1 });
check('cancel：按 id 取消', cancelled.ok === true && cancelled.removed.id === id1);
check('cancel：取消后不再出现', !S.list({ key: 'group:1' }).items.some((it) => it.id === id1));
check('cancel：按标题关键词取消', S.cancel({ key: 'group:1', match: '早八实验' }).ok === true);
check('cancel：找不到要报错', S.cancel({ key: 'group:1', id: 'sch-none' }).ok === false);
check('cancel：没有 id/match 要报错', S.cancel({ key: 'group:1' }).ok === false);

// ── 到点及间歇提醒 ───────────────────────────────────────────────────────
// 新日程从提醒起点开始按周期提醒，直到显式 complete。
store = { items: [] };
persist();
wakes = [];
const dueAt = Date.now() + 10 * 60 * 1000;
const reminderItem = S.add({ key: 'group:1', title: '十分钟后开会', when: new Date(dueAt).toISOString(), leadMinutes: 5, intervalMinutes: 2 });
const reminderStartAt = reminderItem.item.dueAt - 5 * 60 * 1000;
plugin.hooks.onTick({ now: reminderStartAt - 1 });
check('onTick：提醒起点前不触发', wakes.length === 0);
plugin.hooks.onTick({ now: reminderStartAt });
check('onTick：到提醒起点开始提醒', wakes.length === 1 && wakes[0].key === 'group:1');
check('onTick：提醒内容带标题/时间/地点字段', wakes.length === 1 && wakes[0].items.length === 1 && wakes[0].items[0].text.includes('十分钟后开会') && Number.isFinite(wakes[0].items[0].dueAt));
check('onTick：新日程保存提醒周期且未标记完成', store.items.length === 1 && store.items[0].intervalMinutes === 2 && !store.items[0].firedAt);
wakes = [];
plugin.hooks.onTick({ now: reminderStartAt + 119999 });
check('onTick：间隔未到不重复提醒', wakes.length === 0);
plugin.hooks.onTick({ now: reminderStartAt + 120000 });
check('onTick：间隔到后再次提醒', wakes.length === 1);
plugin.hooks.onTick({ now: dueAt + 24 * 60 * 60 * 1000 });
check('onTick：超过日程时间仍未确认时继续提醒', wakes.length === 2 && !store.items[0].completedAt);
const completedReminder = S.complete({ key: 'group:1', id: reminderItem.item.id });
check('complete：明确完成后隐藏待办', completedReminder.ok === true && completedReminder.item.completedAt > 0
  && !S.list({ key: 'group:1' }).items.some((it) => it.id === reminderItem.item.id));
wakes = [];
plugin.hooks.onTick({ now: dueAt + 2 * 24 * 60 * 60 * 1000 });
check('complete：完成后停止重复提醒', wakes.length === 0);

// 很早的条目（还没进提前窗口）不能提醒
store = { items: [] };
persist();
wakes = [];
S.add({ key: 'group:1', title: '后天的事', when: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() });
plugin.hooks.onTick({ now: Date.now() });
check('onTick：还没到提前窗口不提醒', wakes.length === 0);

// 桥接拒绝（静音/暂停）时条目保留，下个 tick 重试
store = { items: [] };
persist();
wakes = [];
wakeAllowed = false;
S.add({ key: 'group:1', title: '静音期的提醒', when: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
plugin.hooks.onTick({ now: Date.now() });
check('onTick：桥接拒绝时条目保留', wakes.length === 0 && store.items.length === 1 && !store.items[0].firedAt);
wakeAllowed = true;
plugin.hooks.onTick({ now: Date.now() + 1000 });
check('onTick：恢复后补提醒', wakes.length === 1);

// 重复日程在用户确认当前 occurrence 后顺延
store = { items: [] };
persist();
wakes = [];
const dailyReminder = S.add({ key: 'group:1', title: '每天的例会', when: new Date(Date.now() + 5 * 60 * 1000).toISOString(), repeat: 'daily', leadMinutes: 0, intervalMinutes: 5 });
const beforeDue = Number(store.items[0].dueAt);
plugin.hooks.onTick({ now: beforeDue });
check('onTick：确认前保留当前重复日程 occurrence', wakes.length === 1 && Number(store.items[0].dueAt) === beforeDue && !store.items[0].completedAt);
const dailyDone = S.complete({ key: 'group:1', id: dailyReminder.item.id });
check('complete：重复日程确认后顺延一天', dailyDone.ok === true && Number(dailyDone.item.dueAt) === beforeDue + 24 * 60 * 60 * 1000 && !dailyDone.item.completedAt);

// 新的间歇提醒不因迟到窗口自动终止
store = { items: [] };
persist();
wakes = [];
const overdueReminder = S.add({ key: 'group:1', title: '仍待完成', when: new Date(Date.now() + 5 * 60 * 1000).toISOString(), leadMinutes: 0, intervalMinutes: 10 });
plugin.hooks.onTick({ now: Date.now() + 24 * 60 * 60 * 1000 });
check('onTick：超过 dueAt 后继续提醒而非自动完成', wakes.length === 1 && !store.items[0].expired && !store.items[0].completedAt);
S.complete({ key: 'group:1', id: overdueReminder.item.id });

// ── 提前量 leadMinutes：每条日程自己的「提前多少分钟提醒」────────────────
// 唤醒时刻必须 = dueAt - leadMinutes * 60000；未指定时用全局默认 advanceMinutes（30）。
store = { items: [] };
persist();
wakes = [];
const iso = (ms) => new Date(ms).toISOString();

// 1) 未指定 → 全局默认 30，且落盘不新增字段（与旧数据同构）
const defBase = Date.now();
const defAdd = S.add({ key: 'group:2', title: '默认提前量', when: iso(defBase + 100 * 60 * 1000) });
check('lead：未指定时用全局默认 30 分钟', defAdd.ok === true && defAdd.item.leadMinutes === 30 && defAdd.item.leadIsDefault === true);
check('lead：未指定时不往条目里写 leadMinutes 字段（兼容旧结构）', store.items.length === 1 && !('leadMinutes' in store.items[0]));
check('lead：remindAt = when - 30 分钟', Math.abs(Number(defAdd.item.remindAt) - (Number(defAdd.item.dueAt) - 30 * 60000)) < 1000);

// 2) 显式 0 / 120，超范围夹取、非法值报错
const zeroAdd = S.add({ key: 'group:2', title: '到点提醒', when: iso(defBase + 90 * 60 * 1000), leadMinutes: 0 });
check('lead：显式 0 分钟（到点提醒）', zeroAdd.ok === true && zeroAdd.item.leadMinutes === 0 && zeroAdd.item.remindAt === zeroAdd.item.dueAt);
const bigAdd = S.add({ key: 'group:2', title: '提前两小时', when: iso(defBase + 130 * 60 * 1000), leadMinutes: 120 });
check('lead：显式 120 分钟', bigAdd.ok === true && bigAdd.item.leadMinutes === 120 && Math.abs(bigAdd.item.remindAt - (bigAdd.item.dueAt - 120 * 60000)) < 1000);
const clampAdd = S.add({ key: 'group:2', title: '超范围提前量', when: iso(defBase + 200 * 60 * 1000), leadMinutes: 5000 });
check('lead：超上限 1440 夹取并在返回里说明', clampAdd.ok === true && clampAdd.item.leadMinutes === 1440 && clampAdd.leadClamped === true && String(clampAdd.message).includes('夹取'));
const negAdd = S.add({ key: 'group:2', title: '负数提前量', when: iso(defBase + 210 * 60 * 1000), leadMinutes: -30 });
check('lead：负数夹取为 0', negAdd.ok === true && negAdd.item.leadMinutes === 0 && negAdd.leadClamped === true);
check('lead：非数字提前量明确报错', S.add({ key: 'group:2', title: '非法提前量', when: iso(defBase + 220 * 60 * 1000), leadMinutes: 'abc' }).ok === false);
check('lead：list 返回 leadMinutes / remindAt / remindISO', (() => {
  const it = S.list({ key: 'group:2' }).items.find((x) => x.title === '提前两小时');
  return !!it && it.leadMinutes === 120 && Number.isFinite(Number(it.remindAt))
    && typeof it.remindISO === 'string' && it.remindISO.endsWith('Z') && it.leadIsDefault === false;
})());

// 3) 模拟时间推进：0 / 30 / 120 分钟提前量的唤醒时刻都等于 when - leadMinutes
for (const lead of [0, 30, 120]) {
  store = { items: [] };
  persist();
  wakes = [];
  const due = Date.now() + 100 * 60 * 1000;
  const leadMs = lead * 60000;
  const tAdd = S.add({ key: 'group:3', title: '提前' + lead + '分钟', when: iso(due), leadMinutes: lead });
  if (!tAdd.ok) { check('lead=' + lead + '：登记成功', false, tAdd.error); continue; }
  const storedDue = Number(store.items[0].dueAt);
  plugin.hooks.onTick({ now: storedDue - leadMs - 60 * 1000 }); // 窗口前 1 分钟
  const notYet = wakes.length === 0;
  plugin.hooks.onTick({ now: storedDue - leadMs });              // 正好进入窗口
  check('lead=' + lead + '：唤醒时刻 = when - leadMinutes（窗口前不提醒、进窗口提醒）', notYet && wakes.length === 1 && wakes[0].key === 'group:3');
}

// 4) 已有日程改提前量：立刻生效（onTick 每次读 state，无需重建插件/重启进程）
store = { items: [] };
persist();
wakes = [];
const updBase = Date.now();
const updAdd = S.add({ key: 'group:4', title: '改提前量', when: iso(updBase + 100 * 60 * 1000) });
plugin.hooks.onTick({ now: updBase });
check('update：默认 30 分钟时还没进窗口、不提醒', wakes.length === 0);
const updOut = S.update({ key: 'group:4', id: updAdd.item.id, leadMinutes: 120 });
check('update：返回新的提前量', updOut.ok === true && updOut.item.leadMinutes === 120 && updOut.item.leadIsDefault === false);
plugin.hooks.onTick({ now: updBase });
check('update：改成 120 分钟后下一个 tick 立即进入窗口并提醒', wakes.length === 1);
const updByMatch = S.update({ key: 'group:4', match: '改提前量', leadMinutes: 0 });
check('update：可按标题关键词改提前量', updByMatch.ok === true && updByMatch.item.leadMinutes === 0);
check('update：缺 leadMinutes 要报错', S.update({ key: 'group:4', id: updAdd.item.id }).ok === false);
const updateAll = S.update({ key: 'group:4', id: updAdd.item.id, title: '已改名', when: iso(updBase + 5 * 60 * 60 * 1000), place: '线上', detail: '带投影片', repeat: 'weekly', leadMinutes: 15, intervalMinutes: 7 });
check('update：可改日程内容/时间和提醒开始/间歇周期', updateAll.ok === true && updateAll.item.title === '已改名'
  && updateAll.item.place === '线上' && updateAll.item.detail === '带投影片' && updateAll.item.repeat === 'weekly'
  && updateAll.item.leadMinutes === 15 && updateAll.item.intervalMinutes === 7);
check('update：空修改请求拒绝', S.update({ key: 'group:4', id: updAdd.item.id }).ok === false);

// 5) 旧数据（没有 leadMinutes 字段）按全局默认处理；改全局默认后旧条目也跟着变
store = { items: [{ id: 'sch-legacy-1', key: 'group:5', title: '旧条目', place: '', detail: '', dueAt: Date.now() + 100 * 60 * 1000, repeat: 'none', createdAt: Date.now() }] };
persist();
wakes = [];
const legacyList = S.list({ key: 'group:5' });
check('兼容：旧条目缺 leadMinutes 时按默认 30 分钟返回', legacyList.items[0].leadMinutes === 30 && legacyList.items[0].leadIsDefault === true);
plugin.hooks.onTick({ now: Date.now() });
check('兼容：旧条目距离 100 分钟，30 分钟窗口内不提醒', wakes.length === 0);
ctx.config.advanceMinutes = 120;
const legacyList2 = S.list({ key: 'group:5' });
check('兼容：全局默认改 120 后旧条目跟着变', legacyList2.items[0].leadMinutes === 120
  && Math.abs(legacyList2.items[0].remindAt - (legacyList2.items[0].dueAt - 120 * 60000)) < 1000);
plugin.hooks.onTick({ now: Date.now() });
check('兼容：旧条目按新的全局默认进入窗口并提醒', wakes.length === 1);
ctx.config.advanceMinutes = 30;

// ── 提示词注入 ────────────────────────────────────────────────────────────
store = { items: [] };
persist();
ctx.promptBlocks = [];
S.add({ key: 'group:1', title: '注入用的讲座', when: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), place: '3A101' });
plugin.hooks.beforePrompt({ key: 'group:1', reason: 'message' });
check('beforePrompt：注入未来日程', ctx.promptBlocks.join('\n').includes('【日程安排') && ctx.promptBlocks.join('\n').includes('注入用的讲座'));
ctx.promptBlocks = [];
plugin.hooks.beforePrompt({ key: 'private:9', reason: 'message' });
check('beforePrompt：别的会话不注入', ctx.promptBlocks.length === 0);
plugin.hooks.beforePrompt({ key: 'group:1', reason: 'memoryWrite' });
check('beforePrompt：记忆更新回合不注入', ctx.promptBlocks.length === 0);

// ── 持久化：重新加载实例后仍在 ────────────────────────────────────────────
const beforeReload = S.list({ key: 'group:1' }).count;
const plugin2 = createPlugin({ ...ctx, promptBlocks: [], addPromptBlock: (t) => {} });
check('持久化：重建组件后日程还在', beforeReload > 0 && plugin2.services.schedules.list({ key: 'group:1' }).count === beforeReload);

// ── 桥接/工具面接线（回归：这条链路不能断）────────────────────────────────
const bridge = fs.readFileSync('src/bridge.js', 'utf8');
const mcp = fs.readFileSync('src/mcp-snowluma-safe.js', 'utf8');
check('bridge：暴露 requestReminderWake 能力', bridge.includes('taskCaps.requestReminderWake'));
check('bridge：有 /api/socialV2/schedules 路由', bridge.includes("url.pathname === '/api/socialV2/schedules'"));
check('bridge：schedule 工具开关默认开', /schedule:\s*true/.test(bridge));
check('bridge：route 校验 agent token 与开关', bridge.includes('工具未启用：qq_schedule') && bridge.includes("callService('schedules'"));
check('mcp：注册 qq_schedule', mcp.includes("'qq_schedule'"));
check('mcp：qq_schedule 走唯一的 schedule 开关定义', mcp.includes(["from", "'./tools/flags.js'"].join(" ")) && /qq_schedule:\s*'schedule'/.test(fs.readFileSync('src/tools/flags.js', 'utf8')));
check('bridge：schedules 路由支持 update/complete 并透传提前量和间歇周期', bridge.includes("action === 'update'")
  && bridge.includes("action === 'complete'") && bridge.includes('intervalMinutes: body.intervalMinutes'));
check('mcp：qq_schedule 暴露提醒周期、修改和完成确认', mcp.includes('intervalMinutes') && mcp.includes('action=complete')
  && mcp.includes("action: z.enum(['add', 'list', 'cancel', 'update', 'complete'])"));
check('plugin.json：全局默认 advanceMinutes 仍是 30', (() => {
  try { return JSON.parse(fs.readFileSync('plugins/qq-components/life-schedule-reminder/plugin.json', 'utf8')).config.advanceMinutes === 30; } catch { return false; }
})());
check('chat-style：提示词改用 qq_schedule', fs.readFileSync('plugins/qq-components/ctx-chat-style/index.js', 'utf8').includes('qq_schedule'));
const consoleHtml = readConsoleTestSource();
check('bridge：跨会话 list 包含独立存储里的会话', bridge.includes("pluginHost.hasService('schedules', 'listAll')") && bridge.includes('global?.conversations'));
check('控制台：不保留迁移入口、旧日程行或新旧标签', !consoleHtml.includes('v2ScheduleMigrate') && !consoleHtml.includes('data-rem-key')
  && !consoleHtml.includes('标记「旧」') && !consoleHtml.includes('旧日程迁入新存储') && !consoleHtml.includes('>旧</span>')
  && !consoleHtml.includes('>新</span>') && consoleHtml.includes("action: 'list'"));
check('控制台：使用结构化日程卡片展示日期、对象与删除操作', consoleHtml.includes('schedule-card')
  && consoleHtml.includes('schedule-card-date') && consoleHtml.includes('data-sch-key') && consoleHtml.includes('schedule-empty'));
check('控制台：可查看并逐条编辑提醒起点/间歇周期及完成确认', consoleHtml.includes('v2ReminderLead') && consoleHtml.includes('v2ReminderInterval')
  && consoleHtml.includes('data-lead-save') && consoleHtml.includes('data-sch-complete') && consoleHtml.includes("action: 'complete'")
  && consoleHtml.includes('id=\"section-setting-l-2\"'));
check('旧日程路径已移除', !bridge.includes('scheduleReminderTimerV2') && !bridge.includes('parseScheduleEntryV2')
  && !bridge.includes("action === 'migrate'") && typeof S.importLegacy === 'undefined');

const legacyBridge = await bridgeHarness({ files: { 'state/social-v2.json': { conversations: { 'private:123': {
  activeTopics: [
    { text: '日程｜2099-01-01 09:00｜旧格式残留', lastMentionAt: Date.now() },
    { text: '正在准备期末项目', lastMentionAt: Date.now() }
  ]
} } } } });
try {
  const topics = legacyBridge.getSocialV2State('private:123').activeTopics;
  check('启动时清除残留旧日程，但保留普通进行中话题', topics.length === 1 && topics[0].text === '正在准备期末项目');
} finally { await legacyBridge.close(); }

fs.rmSync(tmpRoot, { recursive: true, force: true });

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n日程工具/提醒调度组件测试通过');
