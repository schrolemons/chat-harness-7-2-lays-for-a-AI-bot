import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bridgeHarness, fixtureReplyTurn } from './audit-bridge-harness.mjs';

async function fixture(key, run) {
  const h = await bridgeHarness({ config: { allow: { private: ['123'], groups: ['456'] }, socialV2: { wait: { defaultMs: 100, minMs: 100, maxMs: 500, defaultQuietMs: 0, minQuietAfterNewMs: 0 }, doubleStamp: { enabled: false } } } });
  let server;
  try {
    h.setMode('reserved2');
    const sid = await fixtureReplyTurn(h, key), st = h.getSocialV2State(key);
    server = h.startConsoleServer();
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const request = (route, body) => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/socialV2/' + route,
        method: 'POST', headers: { 'x-console-token': 'fixture-console-token', 'x-agent-token': st.agentToken, 'content-type': 'application/json' } }, res => {
        let text = ''; res.on('data', c => text += c); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
      });
      req.on('error', reject); req.end(JSON.stringify({ key, ...body }));
    });
    const configured = h.pluginHost.setConfig('life-conversation-wait', { endProbabilityPercent: 100 });
    assert.equal(configured.ok, true);
    await h.pluginHost.reload('life-conversation-wait');
    await run({ h, st, sid, request });
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await h.close(); }
}
for (const key of ['private:123', 'group:456']) {
  test(key + ': hard close cancels only current turn, does not archive/erase inbox or restart observation', async () => {
    await fixture(key, async ({ h, sid, request }) => {
      const result = await request('wait', { purpose: 'messages', timeoutMs: 100 });
      assert.equal(result.data.endRound, true);
      assert.equal(result.data.probabilityPercent, 100);
      assert.equal(h.taskCaps.getProactiveFacts(key).conversationAwake,false,'wait verdict closes admission before cancellation event arrives');
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(h.calls.cancelled.some(c => c.method === 'session/cancel' && c.params.sessionId === sid));
      assert.deepEqual(h.calls.archived, []);
      const again = await request('wait', { purpose: 'reply', timeoutMs: 100 });
      assert.equal(again.data.endRound, true);
      assert.equal(again.data.waitedMs, 0, 'quiet must not bypass terminal state');
    });
  });
  test(key + ': real new messages beat timeout closure and remain available to quiet tool', async () => {
    await fixture(key, async ({ h, st, request }) => {
      const waiting = request('wait', { purpose: 'messages', timeoutMs: 400 });
      await new Promise(resolve => setTimeout(resolve, 30));
      h.appendSocialV2Message(key, 'fixture', '第一件事', '第一件事', false, false, 'message-one', [], '789');
      h.appendSocialV2Message(key, 'fixture', '第二件事', '第二件事', false, false, 'message-two', [], '789');
      const result = await waiting;
      assert.equal(result.data.endRound, false);
      assert.equal(result.data.emptyWaits, 0);
      assert.equal(result.data.newMessages.length, 2);
      assert.equal(h.calls.cancelled.length, 0);
      const quiet = await request('wait', { purpose: 'reply', timeoutMs: 100, quietMs: 0 });
      assert.equal(quiet.data.endRound, false);
      assert.equal(quiet.data.emptyWaits, 0);
      assert.equal(st.lastUnreadSeq, 2);
    });
  });
  test(key + ': a new arrival or a newer turn invalidates the old close callback', async () => {
    await fixture(key, async ({ h, st, sid }) => {
      const old = h.activeTurnEnvelopes.get(sid), seq = st.lastUnreadSeq || 0;
      h.appendSocialV2Message(key, 'fixture', '及时补充', '及时补充', false, false, 'boundary-message', [], '789');
      assert.equal(await h.finishIdleWaitTurn(key, old, seq), false);
      const newer = { ...old, turn: old.turn + 1 };
      h.activeTurnEnvelopes.set(sid, newer);
      assert.equal(await h.finishIdleWaitTurn(key, old, st.lastUnreadSeq), false);
      assert.equal(h.calls.cancelled.length, 0);
      assert.equal(st.unread.length, 1);
    });
  });
  test(key + ': inbound arriving during cancel is retained and re-admitted after the old turn ends', async () => {
    await fixture(key, async ({ h, st, sid, request }) => {
      let release;
      const gate = new Promise(resolve => release = resolve);
      const original = h.api.callUnary;
      h.api.callUnary = async (...args) => { if (args[0] === 'session/cancel') await gate; return original(...args); };
      const result = await request('wait', { purpose: 'messages', timeoutMs: 100 });
      assert.equal(result.data.endRound, true);
      const oldTurn = h.activeTurnEnvelopes.get(sid).turn;
      h.appendSocialV2Message(key, 'fixture', '取消中到达', '取消中到达', false, false, 'cancel-race-message', [], '789');
      release();
      await h.queueDshEnvelope({ payload: { type: 'session/event', sessionId: sid, event: { type: 'turn/end', data: { turn: oldTurn, reason: { kind: 'aborted' } } } } });
      await h.pluginHost.tick(Date.now() + 10);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(st.unread.length, 1);
      assert.ok(h.calls.prompts.length >= 2, 'fresh incoming must get a new processing opportunity: ' + JSON.stringify({ count: h.calls.prompts.length, active: h.activeTurnEnvelopes.get(sid), pendingWakeReason: st.pendingWakeReason, pendingWakeReasons: st.pendingWakeReasons, pendingTimer: !!st.pendingWakeTimer }));
      assert.deepEqual(h.calls.archived, []);
    });
  });
}

test('wake frequency caps apply to groups only; private direct input stays admitted', async () => {
  const h = await bridgeHarness({ config: { socialV2: { wake: { maxWakePerMinute: 1, maxWakePerHour: 1 } } } });
  try {
    h.setMode('reserved2');
    for (const key of ['group:456', 'private:123']) {
      const st = h.getSocialV2State(key);
      st.wakeTimes = [Date.now()];
      h.appendSocialV2Message(key, 'fixture', '真实来信', '真实来信', false, false, 'rate-' + key, [], '123');
      await h.sendWakePromptV2(key, 'message');
      assert.equal(!!st.rateLimitRetryTimer, key.startsWith('group:'));
      assert.equal(st.unread.length, 1);
    }
    assert.ok(h.calls.prompts.length > 0, 'private must be delivered despite full group-style quotas');
  } finally { await h.close(); }
});
