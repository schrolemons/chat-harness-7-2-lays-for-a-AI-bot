import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createPluginHost } from '../src/plugin-host.js';
test('real host persists a/b/p/q, rejects invalid weights and reads authoritative availability for reply limits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-topic-host-')); let host;
  try {
    for (const id of ['ctx-chat-topic-drive', 'life-conversation-wait', 'ctx-chat-reply-shape', 'life-wake-reasons']) {
      const original = path.resolve('plugins/qq-components', id), manifest = JSON.parse(fs.readFileSync(path.join(original, 'plugin.json'))), dest = path.join(root, 'plugins/qq-components', id);
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'plugin.json'), JSON.stringify({ ...manifest, main: 'entry.mjs' }));
      fs.writeFileSync(path.join(dest, 'entry.mjs'), 'export {createPlugin} from ' + JSON.stringify(pathToFileURL(path.join(original, 'index.js')).href) + ';');
    }
    host = createPluginHost({ root, capabilities: {}, startTimers: false }); await host.loadAll();
    assert.deepEqual(host.summary().warnings, []);
    assert.equal(host.setConfig('ctx-chat-topic-drive', { followupWeight: .8, newTopicWeight: .3 }).ok, false);
    assert.equal(host.setConfig('life-conversation-wait', { probabilityStepPercent: 0 }).ok, false);
    assert.equal(host.setConfig('ctx-chat-topic-drive', { followupWeight: .1, newTopicWeight: .8 }).ok, true);
    assert.equal(host.setConfig('life-conversation-wait', { endProbabilityPercent: 60, probabilityStepPercent: 20 }).ok, true);
    await host.reload('ctx-chat-topic-drive'); await host.reload('life-conversation-wait');
    for (const key of ['private:1', 'group:2']) {
      const v = host.callService('waitCycle', 'timeout', { key, scope: 's:1', seq: 0, startSeq: 0, random: () => .7 });
      assert.equal(v.probabilityPercent, 60); assert.equal(v.endRound, false); assert.equal(v.action, 'newTopic');
      const next = host.callService('waitCycle', 'timeout', { key, scope: 's:1', seq: 0, startSeq: 0, random: () => .99 });
      assert.equal(next.probabilityPercent, 80);
    }
    const key = 'private:1', mood = { score: 100, styleInstruction: '温柔' };
    host.callService('proactive', 'setWillingness', { key, value: 0, reason: '用户明确说正在开会' });
    const plan = host.callService('replyPlan', 'resolve', { key, incomingText: '哈哈', mood, willingness: 100 });
    assert.equal(plan.willingness, 0, 'caller cannot spoof the authoritative assessment'); assert.equal(plan.maxMessages, 1);
    assert.equal(plan.styleInstruction, '温柔');
  } finally { await host?.dispose(); assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('whale-topic-host-')); fs.rmSync(root, { recursive: true, force: true }); }
});
