// Factories only; no production plugin host/state, timers, QQ or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/ctx-memory-context/index.js';
import { createPlugin as createMemoryUpdatePlugin } from '../plugins/qq-components/ctx-memory-update/index.js';
import { windowImpressions } from '../plugins/qq-components/ctx-memory-context/light-window.mjs';
function build(payload, config = {}, capabilities = {}) {
  const blocks = []; createPlugin({ config, capabilities, addPromptBlock: text => blocks.push(text) }).hooks.beforePrompt(payload); return blocks;
}
test('each source has a separate block and normal chat excludes display diary and raw legacy tasks', () => {
  const now = Date.now();
  const blocks = build({ key: 'private:1', st: { recentMessages: [{ userId: '1', sender: '甲', at: now - 1000 }],
    activeTopics: [{ text: '周末去哪玩' }], pendingThoughts: [{ text: '想问加班到几点' }],
    memberImpressions: { 甲: { traits: ['本轮说话急'], lastSeenAt: now }, 乙: { traits: ['窗口外印象'] } } },
    persistentMemory: { text: '【重要事实】\n- 用户原话\n【用户画像】\n- 今日比较忙\n【日记】\n展示日记', updatedAt: now },
    affairsContext: { text: '[事务ID] 等报告结果' }, midTermText: '不再读取的旧笔记' });
  const all = blocks.join('\n');
  assert.equal(blocks.length, 4);
  assert.match(blocks[1], /当前事务/);
  assert.match(blocks[2], /每轮复核/);
  assert.match(blocks[3], /持久化会话记忆/);
  for (const value of ['周末去哪玩', '加班到几点', '本轮说话急', '用户原话', '等报告结果']) assert.ok(all.includes(value));
  for (const value of ['窗口外印象', '展示日记', '不再读取的旧笔记']) assert.ok(!all.includes(value));
});
test('window impressions do not revive earlier behavior when the same speaker returns', () => {
  const now = Date.now(), state = { recentMessages: [{ sender: '甲', at: now }], memberImpressions: { 甲: { traits: ['上次很急'], lastSeenAt: now - 60000 } } };
  assert.deepEqual(windowImpressions(state), {});
  state.memberImpressions.甲.lastSeenAt = now + 1;
  assert.ok(windowImpressions(state).甲);
});
test('configured small window controls behavior impression visibility without counting duplicate messages twice', () => {
  const now = Date.now(), old = { seq: 1, sender: '甲', time: now - 1000 }, latest = { seq: 2, sender: '乙', time: now };
  const st = { recentMessages: [old, latest], unread: [{ ...latest }], memberImpressions: { 甲: { traits: ['旧窗口'], lastSeenAt: now }, 乙: { traits: ['新窗口'], lastSeenAt: now } } };
  assert.deepEqual(Object.keys(windowImpressions(st, { limit: 1 })), ['乙']);
  assert.deepEqual(Object.keys(windowImpressions(st, { limit: 2 })), ['甲', '乙']);
});
test('yesterdays provisional portrait does not masquerade as todays observation', () => {
  const prompt = build({ st: {}, persistentMemory: { text: '【重要事实】\n- 原话事实\n【用户画像】\n- 昨天很焦虑', updatedAt: Date.now() - 86400000 } }).join('');
  assert.ok(prompt.includes('原话事实')); assert.ok(!prompt.includes('昨天很焦虑'));
});
test('combined memory blocks fit host cap and affairs are recomputed under the remaining budget', () => {
  const facts = Array.from({ length: 100 }, (_, i) => '- 事实' + i + '：' + '字'.repeat(80)).join('\n');
  let requested;
  const blocks = build({ key: 'private:1', st: {}, persistentMemory: { text: facts }, maxChars: 20000 }, { maxChars: 20000, affairsMaxChars: 10000 },
    { readAffairsContext: (key, budget) => { requested = { key, budget }; return { text: '[事务] 完整条目' }; } });
  assert.equal(requested.key, 'private:1'); assert.ok(requested.budget > 0 && requested.budget < 10000);
  assert.ok(blocks.join('\n\n').length < 8000); assert.ok(blocks.join('').includes('完整条目'));
  assert.deepEqual(build({ st: {} }), []);
});
test('refresh declares three persistent columns, independent affairs and evidence-based upward flow', () => {
  const text = createMemoryUpdatePlugin({ config: { maxChars: 4000 } }).hooks.beforePrompt({ reason: 'memoryWrite' });
  for (const value of ['逐条', '用户原话', '玩笑', '聊天喜好', '来源和日期', '临时人物画像', 'profile_get', 'profile_update', 'qq_task_note', 'expectedRevision', '向上更新', '不要发任何 QQ 消息']) assert.ok(text.includes(value), value);
  assert.ok(!text.includes('\n【未完成事项】\n'));
  assert.ok(text.includes('【重要事实】') && text.includes('【用户画像】') && text.includes('【日记】'));
  assert.match(text, /前一日.{0,16}22:00.{0,30}XX 日当晚 22:00/s);
});


test('ordinary chat actively reconciles affairs even before the first item exists',()=>{
 const text=build({key:'private:1',st:{}}).join('');
 for(const required of ['优先更新同一条','不重复新增','expectedRevision','done','cancelled','superseded','不反复追问','沉默'])assert.ok(text.includes(required),required);
 assert.ok(!build({key:'private:1',st:{},reason:'memoryWrite'}).join('').includes('每轮复核'));
});
