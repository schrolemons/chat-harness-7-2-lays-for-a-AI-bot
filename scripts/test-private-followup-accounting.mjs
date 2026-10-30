import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlugin } from '../plugins/qq-components/ctx-chat-topic-drive/index.js';
async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-topic-xprivate-'));
  let data = {}, outcome = { ok: true }, calls = 0;
  try {
    fs.mkdirSync(path.join(root, 'state'));
    fs.writeFileSync(path.join(root, 'state/person-profiles.json'), JSON.stringify({ people: { '5': { keys: ['group:10', 'private:5'] } } }));
    const tools = new Map(), plugin = createPlugin({ root, config: { dailyLimit: 1, minIntervalMinutes: 180 },
      state: { get: () => structuredClone(data), set: p => data = { ...data, ...structuredClone(p) } },
      registerTool: (n, s) => tools.set(n, s), capabilities: { sendPrivateFollowup: async () => { calls++; return outcome; } }, log() {}, warn() {} });
    const incoming = id => plugin.hooks.onIncoming({ key: 'group:10', userId: '5', messageId: id, at: Date.now() });
    const sent = () => plugin.hooks.afterSend({ key: 'group:10', success: true, sentAt: Date.now(), messages: ['已回复群聊'] });
    const follow = () => tools.get('private_followup_send').handler({ groupKey: 'group:10', userId: '5', text: '群里说的那件事后来怎么样？' });
    await run({ incoming, sent, follow, state: () => data, calls: () => calls, setOutcome: value => outcome = value });
  } finally {
    assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('whale-topic-xprivate-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test('queuing and known failed followup do not consume daily quota; delivery does', async () => fixture(async f => {
  f.incoming('one'); f.setOutcome({ ok: false, error: 'known_failure' });
  assert.equal((await f.follow()).queued, true);
  assert.equal(f.state().followupSent?.['5']?.count || 0, 0);
  f.sent(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state().followupSent?.['5']?.count || 0, 0);
  f.incoming('two'); f.setOutcome({ ok: true });
  await f.follow(); f.sent(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state().followupSent['5'].count, 1);
}));
test('calling followup after the group reply actually delivered does not wait for another group reply', async () => fixture(async f => {
  f.incoming('one'); f.sent();
  const result = await f.follow();
  assert.equal(result.sent, true);
  assert.equal(f.calls(), 1); assert.equal(f.state().followupSent['5'].count, 1);
  f.sent(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.calls(), 1);
}));
