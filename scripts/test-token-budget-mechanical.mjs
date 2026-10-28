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
