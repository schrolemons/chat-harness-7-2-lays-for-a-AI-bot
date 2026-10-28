import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPlugin } from './index.js';

test('cross-session followup queues until the group reply is delivered and sends only once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-followup-'));
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'state', 'user-profiles.json'), JSON.stringify({ users: {
    'u:5': { userId: '5', keys: ['group:10', 'private:5'] }
  } }));
  let stored = {};
  const tools = new Map();
  const sends = [];
  const plugin = createPlugin({ root, config: { minIntervalMinutes: 0, dailyLimit: 2, sessionLimits: { 'private:5': { dailyLimit: 1 } } },
    state: { get: () => structuredClone(stored), set: (patch) => { stored = { ...stored, ...structuredClone(patch) }; } },
    runtime: {}, capabilities: { sendPrivateFollowup: async (payload) => { sends.push(payload); return { ok: true }; } },
    registerTool: (name, spec) => tools.set(name, spec), log() {}, warn() {} });
  const at = Date.now();
  plugin.hooks.onIncoming({ key: 'group:10', userId: '5', messageId: 'm-1', at });
  const queued = await tools.get('private_followup_send').handler({ groupKey: 'group:10', userId: '5', text: '那后来怎么样了？' });
  assert.equal(queued.queued, true);
  assert.equal(sends.length, 0);
  plugin.hooks.afterSend({ key: 'group:10', success: true, sentAt: Date.now(), messages: ['群聊回复'] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sends, [{ userId: '5', text: '那后来怎么样了？' }]);
  const duplicate = await tools.get('private_followup_send').handler({ groupKey: 'group:10', userId: '5', text: '还有呢？' });
  assert.equal(duplicate.ok, false);
  assert.equal(sends.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('prompt asks for an independent private followup when care or genuine interest applies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-followup-prompt-'));
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'state', 'user-profiles.json'), JSON.stringify({ users: {
    'u:5': { userId: '5', keys: ['group:10', 'private:5'] }
  } }));
  const tools = new Map();
  let stored = {};
  const plugin = createPlugin({ root, config: { minIntervalMinutes: 180, dailyLimit: 1 },
    state: { get: () => structuredClone(stored), set: (patch) => { stored = { ...stored, ...structuredClone(patch) }; } },
    registerTool: (name, spec) => tools.set(name, spec), capabilities: {}, log() {}, warn() {} });
  plugin.hooks.onIncoming({ key: 'group:10', userId: '5', messageId: 'm-2', at: Date.now() });
  const prompt = plugin.hooks.beforePrompt({ key: 'group:10', reason: 'message', st: { unread: [{ userId: '5', text: '我这几天一直头疼，工作也很累' }] } });
  assert.match(prompt, /值得关心/);
  assert.match(prompt, /很感兴趣/);
  assert.match(prompt, /private_followup_send/);
  assert.match(prompt, /groupKey=group:10、userId=5/);
  assert.equal(tools.has('private_followup_send'), true);
  fs.rmSync(root, { recursive: true, force: true });
});
