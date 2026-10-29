import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPlugin as memoryPlugin } from '../plugins/qq-components/ctx-memory-store/index.js';
import { createPlugin as contextPlugin } from '../plugins/qq-components/ctx-memory-context/index.js';
import { collectTaskNotes, dateKeyLocal } from '../plugins/qq-components/life-daily-worklog/worklog.js';
const affairs = await import('../plugins/qq-components/ctx-memory-store/affairs.mjs').catch(() => ({}));
const sections = await import('../plugins/qq-components/ctx-memory-store/sections.mjs').catch(() => ({}));
function store(t) {
  assert.equal(typeof affairs.createAffairStore, 'function', 'affair store is implemented');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-affairs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, api: affairs.createAffairStore(root) };
}
test('more than 15000 chars remains appendable and intact across reload', t => {
  const { root, api } = store(t);
  const ids = [];
  for (let i = 0; i < 24; i++) ids.push(api.upsert({ key: 'private:1', title: `事项${i}`, detail: '内容'.repeat(500), status: 'pending' }).item.id);
  const reloaded = affairs.createAffairStore(root).list({ key: 'private:1', limit: 100 });
  assert.equal(reloaded.total, 24);
  assert.deepEqual(new Set(reloaded.items.map(x => x.id)), new Set(ids));
  assert.ok(reloaded.items.every(x => x.detail.length === 1000));
});
test('updates use stable ids and reject stale edits; closed items stay in history', t => {
  const { api } = store(t);
  const first = api.upsert({ key: 'group:2', title: '吃饭约定', status: 'pending' }).item;
  const updated = api.upsert({ key: 'group:2', id: first.id, expectedRevision: first.revision, status: 'done', nextAction: '' });
  assert.equal(updated.ok, true);
  assert.equal(updated.item.id, first.id);
  assert.equal(api.upsert({ key: 'group:2', id: first.id, expectedRevision: first.revision, title: '过期表单' }).conflict, true);
  assert.equal(api.list({ key: 'group:2' }).total, 0);
  assert.equal(api.list({ key: 'group:2', status: 'all' }).total, 1);
  assert.equal(api.list({ key: 'private:2', status: 'all' }).total, 0);
});
test('whole-item selection prioritizes active work, never receipts or half an item', t => {
  const { api } = store(t);
  const low = api.upsert({ key: 'private:1', title: '普通事项', detail: 'a'.repeat(250), priority: 0, status: 'pending' }).item;
  const high = api.upsert({ key: 'private:1', title: '优先事项', nextAction: '核对来源', priority: 2, status: 'doing' }).item;
  api.appendReceipt({ key: 'private:1', text: '日记已发：2026-10-28' });
  const view = api.context({ key: 'private:1', maxChars: 200 });
  assert.ok(view.selectedIds.includes(high.id));
  assert.ok(view.omittedIds.includes(low.id));
  assert.ok(view.text.length <= 200);
  assert.ok(!view.text.includes('日记已发'));
  assert.ok(view.text.includes('核对来源'));
  assert.ok(!view.text.includes('aaaa'));
});
test('invalid scope, blank title, unknown status and oversized input fail without truncation', t => {
  const { api } = store(t);
  for (const payload of [
    { key: '../../x', title: 'x' }, { key: 'private:1', title: '' },
    { key: 'private:1', title: 'x', status: 'guess' }, { key: 'private:1', title: 'x', detail: 'x'.repeat(20001) }
  ]) assert.throws(() => api.upsert(payload));
  assert.equal(api.list({ key: 'private:1', status: 'all' }).total, 0);
});
test('migration imports unfinished separately and isolates receipts; idempotent and recoverable', t => {
  const { root, api } = store(t);
  const dir = path.join(root, 'state', 'memory'); fs.mkdirSync(dir, { recursive: true });
  const legacy = '## [2026/10/28 10:00:00]\n准备修复网页监控\n\n## [2026/10/28 22:00:00]\n日记已发：2026-10-28\n';
  const file = path.join(dir, 'tasks-private_1.md'); fs.writeFileSync(file, legacy);
  const memory = '【重要事实】\n- 用户喜欢简洁\n【用户画像】\n- 今日比较忙\n【未完成事项】\n- 周五交报告\n【日记】\n今天很充实';
  assert.equal(api.migrate({ key: 'private:1', persistentText: memory }).imported, 2);
  assert.equal(api.migrate({ key: 'private:1', persistentText: memory }).imported, 0);
  const all = api.list({ key: 'private:1', status: 'all' });
  assert.equal(all.total, 2);
  assert.ok(all.items.every(x => x.status === 'needs_review'));
  assert.ok(all.items.every(x => !x.detail.includes('日记已发')));
  assert.equal(fs.readFileSync(file, 'utf8'), legacy);
  assert.ok(api.receipts({ key: 'private:1' }).includes('日记已发：2026-10-28'));
});
test('migration resumes after originals were backed up and refresh does not duplicate imported unfinished', t => {
  const { root, api } = store(t), dir = path.join(root, 'state', 'memory');
  const text = '【重要事实】\n- 事实\n【未完成事项】\n- 周五交报告\n【日记】\n日记';
  const backup = path.join(dir, 'migration-originals', 'private_1'); fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, 'persistent.md'), text);
  fs.writeFileSync(path.join(dir, 'private_1.md'), text);
  assert.doesNotThrow(() => api.migrate({ key: 'private:1', persistentText: text }));
  const plugin = memoryPlugin({ root, config: {}, capabilities: {}, state: { get: () => ({}), set() {} }, registerTool() {}, warn() {} });
  plugin.services.memory.capture({ key: 'private:1', text: '<MEMORY>' + text + '</MEMORY>' });
  assert.equal(plugin.services.affairs.list({ key: 'private:1', status: 'all' }).total, 1);
});
test('persistent selection includes complete facts/profile but no diary or unfinished duplicates', () => {
  assert.equal(typeof sections.selectPersistentContext, 'function');
  const raw = '【重要事实】\n- 喜欢简洁回答\n- 有一条完整事实\n【用户画像】\n- 2026-10-29：今日赶作业\n【未完成事项】\n- 周五交报告\n【日记】\n不应自动读给模型的日记';
  const view = sections.selectPersistentContext(raw, 1000);
  assert.ok(view.includes('喜欢简洁回答') && view.includes('今日赶作业'));
  assert.ok(!view.includes('周五交报告') && !view.includes('日记'));
  assert.ok(sections.selectPersistentContext(raw, 20).length <= 20);
});
test('automatic memory refresh retains old facts and removes unfinished from persistent document', () => {
  assert.equal(typeof sections.mergePersistentDocument, 'function');
  const old = '【重要事实】\n- 旧事实\n【用户画像】\n旧画像\n【日记】\n旧日记';
  const next = '【重要事实】\n- 新事实\n【用户画像】\n新画像\n【未完成事项】\n- 待办\n【日记】\n新日记';
  const out = sections.mergePersistentDocument(old, next);
  assert.ok(out.includes('旧事实') && out.includes('新事实') && out.includes('新画像') && out.includes('新日记'));
  assert.ok(!out.includes('旧画像') && !out.includes('未完成事项'));
});
test('plugin service separates receipt data and captures unfinished into canonical affairs', t => {
  const { root } = store(t);
  const plugin = memoryPlugin({ root, config: {}, capabilities: {}, state: { get: () => ({}), set() {} }, registerTool() {}, warn() {} });
  assert.ok(plugin.services.affairs, 'canonical affairs service is exposed');
  plugin.services.memory.capture({ key: 'private:1', text: '<MEMORY>【重要事实】\n- 喜欢聊天\n【未完成事项】\n- 等报告结果\n【日记】\n今天聊了天</MEMORY>' });
  assert.ok(!plugin.services.memory.read({ key: 'private:1' }).text.includes('未完成事项'));
  assert.equal(plugin.services.affairs.list({ key: 'private:1' }).total, 1);
  plugin.services.affairs.appendReceipt({ key: 'private:1', text: '日记已发：2026-10-28' });
  assert.ok(!plugin.services.affairs.context({ key: 'private:1' }).text.includes('日记已发'));
});
test('injector includes current-window speakers and canonical affairs, excludes diary and raw legacy text', () => {
  const blocks = [];
  const plugin = contextPlugin({ config: {}, addPromptBlock: x => blocks.push(x) });
  plugin.hooks.beforePrompt({ key: 'private:1', st: { recentMessages: [{ userId: '1', sender: '甲' }], memberImpressions: { 甲: { traits: ['本轮说话急'] }, 乙: { traits: ['窗口外旧印象'] } } },
    persistentMemory: { text: '【重要事实】\n- 用户原话\n【日记】\nPRIVATE_DIARY' },
    affairsContext: { text: '[a-1] 等待报告', selectedIds: ['a-1'], omittedIds: [] }, midTermText: 'LEGACY_RAW' });
  const prompt = blocks.join('\n');
  assert.ok(prompt.includes('本轮说话急') && !prompt.includes('窗口外旧印象'));
  assert.ok(prompt.includes('等待报告') && !prompt.includes('LEGACY_RAW') && !prompt.includes('PRIVATE_DIARY'));
});
test('worklog reads actual affair changes and keeps old migration records on their original dates', t => {
  const { root, api } = store(t), dir = path.join(root, 'state', 'memory'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tasks-private_1.md'), '## [2025/1/1 12:00:00]\n往年的修复记录\n');
  api.migrate({ key: 'private:1' });
  assert.equal(collectTaskNotes(root, dateKeyLocal()).length, 0);
  assert.ok(collectTaskNotes(root, '2025-01-01')[0].entries[0].body.includes('往年的修复记录'));
  const item = api.upsert({ key: 'private:1', title: '本轮核对', status: 'doing', nextAction: '运行测试' }).item;
  api.upsert({ key: 'private:1', id: item.id, expectedRevision: item.revision, status: 'done', detail: '验证已通过' });
  api.appendReceipt({ key: 'private:1', text: '通知已发：不应算工作内容' });
  const report = JSON.stringify(collectTaskNotes(root, dateKeyLocal()));
  assert.ok(report.includes('本轮核对') && report.includes('验证已通过'));
  assert.ok(!report.includes('往年的修复记录') && !report.includes('不应算工作内容'));
});
test('one-time parameter migration preserves saved budgets and dry run never mutates overrides', t => {
  const { root } = store(t), scripts = path.join(root, 'scripts'); fs.mkdirSync(scripts);
  const script = path.join(scripts, 'migrate-memory-config.mjs'); fs.copyFileSync(new URL('./migrate-memory-config.mjs', import.meta.url), script);
  const dir = path.join(root, 'state', 'plugins', 'config'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ctx-memory-context.json'), source = JSON.stringify({ midTermSlice: 4000, maxChars: 3000 }); fs.writeFileSync(file, source);
  execFileSync(process.execPath, [script], { windowsHide: true }); assert.equal(fs.readFileSync(file, 'utf8'), source);
  execFileSync(process.execPath, [script, '--apply'], { windowsHide: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { affairsMaxChars: 4000, maxChars: 3000 });
  const backupDir = path.join(root, 'state', 'memory', 'migration-originals');
  assert.equal(fs.readFileSync(path.join(backupDir, fs.readdirSync(backupDir)[0]), 'utf8'), source);
  execFileSync(process.execPath, [script, '--apply'], { windowsHide: true }); assert.equal(fs.readdirSync(backupDir).length, 1);
});

const { windowImpressions } = await import('../plugins/qq-components/ctx-memory-context/light-window.mjs');
test('light-memory union selects newest messages when unread extends behind recent history', () => {
  const now = Date.now();
  const messages = [1, 2, 3, 4, 5].map(seq => ({ seq, sender: 'speaker' + seq, time: now + seq }));
  const memberImpressions = Object.fromEntries(messages.map(message => [message.sender, { traits: ['behavior' + message.seq], lastSeenAt: now + 10 }]));
  const view = windowImpressions({ recentMessages: messages.slice(2), unread: messages, memberImpressions }, { limit: 2 });
  assert.deepEqual(Object.keys(view), ['speaker4', 'speaker5']);
});
