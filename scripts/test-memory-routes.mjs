import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAffairStore } from '../plugins/qq-components/ctx-memory-store/affairs.mjs';
import { bridgeHarness } from './audit-bridge-harness.mjs';
const module = await import('../src/console/memory-management.js').catch(() => ({}));
test('affairs API edits real data, enforces session token, reports conflicts and full-item preview', async t => {
  assert.equal(typeof module.routeMemoryManagement, 'function', 'memory route exists');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-memory-api-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createAffairStore(root);
  async function call(method, query, body, token) {
    let result;
    const handled = await module.routeMemoryManagement({ req: { method, headers: token ? { 'x-agent-token': token } : {} },
      url: new URL('http://localhost/api/socialV2/affairs' + query), readBody: async () => body,
      agentTokenOk: (key, value) => key === 'private:1' && value === 'one', affairsMaxChars: 4000,
      pluginHost: { callService: (_, action, input) => store[action](input) }, sendJson: (value, code = 200) => { result = { value, code }; } });
    assert.equal(handled, true); return result;
  }
  assert.equal((await call('GET', '?key=private:2', null, 'one')).code, 403);
  assert.equal((await call('POST', '', { key: 'private:1', action: 'upsert', title: '周五报告', detail: '写提纲', status: 'pending' }, 'one')).value.ok, true);
  const list = await call('GET', '?key=private:1', null, 'one');
  const item = list.value.items[0]; assert.equal(item.title, '周五报告'); assert.ok(list.value.preview.selectedIds.includes(item.id));
  const changed = await call('POST', '', { key: 'private:1', action: 'upsert', id: item.id, expectedRevision: item.revision, status: 'done' });
  assert.equal(changed.value.item.status, 'done');
  assert.equal((await call('POST', '', { key: 'private:1', action: 'upsert', id: item.id, expectedRevision: item.revision, title: '过期写入' })).code, 409);
  assert.equal((await call('GET', '?key=private:1&status=all')).value.total, 1);
  assert.equal((await call('GET', '?key=private:1')).value.total, 0);
  assert.equal((await call('POST', '', { key: 'private:1', action: 'upsert', title: '' })).code, 400);
});
test('actual bridge HTTP path rejects relay token for another memory and respects tool switch', async () => {
  const h = await bridgeHarness({ config: { allow: { private: ['123', '124'], groups: ['456'] } } });
  const server = h.startConsoleServer();
  try {
    h.setMode('reserved2');
    h.getSocialV2State('private:123').agentToken = 'owner-session-token';
    h.getSocialV2State('private:124').agentToken = 'other-session-token';
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const headers = { 'x-console-token': 'fixture-console-token', 'x-agent-call': '1', 'x-agent-token': 'owner-session-token', 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/api/socialV2/affairs?key=private:124', { headers })).status, 403);
    assert.equal((await fetch(base + '/api/socialV2/memory?key=private:124', { headers })).status, 403);
    for (const operation of ['append', 'update', 'remove', 'clear']) {
      const response = await fetch(base + '/api/socialV2/memory-' + operation, { method: 'POST', headers,
        body: JSON.stringify({ key: 'private:124', category: 'activeTopic', content: '另一会话内容', oldContent: '旧话题', newContent: '新话题' }) });
      assert.equal(response.status, 403, operation + ' cannot reuse relay authorization');
    }
    const created = await fetch(base + '/api/socialV2/affairs', { method: 'POST', headers, body: JSON.stringify({ key: 'private:123', action: 'upsert', title: '继续整理记忆', status: 'doing' }) });
    assert.equal(created.status, 200); const item = (await created.json()).item; assert.ok(item.id);
    assert.ok(h.buildWakePromptV2('private:123', 'message').includes('继续整理记忆'));
    const st = h.getSocialV2State('private:123'), now = Date.now();
    st.recentMessages = [{ seq: 1, sender: '甲', userId: '123', time: now - 1000, text: '在当前窗口' }];
    st.memberImpressions = { 甲: { traits: ['窗口内行为'], lastSeenAt: now }, 乙: { traits: ['窗口外旧印象'], lastSeenAt: now } };
    const light = await (await fetch(base + '/api/socialV2/memory?key=private:123', { headers })).json();
    assert.ok(light.formatted.includes('当前小上下文窗口内对用户的行为印象'));
    assert.ok(light.formatted.includes('窗口内行为') && !light.formatted.includes('窗口外旧印象'));
    assert.equal((await fetch(base + '/api/socialV2/affairs', { method: 'POST', headers, body: JSON.stringify({ key: 'private:123', action: 'upsert', title: '' }) })).status, 400);
    h.cfg.socialV2.tools.taskNote = false;
    assert.equal((await fetch(base + '/api/socialV2/affairs?key=private:123', { headers })).status, 403);
    assert.equal((await fetch(base + '/api/socialV2/affairs?key=private:123', { headers: { 'x-console-token': 'fixture-console-token' } })).status, 200);
  } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); await h.close(); }
});

for (const budgetStage of ['weak', 'silent']) test('agent light memory obeys ' + budgetStage + ' budget view while admin retains its ordinary view', async () => {
  const h = await bridgeHarness({
    files: { 'state/plugins/config/life-token-budget.json': { ownerBudgetEnabled: true,
      recoveryWindows: { privateMessages: 1, groupMessages: 1, groupAtMessages: 1 } } },
    config: { socialV2: { context: { contextWindow: 20 } } }
  });
  h.setMode('reserved2');
  const key = 'private:123', st = h.getSocialV2State(key), now = Date.now();
  const callService = h.pluginHost.callService.bind(h.pluginHost);
  h.pluginHost.callService = (name, method, payload) => name === 'tokenBudget' && method === 'assess'
    ? { ...callService(name, method, payload), stage: budgetStage } : callService(name, method, payload);
  st.recentMessages = [
    { seq: 1, messageId: 'outside', sender: 'older', userId: '111', time: now - 1000 },
    { seq: 2, messageId: 'inside', sender: 'latest', userId: '222', time: now }
  ];
  st.unread = [...st.recentMessages];
  st.memberImpressions = { older: { traits: ['OUTSIDE_COLD_WINDOW_BEHAVIOR'], lastSeenAt: now },
    latest: { traits: ['CURRENT_BEHAVIOR'], lastSeenAt: now } };
  const server = h.startConsoleServer();
  try {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const endpoint = 'http://127.0.0.1:' + server.address().port + '/api/socialV2/memory?key=' + key;
    const headers = { 'x-console-token': 'fixture-console-token' };
    const adminResponse = await fetch(endpoint, { headers }); assert.equal(adminResponse.status, 200);
    const admin = await adminResponse.json();
    assert.deepEqual(Object.keys(admin.raw.memberImpressions), ['older', 'latest']);
    assert.ok(admin.formatted.includes('OUTSIDE_COLD_WINDOW_BEHAVIOR'));
    assert.equal(st.recentMessages[0].budgetDisposition, undefined, 'admin viewing must not settle budget policy');
    const agentResponse = await fetch(endpoint, { headers: { ...headers, 'x-agent-token': st.agentToken } });
    assert.equal(agentResponse.status, 200); const agent = await agentResponse.json();
    assert.ok(!JSON.stringify(agent).includes('OUTSIDE_COLD_WINDOW_BEHAVIOR'));
    if (budgetStage === 'silent') {
      assert.deepEqual(agent.raw.memberImpressions, {});
      assert.ok(!agent.formatted.includes('CURRENT_BEHAVIOR'));
      const adminAfter = await (await fetch(endpoint, { headers })).json();
      assert.deepEqual(Object.keys(adminAfter.raw.memberImpressions), ['older', 'latest']);
    } else {
      assert.deepEqual(Object.keys(agent.raw.memberImpressions), ['latest']);
      assert.ok(agent.formatted.includes('CURRENT_BEHAVIOR'));
    }
  } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); await h.close(); }
});
