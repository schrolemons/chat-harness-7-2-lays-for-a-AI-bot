import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlugin } from '../plugins/qq-components/life-daily-worklog/index.js';
import { dateKeyLocal } from '../plugins/qq-components/life-daily-worklog/worklog.js';

function fixture(t, { missingStats = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-report-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, 'state', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const at = Date.now(), date = dateKeyLocal(at);
  write('tasks.json', { tasks: {
    done: { id: 'done', title: '修复控制台数据读取', status: 'done', createdAt: at, updatedAt: at, result: '源码已修改，隔离测试通过；尚未上线。' },
    running: { id: 'running', title: '网站监控登录复验', status: 'running', createdAt: at, updatedAt: at, result: '等待真实登录验证。' }
  } });
  write('plugins/obs-self-review.json', { queueEvents: Array.from({ length: 40 }, (_, i) => ({ at: new Date(at).toISOString(), action: 'submitted', id: `private-feedback-${i}` })) });
  write('memory/_optimization.md', '# 自我更新发现与统一修复摘要\n## 修复记录\n### (' + new Date(at).toISOString() + ') · 完整结果\n' + '隔离验证记录。'.repeat(500) + '归档末尾证据不可丢失\n');
  if (!missingStats) {
    write('tool-calls.jsonl', JSON.stringify({ time: new Date(at).toISOString(), type: 'call', tool: 'fixture-tool' }));
    write('token-usage.jsonl', JSON.stringify({ k: 'turn', t: at, key: 'private:123', model: 'fixture-model', b: { cacheMiss: 100, cacheHit: 200, output: 50 } }));
  }
  const state = {}, sent = [];
  const plugin = createPlugin({ root, config: { hour: 0, sendToOwner: true, maxChars: 1000 },
    state: { get: () => state, set: patch => Object.assign(state, patch) },
    capabilities: { notifyOwnerOnce: async text => { sent.push(text); return true; } },
    registerTool() {}, log() {}, warn(message) { throw Error(message); }
  });
  return { root, date, plugin, sent, write, at };
}

test('手动短报保留概览和成果、待办、完整记录入口，不被反馈流水挤占', t => {
  const { plugin } = fixture(t);
  const report = plugin.services.worklog.generateNow();
  assert.equal(report.ok, true);
  assert.ok(report.sendText.length <= 900);
  assert.match(report.sendText, /概览/);
  assert.match(report.sendText, /任务会话：2/);
  assert.match(report.sendText, /修复控制台数据读取/);
  assert.match(report.sendText, /尚未上线/);
  assert.match(report.sendText, /网站监控登录复验/);
  assert.match(report.sendText, /完整记录：state\/memory\/worklog\//);
  assert.doesNotMatch(report.sendText, /private-feedback-|已截断|…（完整版见/);
});

test('完整归档不因发送长度预算截断，保存末尾验证证据', t => {
  const { plugin, root, date } = fixture(t);
  plugin.services.worklog.generateNow();
  const archived = fs.readFileSync(path.join(root, 'state/memory/worklog', date + '.md'), 'utf8');
  assert.match(archived, /归档末尾证据不可丢失/);
  assert.match(archived, /private-feedback-/);
  assert.doesNotMatch(archived, /超出长度上限，已截断/);
});

test('定时发送同样使用完整短报，不截取归档前900字', async t => {
  const { plugin, sent } = fixture(t);
  await plugin.hooks.onTick({ now: Date.now() });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /修复控制台数据读取/);
  assert.match(sent[0], /网站监控登录复验/);
  assert.match(sent[0], /完整记录：/);
  assert.doesNotMatch(sent[0], /private-feedback-/);
});

test('缺失统计来源写未采集，不能当作零次或无失败', t => {
  const { plugin } = fixture(t, { missingStats: true });
  const { sendText } = plugin.services.worklog.generateNow();
  assert.match(sendText, /工具调用：未采集/);
  assert.match(sendText, /模型调用：未采集/);
  assert.doesNotMatch(sendText, /工具调用：0|模型调用：0|无失败/);
});

test('长结果仍保留尚未部署的限制，不让短报误报已上线', t => {
  const { plugin, write, at } = fixture(t);
  write('tasks.json', { tasks: { one: { id: 'one', title: '更新发送限制', status: 'done', createdAt: at,
    result: '已修改源码并通过隔离验证。' + '验证了消息频率和额度。'.repeat(50) + '尚未部署。' } } });
  const { sendText } = plugin.services.worklog.generateNow();
  assert.match(sendText, /尚未部署/);
  assert.ok(sendText.length <= 900);
});

test('同一事务的完成后重新待办只呈现最新状态', t => {
  const { plugin, write, at } = fixture(t);
  write('memory/affairs/private_123.json', { version: 1, key: 'private:123', items: [{
    id: 'a-one', title: '重新检查会话边界', status: 'waiting', detail: '等待真实使用复验', updatedAt: at,
    history: [{ revision: 1, at: at - 1, status: 'done', title: '重新检查会话边界', detail: '旧轮次已通过' }]
  }] });
  const { sendText } = plugin.services.worklog.generateNow();
  assert.equal(sendText.match(/重新检查会话边界/g)?.length, 1);
  assert.ok(sendText.indexOf('重新检查会话边界') > sendText.indexOf('未完成与后续'));
  assert.doesNotMatch(sendText, /旧轮次已通过/);
});

test('仅热载日报入口时会执行新版辅助模板', async t => {
  const { root } = fixture(t);
  const dir = path.join(root, 'component');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  const source = new URL('../plugins/qq-components/life-daily-worklog/', import.meta.url);
  for (const file of ['index.js', 'worklog.js', 'summary.js']) fs.copyFileSync(new URL(file, source), path.join(dir, file));
  const url = pathToFileURL(path.join(dir, 'index.js')).href;
  const ctx = { root, config: {}, capabilities: {}, registerTool() {}, state: { get: () => ({}), set() {} }, log() {}, warn() {} };
  const old = await import(url + '?generation=before');
  assert.match(old.createPlugin(ctx).services.worklog.generateNow().sendText, /工作总结/);
  const helper = path.join(dir, 'summary.js');
  fs.writeFileSync(helper, fs.readFileSync(helper, 'utf8').replace('今日主要成果', '最新成果已热载'));
  const fresh = await import(url + '?generation=after');
  assert.match(fresh.createPlugin(ctx).services.worklog.generateNow().sendText, /最新成果已热载/);
});
