// Real factories and host with temporary state; never opens QQ, DSH, or model connections.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPluginHost } from '../src/plugin-host.js';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
async function isolated(ids, run, capabilities = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-component-config-'));
  let host;
  try {
    for (const id of ids) {
      const original = path.join(repo, 'plugins/qq-components', id);
      const manifest = JSON.parse(fs.readFileSync(path.join(original, 'plugin.json'), 'utf8'));
      const target = path.join(root, 'plugins/qq-components', id);
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'plugin.json'), JSON.stringify({ ...manifest, main: 'entry.mjs' }));
      fs.writeFileSync(path.join(target, 'entry.mjs'), 'export {createPlugin} from ' + JSON.stringify(pathToFileURL(path.join(original, manifest.main || 'index.js')).href) + ';');
    }
    host = createPluginHost({ root, capabilities, startTimers: false });
    await host.loadAll();
    assert.deepEqual(host.summary().warnings, []);
    await run(host, root);
  } finally {
    await host?.dispose();
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('qq-component-config-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
async function configure(host, id, patch) {
  assert.equal(host.setConfig(id, patch).ok, true);
  await host.reload(id);
  assert.deepEqual(host.summary().warnings, []);
}
const factLines = char => Array.from({ length: 100 }, (_, index) => '- 事实' + index + '：' + char.repeat(30)).join('\n');
const memoryPayload = (maxChars = 4000) => ({ key: 'private:123', st: {}, persistentMemory: { text: '【重要事实】\n' + factLines('X') }, maxChars });
const injectedXs = host => (host.collectPromptBlocks(memoryPayload()).join('').match(/X/g) || []).length;
const question = reason => ({ key: 'private:124', reason, isOwnerKey: false, st: { unread: [{ text: '算法怎么证明？', userId: '124' }] } });

test('real memory maxChars survives setConfig/reload and cannot be enlarged by host payload', async () => {
  await isolated(['ctx-memory-context'], async host => {
    await configure(host, 'ctx-memory-context', { maxChars: 600 });
    const small = injectedXs(host); assert.ok(small > 0 && small <= 600);
    await configure(host, 'ctx-memory-context', { maxChars: 1000 });
    assert.ok(injectedXs(host) > small && injectedXs(host) <= 1000);
    assert.ok((host.collectPromptBlocks(memoryPayload(700)).join('').match(/X/g) || []).length <= 700);
  });
});

test('real memory affairsMaxChars changes whole-item selection after reload', async () => {
  await isolated(['ctx-memory-context', 'ctx-memory-store'], async host => {
    host.callService('affairs', 'upsert', { key: 'private:123', title: '预算内事项', detail: 'Y'.repeat(300), status: 'doing' });
    for (const limit of [300, 600]) {
      await configure(host, 'ctx-memory-context', { affairsMaxChars: limit });
      const affairsContext = host.callService('affairs', 'context', { key: 'private:123', maxChars: limit });
      const text = host.collectPromptBlocks({ st: {}, affairsContext }).join('');
      assert.equal((text.match(/Y/g) || []).length, limit === 300 ? 0 : 300);
    }
  });
});

test('memory behavior impressions retain data and use current small-context wording', async () => {
  await isolated(['ctx-memory-context'], async host => {
    const text = host.collectPromptBlocks({ st: { recentMessages: [{ sender: 'fixture' }], memberImpressions: { fixture: { traits: ['行为证据'], interactionCount: 2 } } } }).join('');
    assert.ok(text.includes('当前小上下文窗口内对用户的行为印象'));
    assert.ok(text.includes('行为证据'));
  });
});

test('maintenance and autonomous reasons neither charge nor inject exhausted professional quota', async () => {
  await isolated(['ctx-knowledge-quota'], async host => {
    const reasons = ['memoryWrite', 'selfReview', 'selfOptimize', 'userFeedbackReview', 'slangLearn', 'maintenance', 'dailyDiary', 'taskDone', 'reminder', 'timeBubble', 'startupGreeting', 'careCheck', 'newsShare', 'idleRescue', 'proactiveCheck', 'scheduledContact:fixture'];
    for (const limit of [3, 0]) {
      await configure(host, 'ctx-knowledge-quota', { dailyLimit: limit });
      for (const reason of reasons) {
        assert.deepEqual(host.collectPromptBlocks(question(reason)), [], reason + ' must have no quota prompt');
        assert.equal(host.callService('knowledgeQuota', 'usage', 'private:124').used, 0, reason + ' must not consume allowance');
      }
    }
  });
});

test('user professional requests still count and configured dailyLimit changes deflection', async () => {
  await isolated(['ctx-knowledge-quota'], async host => {
    await configure(host, 'ctx-knowledge-quota', { dailyLimit: 0 });
    assert.ok(host.collectPromptBlocks(question('message')).join('').includes('配额已用完'));
    await configure(host, 'ctx-knowledge-quota', { dailyLimit: 2 });
    assert.ok(!host.collectPromptBlocks(question('question')).join('').includes('配额已用完'));
    assert.equal(host.callService('knowledgeQuota', 'usage', 'private:124').used, 1);
    await configure(host, 'ctx-knowledge-quota', { enabled: false });
    assert.deepEqual(host.collectPromptBlocks(question('atMention')), []);
    assert.equal(host.callService('knowledgeQuota', 'usage', 'private:124').used, 1);
  });
});

test('schedule advance/interval defaults and enabled flag affect real due dispatch after reload', async () => {
  const wakes = [];
  await isolated(['life-schedule-reminder'], async host => {
    await configure(host, 'life-schedule-reminder', { advanceMinutes: 5, intervalMinutes: 7 });
    const now = Date.now();
    const added = host.callService('schedules', 'add', { key: 'private:124', title: 'fixture schedule', dueAt: now + 10 * 60000 });
    assert.equal(added.ok, true);
    assert.equal(added.item.leadMinutes, 5);
    assert.equal(added.item.intervalMinutes, 7);
    await host.tick(now);
    assert.equal(wakes.length, 0);
    await configure(host, 'life-schedule-reminder', { advanceMinutes: 20, enabled: false });
    await host.tick(now);
    assert.equal(wakes.length, 0);
    await configure(host, 'life-schedule-reminder', { enabled: true });
    await host.tick(now);
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].items[0].id, added.item.id);
  }, { requestReminderWake(key, items) { wakes.push({ key, items }); return true; } });
});

test('console config API changes real bridge memory injection through host reload', async () => {
  const h = await bridgeHarness({ config: { socialV2: { persistentMemory: { maxChars: 4000 } } } });
  const server = h.startConsoleServer();
  try {
    h.setMode('reserved2');
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    h.pluginHost.callService('memory', 'write', { key: 'private:123', text: '【重要事实】\n' + factLines('Z') });
    let previousCount = 0;
    for (const limit of [600, 1000]) {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/plugins/config', { method: 'POST', headers: { 'content-type': 'application/json', 'x-console-token': 'fixture-console-token' }, body: JSON.stringify({ id: 'ctx-memory-context', config: { maxChars: limit } }) });
      assert.equal(response.status, 200);
      const prompt = h.buildWakePromptV2('private:123', 'message');
      const count = (prompt.match(/Z/g) || []).length;
      assert.ok(count > previousCount && count <= limit); previousCount = count;
    }
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await h.close();
  }
});

test('private followup switch blocks real tool queue and revokes pending delivery across reload', async () => {
  const deliveries = [];
  await isolated(['ctx-chat-topic-drive'], async (host, root) => {
    fs.mkdirSync(path.join(root, 'state'), { recursive: true });
    fs.writeFileSync(path.join(root, 'state/person-profiles.json'), JSON.stringify({ people: { '124': { keys: ['group:456', 'private:124'] } } }));
    const incoming = () => host.emitIncoming({ key: 'group:456', userId: '124', at: Date.now() });
    const request = () => host.callTool('private_followup_send', { groupKey: 'group:456', userId: '124', text: '后来怎么样？' });
    await configure(host, 'ctx-chat-topic-drive', { privateFollowupEnabled: false });
    incoming();
    assert.equal((await request()).result.reason, 'disabled');
    assert.equal(host.get('ctx-chat-topic-drive').state.pendingFollowup ?? null, null);
    await configure(host, 'ctx-chat-topic-drive', { privateFollowupEnabled: true, dailyLimit: 10, minIntervalMinutes: 0 });
    incoming();
    assert.equal((await request()).result.queued, true);
    await configure(host, 'ctx-chat-topic-drive', { privateFollowupEnabled: false });
    host.emitSent({ key: 'group:456', success: true });
    await Promise.resolve();
    assert.equal(deliveries.length, 0);
    assert.equal(host.get('ctx-chat-topic-drive').state.pendingFollowup, null);
    await configure(host, 'ctx-chat-topic-drive', { privateFollowupEnabled: true });
    host.emitSent({ key: 'group:456', success: true });
    await Promise.resolve();
    assert.equal(deliveries.length, 0, 'reenabling must not replay cancelled pending send');
    incoming();
    assert.equal((await request()).result.queued, true);
    host.emitSent({ key: 'group:456', success: true });
    await Promise.resolve();
    assert.equal(deliveries.length, 1);
  }, { async sendPrivateFollowup(input) { deliveries.push(input); return { ok: true }; } });
});

test('startup cooldown vetoes real host wake before the generic greeting tail is assembled', async () => {
  await isolated(['life-proactive-startup-greeting', 'life-wake-reasons'], async host => {
    const key = 'private:124';
    const assembleAllowedTurn = () => {
      if (!host.allowsWake('startupGreeting', { key })) return '';
      const payload = { reason: 'startupGreeting', key, st: {} };
      return host.collectPromptBlocks(payload).join('') + host.collectWakeTails(payload);
    };
    assert.ok(assembleAllowedTurn().includes('本轮开机起床'));
    assert.equal(host.allowsWake('startupGreeting', { key }), false);
    assert.equal(assembleAllowedTurn(), '', 'cooldown must prevent the common startup-greeting tail too');
    assert.equal(host.allowsWake('message', { key }), true);
    assert.equal(host.allowsWake('startupGreeting', { key: 'private:125' }), true);
    await host.reload('life-proactive-startup-greeting');
    assert.equal(host.allowsWake('startupGreeting', { key }), false, 'cooldown persists across reload');
    await configure(host, 'life-proactive-startup-greeting', { cooldownMinutes: 0 });
    assert.ok(assembleAllowedTurn().includes('本轮开机起床'));
    assert.ok(assembleAllowedTurn().includes('本轮开机起床'));
  });
});
