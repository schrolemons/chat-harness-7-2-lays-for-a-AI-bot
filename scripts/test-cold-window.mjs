// Offline only: pure components + audit bridge with fake peers and temporary state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/life-token-budget/index.js';
import { modelStateViewV2, isModelVisibleMessageV2 } from '../src/bridge-core/receipt-state.js';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const limits = { privateMessages: 5, groupMessages: 5, groupAtMessages: 5 };
test('one selector uses the same configured private and separate group/at windows in original sequence order', () => {
  const plugin = createPlugin({ config: { recoveryWindows: { privateMessages: 2, groupMessages: 2, groupAtMessages: 1 } }, state: { get: () => ({}) } });
  const messages = [{ seq: 6, atSelf: true }, { seq: 1 }, { seq: 3 }, { seq: 2, atSelf: true }, { seq: 5 }, { seq: 4 }];
  assert.deepEqual(plugin.services.tokenBudget.selectWindow({ key: 'private:123', messages }).map(m => m.seq), [5, 6]);
  assert.deepEqual(plugin.services.tokenBudget.selectWindow({ key: 'group:456', messages }).map(m => m.seq), [4, 5, 6]);
});

test('model state view filters message reads while preserving real non-message writes', () => {
  const st = { unread: [{ seq: 1, quotaAdmission: 'rejected' }, { seq: 2 }], recentMessages: [], pendingTimeBubble: { label: 'test' } };
  const view = modelStateViewV2(st); view.pendingTimeBubble = null; view.pendingTaskReport = 'fixture';
  assert.equal(st.pendingTimeBubble, null); assert.equal(st.pendingTaskReport, 'fixture');
  assert.deepEqual(view.unread.map(m => m.seq), [2]);
  assert.equal(isModelVisibleMessageV2({ budgetDisposition: 'outside-cold-window' }), false);
});

test('silent recovery dispatch selects the same two group buckets with the same configured window', async () => {
  let state = { recovery: { 'group:456': { messages: Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), text: 'raw-' + i, quotaText: 'admission-' + i, at: i + 1, atSelf: (i + 1) % 2 === 0 })) } } }, selected, prompt;
  const plugin = createPlugin({ config: { recoveryWindows: { privateMessages: 2, groupMessages: 2, groupAtMessages: 1 } },
    state: { get: () => state, set: patch => { state = { ...state, ...patch }; } },
    capabilities: { budgetRecoveryStatus: () => ({ stage: 'normal', allowed: true }), dispatchBudgetRecovery: payload => { selected = payload.messages; prompt = payload.prompt; return { ok: true }; } } });
  await plugin.hooks.onTick();
  assert.deepEqual(selected.map(message => message.id), ['3', '5', '6']);
  assert.ok(selected.every(message => message.quotaText));
  assert.doesNotMatch(prompt, /quotaText|admission-/);
});

async function open(t) {
  const h = await bridgeHarness({ files: { 'state/plugins/config/life-token-budget.json': { ownerBudgetEnabled: true, recoveryWindows: limits } },
    config: { socialV2: { enabled: true, curfew: { enabled: false }, readReceipt: { enabled: false },
      context: { inlineWakeMessages: true, wakeMaxChars: 20000, unreadLimit: 100, recentLimit: 100 },
      wait: { minMs: 100, minQuietAfterNewMs: 0 }, wake: { preSleepWaitEnabled: false } } } });
  h.setMode('reserved2');
  for (const id of ['obs-health-monitor', 'obs-bridge-health', 'obs-self-review', 'life-campus-watch', 'life-daily-worklog', 'eval-regression']) h.pluginHost.setEnabled(id, false);
  let stage = 'weak'; const call = h.pluginHost.callService.bind(h.pluginHost);
  h.pluginHost.callService = (name, method, payload) => name === 'tokenBudget' && method === 'assess'
    ? { ...call(name, method, payload), stage } : call(name, method, payload);
  const server = h.startConsoleServer(); if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await h.close(); });
  const api = async (route, key, body, admin = false) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, { method: body ? 'POST' : 'GET',
      headers: { 'x-console-token': 'fixture-console-token', ...(admin ? {} : { 'x-agent-token': h.getSocialV2State(key).agentToken }), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200); return response.json();
  };
  return { h, api, stage: value => { stage = value; } };
}
function add(h, key, count, mentions = false) {
  for (let i = 1; i <= count; i++) {
    h.appendSocialV2Message(key, 'fixture', 'm' + i, 'm' + i, false, false, 'fixture-' + key + '-' + i, [], '789', []);
    h.getSocialV2State(key).recentMessages.at(-1).atSelf = mentions && i % 2 === 0;
  }
}

test('weak private snapshot keeps latest configured five, disposes old unread without fake receipt stamps', async t => {
  const { h } = await open(t), key = 'private:123'; add(h, key, 10);
  const st = h.getSocialV2State(key); st.doubleStampCheck = { windowSeqs: [1, 2, 3], triggerSeq: 3 };
  const packet = h.buildWakeSnapshotV2(key, true);
  assert.deepEqual(Array.from(packet.messages, m => m.seq), [6, 7, 8, 9, 10]);
  assert.deepEqual(Array.from(st.unread, m => m.seq), [6, 7, 8, 9, 10]);
  for (const old of st.recentMessages.slice(0, 5)) { assert.equal(old.budgetDisposition, 'outside-cold-window'); assert.equal(old.seenAt, undefined); assert.equal(old.repliedAt, undefined); }
  assert.equal(packet.receiptWindow.length, 0); assert.equal(packet.pendingFromSeq, 6);
});

test('weak agent unread/recent/wait and plugin prompt all share one window; admin retains raw evidence', async t => {
  const { h, api } = await open(t), key = 'group:456'; add(h, key, 20, true);
  const waited = await api('/api/socialV2/wait', key, { key, purpose: 'reply', timeoutMs: 100 });
  const unread = await api('/api/socialV2/unread?key=' + key + '&limit=100&afterSeq=0', key);
  const recent = await api('/api/socialV2/recent?key=' + key + '&limit=100', key);
  const expected = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  assert.deepEqual(unread.messages.map(m => m.seq), expected); assert.deepEqual(recent.messages.map(m => m.seq), expected);
  assert.deepEqual(waited.newMessages.map(m => m.seq), expected);
  let payload; h.pluginHost.collectPromptModules = p => { payload = p; p.st.pendingTimeBubble = null; return []; };
  const st = h.getSocialV2State(key); st.pendingTimeBubble = { label: 'fixture' };
  h.buildWakePromptV2(key, 'private', 'weak');
  assert.equal(payload.st, payload.state); assert.equal(payload.st.unread.length, 10); assert.equal(payload.st.recentMessages.length, 10); assert.equal(st.pendingTimeBubble, null);
  const raw = await api('/api/socialV2/recent?key=' + key + '&limit=100', key, undefined, true);
  assert.equal(raw.messages.length, 20);
});

test('hard cap gives agents empty views; normal stage does not acquire a cold window limit', async t => {
  const { h, api, stage } = await open(t), key = 'private:123'; add(h, key, 10);
  stage('silent');
  assert.equal((await api('/api/socialV2/unread?key=' + key + '&limit=100', key)).messages.length, 0);
  assert.equal((await api('/api/socialV2/recent?key=' + key + '&limit=100', key)).messages.length, 0);
  stage('normal');
  assert.equal((await api('/api/socialV2/unread?key=' + key + '&limit=100', key)).messages.length, 10);
});

for (const handledBy of ['hard-cap', 'quota']) test('four thinking timers are cancelled after ' + handledBy + ' handles incoming without a model', async t => {
  const { h, stage } = await open(t), key = 'private:123'; stage('normal');
  const call = h.pluginHost.callService.bind(h.pluginHost);
  h.pluginHost.callService = (name, method, payload) => name === 'messageAck' && method === 'plan'
    ? { wait: { enabled: true, delayMs: 20, text: 'THINKING-WAIT' }, apology: { enabled: true, delayMs: 40, text: 'THINKING-APOLOGY' } }
    : handledBy === 'quota' && name === 'knowledgeQuota' && method === 'preflight'
      ? (payload.onHandled?.(), { handled: true }) : call(name, method, payload);
  h.getSocialV2State(key).bootstrapSent = true;
  const inbound = h.noteMessageAckInbound(key); h.scheduleMessageReadAck(key, inbound);
  assert.ok(h.messageAckArmed.get(key));
  if (handledBy === 'hard-cap') stage('silent');
  await h.handleIncoming('private', 123, { user_id: 123, self_id: 999, message_id: 'handled-fixture', sender: { nickname: 'fixture' }, message: [{ type: 'text', data: { text: 'fixture' } }] }, h.cfg);
  assert.equal(h.messageAckArmed.get(key), undefined);
  assert.equal(h.calls.prompts.length, 0, 'handled incoming must not submit its own model turn');
  await h.pluginHost.tick(Date.now() + 1000); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.calls.sent.filter(item => item.text.startsWith('THINKING-')).length, 0);
});
