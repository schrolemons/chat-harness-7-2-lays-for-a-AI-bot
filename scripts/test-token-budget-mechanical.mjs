import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/life-token-budget/index.js';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const billedEvent = (sessionId) => ({ sessionId, at: Date.now() - 10, model: 'deepseek-flash', event: {
  type: 'assistant/message', seq: 1, data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 100 } }
} });

test('mechanical replies count unique private messages and group at-mentions without AI', () => {
  let state = {};
  const plugin = createPlugin({
    config: { mechanicalPrivateReplies: ['哥哥我好饿...'], mechanicalGroupReplies: ['咕噜，我在潜水~'] },
    state: { get: () => state, set: (patch) => { state = { ...state, ...patch }; } }
  });
  const onIncoming = plugin.services.tokenBudget.onSilentIncoming;
  const common = { stage: 'silent', periodStart: 123, now: 1000 };
  for (let i = 1; i <= 4; i++) assert.equal(onIncoming({ ...common, key: 'private:1', kind: 'private', messageId: String(i) }).text, null);
  assert.equal(onIncoming({ ...common, key: 'private:1', kind: 'private', messageId: '4' }).text, null);
  assert.equal(onIncoming({ ...common, key: 'private:1', kind: 'private', messageId: '5' }).text, '哥哥我好饿...');
  assert.equal(onIncoming({ ...common, key: 'group:2', kind: 'group', messageId: '6', atSelf: false }).text, null);
  assert.equal(onIncoming({ ...common, key: 'group:2', kind: 'group', messageId: '7', atSelf: true }).text, '咕噜，我在潜水~');
  assert.equal(onIncoming({ ...common, key: 'private:1', kind: 'private', messageId: '8', periodStart: 456 }).text, null);
});

test('recovery processes only the configured recent private window once', async () => {
  let state = {};
  let stage = 'silent';
  const delivered = [];
  const plugin = createPlugin({
    config: { sessions: { 'private:1': { recoveryWindowMessages: 2 } } },
    state: { get: () => structuredClone(state), set: (patch) => { state = { ...state, ...structuredClone(patch) }; } },
    capabilities: {
      budgetRecoveryStatus: () => ({ stage, allowed: true }),
      dispatchBudgetRecovery: async (request) => { delivered.push(request); return { ok: true }; }
    }
  });
  for (let id = 1; id <= 3; id++) plugin.services.tokenBudget.onSilentIncoming({
    key: 'private:1', kind: 'private', messageId: String(id), stage: 'silent', periodStart: 123,
    text: `私聊消息${id}`, at: id * 1000
  });
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 0);
  stage = 'normal';
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].messages.map((message) => message.text), ['私聊消息2', '私聊消息3']);
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 1);
});

test('group recovery needs a real at-mention in the selected window and retries a failed dispatch', async () => {
  let state = {};
  let accepted = false;
  const delivered = [];
  const plugin = createPlugin({
    config: { sessions: { 'group:2': { recoveryWindowMessages: 2 } } },
    state: { get: () => structuredClone(state), set: (patch) => { state = { ...state, ...structuredClone(patch) }; } },
    capabilities: {
      budgetRecoveryStatus: () => ({ stage: 'normal', allowed: true }),
      dispatchBudgetRecovery: async (request) => { delivered.push(request); return { ok: accepted }; }
    }
  });
  const incoming = plugin.services.tokenBudget.onSilentIncoming;
  incoming({ key: 'group:2', kind: 'group', messageId: '1', stage: 'silent', periodStart: 123, text: '较早的 @', atSelf: true });
  incoming({ key: 'group:2', kind: 'group', messageId: '2', stage: 'silent', periodStart: 123, text: '群聊消息2' });
  incoming({ key: 'group:2', kind: 'group', messageId: '3', stage: 'silent', periodStart: 123, text: '群聊消息3' });
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 0);
  incoming({ key: 'group:2', kind: 'group', messageId: '4', stage: 'silent', periodStart: 456, text: '新的 @', atSelf: true });
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 1);
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 2);
  accepted = true;
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 3);
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 3);
});

test('maximum recovery window retains its last message without truncating the prompt', async () => {
  let state = {};
  const delivered = [];
  const plugin = createPlugin({
    config: { sessions: { 'private:1': { recoveryWindowMessages: 30 } } },
    state: { get: () => structuredClone(state), set: (patch) => { state = { ...state, ...structuredClone(patch) }; } },
    capabilities: {
      budgetRecoveryStatus: () => ({ stage: 'normal', allowed: true }),
      dispatchBudgetRecovery: async (request) => { delivered.push(request); return { ok: true }; }
    }
  });
  for (let id = 1; id <= 35; id++) plugin.services.tokenBudget.onSilentIncoming({
    key: 'private:1', kind: 'private', messageId: String(id), stage: 'silent', periodStart: 123,
    text: `第${id}条-${'字'.repeat(480)}`
  });
  await plugin.hooks.onTick();
  assert.equal(delivered[0].messages.length, 30);
  assert.equal(delivered[0].messages[0].id, '6');
  assert.equal(delivered[0].messages.at(-1).id, '35');
  assert.ok(delivered[0].prompt.includes('第35条'));
  assert.ok(delivered[0].prompt.length < 80000);
});

test('hard cap routes private and group inbound messages to mechanical replies only', async () => {
  const h = await bridgeHarness({ files: { 'state/plugins/config/life-token-budget.json': {
    sessions: { 'private:123': { hardLimitYuan: 0.1 }, 'group:456': { hardLimitYuan: 0.1 } },
    mechanicalPrivateReplies: ['哥哥我好饿...'], mechanicalGroupReplies: ['咕噜，我在潜水~']
  } } });
  try {
    h.setMode('reserved2');
    const privateSession = await h.ensureSession('private:123');
    const groupSession = await h.ensureSession('group:456');
    h.tokenLedger.ingestEvent(billedEvent(privateSession));
    h.tokenLedger.ingestEvent(billedEvent(groupSession));
    for (let id = 1; id <= 5; id++) await h.handleIncoming('private', 123, {
      self_id: 999, user_id: 123, message_id: id,
      message: [{ type: 'text', data: { text: '你好' } }]
    }, h.cfg);
    await h.handleIncoming('group', 456, {
      self_id: 999, user_id: 222, group_id: 456, message_id: 6,
      message: [{ type: 'text', data: { text: '普通群消息' } }]
    }, h.cfg);
    await h.handleIncoming('group', 456, {
      self_id: 999, user_id: 222, group_id: 456, message_id: 7,
      message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: '小鲸鱼' } }]
    }, h.cfg);
    assert.deepEqual(h.calls.sent.map(x => [x.kind, x.text]), [
      ['private', '哥哥我好饿...'], ['group', '咕噜，我在潜水~']
    ]);
    assert.equal(h.calls.prompts.length, 0);
  } finally { await h.close(); }
});

test('bridge restores only the latest configured messages after the cap is lifted', async () => {
  const h = await bridgeHarness({ files: { 'state/plugins/config/life-token-budget.json': {
    sessions: { 'private:123': { hardLimitYuan: 0.1, recoveryWindowMessages: 2 } }
  } } });
  try {
    h.setMode('reserved2');
    h.setReady(true);
    const sid = await h.ensureSession('private:123');
    h.tokenLedger.ingestEvent(billedEvent(sid));
    for (let id = 1; id <= 3; id++) await h.handleIncoming('private', 123, {
      self_id: 999, user_id: 123, message_id: id,
      message: [{ type: 'text', data: { text: `恢复消息${id}` } }]
    }, h.cfg);
    assert.equal(h.calls.prompts.length, 0);
    assert.equal(h.pluginHost.callService('tokenBudget', 'recoveryPending', { key: 'private:123' }), 3);
    const config = h.pluginHost.get('life-token-budget').config;
    assert.equal(h.pluginHost.setConfig('life-token-budget', { sessions: {
      ...config.sessions, 'private:123': { ...config.sessions['private:123'], hardLimitYuan: 0 }
    } }).ok, true);
    await h.pluginHost.reload('life-token-budget');
    await h.pluginHost.tick();
    assert.equal(h.calls.prompts.length, 1);
    const submitted = h.calls.prompts[0].content[0].text;
    assert.ok(submitted.includes('恢复消息2'));
    assert.ok(submitted.includes('恢复消息3'));
    assert.ok(!submitted.includes('恢复消息1'));
    await h.pluginHost.tick();
    assert.equal(h.calls.prompts.filter(call => call.content[0].text.includes('额度恢复后的补处理')).length, 1);
  } finally { await h.close(); }
});

test('recovery attaches a still-staged incoming image to the model turn', async () => {
  const h = await bridgeHarness({ files: { 'state/plugins/config/life-token-budget.json': {
    sessions: { 'private:123': { hardLimitYuan: 0.1, recoveryWindowMessages: 1 } }
  } } });
  try {
    h.setMode('reserved2');
    h.setReady(true);
    const sid = await h.ensureSession('private:123');
    h.tokenLedger.ingestEvent(billedEvent(sid));
    await h.handleIncoming('private', 123, {
      self_id: 999, user_id: 123, message_id: 41,
      message: [{ type: 'image', data: { file: 'fixture-image.png' } }]
    }, h.cfg);
    assert.equal(h.calls.prompts.length, 0);
    const config = h.pluginHost.get('life-token-budget').config;
    h.pluginHost.setConfig('life-token-budget', { sessions: {
      ...config.sessions, 'private:123': { ...config.sessions['private:123'], hardLimitYuan: 0 }
    } });
    await h.pluginHost.reload('life-token-budget');
    await h.pluginHost.tick();
    assert.equal(h.calls.prompts.length, 1);
    assert.ok(h.calls.prompts[0].content.some((part) => part.type === 'image'));
  } finally { await h.close(); }
});

test('global cap blocks direct task and maintenance model prompts', async () => {
  const h = await bridgeHarness({ files: { 'state/plugins/config/life-token-budget.json': { globalHardLimitYuan: 0.1 } } });
  try {
    h.setMode('reserved2');
    const sid = await h.ensureSession('private:123');
    h.tokenLedger.ingestEvent(billedEvent(sid));
    await assert.rejects(h.api.sessions.prompt({ sessionId: 'background-task', mode: 'queue', content: [{ type: 'text', text: 'test' }] }), /额度|预算/);
    assert.equal(h.calls.prompts.length, 0);
  } finally { await h.close(); }
});

test('hard cap blocks ordinary queued QQ sends while allowing mechanical replies', async () => {
  const h = await bridgeHarness({ files: { 'state/plugins/config/life-token-budget.json': { globalHardLimitYuan: 0.1 } } });
  try {
    const sid = await h.ensureSession('private:123');
    h.tokenLedger.ingestEvent(billedEvent(sid));
    assert.equal(await h.sendToQQ('private:123', 'ordinary notification'), false);
    assert.equal(h.calls.sent.length, 0);
    assert.equal(await h.sendToQQ('private:123', '机械冒泡', { budgetMechanical: true }), true);
    assert.equal(h.calls.sent.length, 1);
  } finally { await h.close(); }
});

test('console manages separate private and group mechanical reply lists', async () => {
  const h = await bridgeHarness();
  const server = h.startConsoleServer();
  try {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/tokens/budgets/replies`;
    const headers = { 'x-console-token': 'fixture-console-token' };
    const get = async () => fetch(url, { headers }).then(async response => ({ status: response.status, data: await response.json() }));
    const post = async (body, extraHeaders = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...extraHeaders, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async response => ({ status: response.status, data: await response.json() }));
    const initial = await get();
    assert.equal(initial.status, 200);
    assert.ok(initial.data.privateReplies.length >= 20);
    assert.ok(initial.data.groupReplies.length >= 20);
    assert.equal((await post({ privateReplies: [], groupReplies: ['hi'] })).status, 400);
    assert.equal((await post({ privateReplies: ['私聊词条'], groupReplies: ['群聊词条'] }, { 'x-agent-token': 'forbidden' })).status, 403);
    assert.equal((await post({ privateReplies: ['私聊词条'], groupReplies: ['群聊词条'] })).status, 200);
    const saved = await get();
    assert.deepEqual(saved.data.privateReplies, ['私聊词条']);
    assert.deepEqual(saved.data.groupReplies, ['群聊词条']);
  } finally { await new Promise(resolve => server.close(resolve)); await h.close(); }
});

test('console validates and persists a per-conversation recovery window', async () => {
  const h = await bridgeHarness();
  const server = h.startConsoleServer();
  try {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/tokens/budgets`;
    const headers = { 'x-console-token': 'fixture-console-token', 'content-type': 'application/json' };
    const base = { key: 'private:123', coldLimitYuan: 0.1, hardLimitYuan: 0.2, weakMinIntervalMin: 30 };
    const post = (body) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await post({ ...base, recoveryWindowMessages: 0 })).status, 400);
    assert.equal((await post({ ...base, recoveryWindowMessages: 31 })).status, 400);
    assert.equal((await post({ ...base, recoveryWindowMessages: 2.5 })).status, 400);
    assert.equal((await post({ ...base, recoveryWindowMessages: 7 })).status, 200);
    const data = await fetch(url, { headers }).then(response => response.json());
    assert.equal(data.rows.find(row => row.key === 'private:123').recoveryWindowMessages, 7);
  } finally { await new Promise(resolve => server.close(resolve)); await h.close(); }
});
