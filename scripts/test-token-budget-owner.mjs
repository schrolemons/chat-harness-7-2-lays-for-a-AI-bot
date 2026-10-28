import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const file = 'state/plugins/config/life-token-budget.json';
const billed = sid => ({ sessionId: sid, at: Date.now() - 10, model: 'deepseek-flash', event: {
  type: 'assistant/message', seq: 1, data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 100 } }
} });

test('owner exemption bypasses personal/global tiers but still accounts spend and restricts other sessions', async () => {
  const h = await bridgeHarness({ files: { [file]: { ownerBudgetEnabled: false, globalHardLimitYuan: 0.1,
    sessions: { 'private:123': { coldLimitYuan: 0.01, hardLimitYuan: 0.02, weakMinIntervalMin: 30 } } } } });
  try {
    const sid = await h.ensureSession('private:123');
    h.tokenLedger.ingestEvent(billed(sid));
    const owner = h.tokenBudgetOf('private:123');
    assert.equal(owner.stage, 'normal');
    assert.equal(owner.exempt, true);
    assert.ok(owner.cost > 0.1);
    assert.ok(owner.globalCost >= owner.cost);
    assert.equal(h.tokenBudgetOf('group:456').stage, 'silent');
    await h.api.sessions.prompt({ sessionId: sid, content: [] });
    assert.equal(await h.sendToQQ('private:123', 'owner reply'), true);
    await assert.rejects(h.api.sessions.prompt({ sessionId: 'unknown-task', content: [] }), /额度|预算/);
    assert.equal(await h.sendToQQ('group:456', 'ordinary reply'), false);
    assert.equal(h.pluginHost.callService('tokenBudget', 'canDispatch', { key: 'private:123', stage: 'weak', now: 1 }), true);
  } finally { await h.close(); }
});

test('persisted owner tasks inherit exemption; other tasks and maintenance remain capped', async () => {
  const tasks = { owner: { id: 'owner', sessionId: 'owner-task', originKey: 'private:123' },
    group: { id: 'group', sessionId: 'group-task', originKey: 'group:456' } };
  const h = await bridgeHarness({ files: { [file]: { ownerBudgetEnabled: false, globalHardLimitYuan: 0.1 },
    'state/tasks.json': { tasks } } });
  try {
    const sid = await h.ensureSession('group:456');
    h.tokenLedger.ingestEvent(billed(sid));
    await h.api.sessions.prompt({ sessionId: 'owner-task', content: [] });
    await assert.rejects(h.api.sessions.prompt({ sessionId: 'group-task', content: [] }), /额度|预算/);
    await assert.rejects(h.api.sessions.prompt({ sessionId: 'maintenance', content: [] }), /额度|预算/);
  } finally { await h.close(); }
});

test('console owner switch defaults on, validates, persists and hot reloads both directions', async () => {
  const h = await bridgeHarness({ files: { [file]: { globalHardLimitYuan: 0.1 } } });
  const server = h.startConsoleServer();
  try {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/tokens/budgets`;
    const headers = { 'x-console-token': 'fixture-console-token', 'content-type': 'application/json' };
    const post = async (body, extra = {}) => fetch(base + '/owner', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    const sid = await h.ensureSession('private:123');
    h.tokenLedger.ingestEvent(billed(sid));
    assert.equal((await (await fetch(base, { headers })).json()).owner.budgetEnabled, true);
    assert.equal(h.tokenBudgetOf('private:123').stage, 'silent');
    assert.equal((await post({ ownerBudgetEnabled: 'false' })).status, 400);
    assert.equal((await post({ ownerBudgetEnabled: false }, { 'x-agent-token': 'forbidden' })).status, 403);
    assert.equal((await post({ ownerBudgetEnabled: false })).status, 200);
    assert.equal(h.tokenBudgetOf('private:123').stage, 'normal');
    assert.equal(h.pluginHost.get('life-token-budget').config.ownerBudgetEnabled, false);
    assert.equal((await post({ ownerBudgetEnabled: true })).status, 200);
    assert.equal(h.tokenBudgetOf('private:123').stage, 'silent');
    await assert.rejects(h.api.sessions.prompt({ sessionId: sid, content: [] }), /额度|预算/);
  } finally { await new Promise(resolve => server.close(resolve)); await h.close(); }
});
