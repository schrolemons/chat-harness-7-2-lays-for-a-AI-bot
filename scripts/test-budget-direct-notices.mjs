import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const KEY = 'private:124';
async function open(t, stage = 'silent') {
  const h = await bridgeHarness({ config: { allow: { private: ['124'], groups: ['456'] }, sendDelayMs: 0,
    socialV2: { curfew: { enabled: false }, proactive: { enabled: false }, readReceipt: { enabled: true }, wake: { preSleepWaitEnabled: false } } },
    files: { 'state/plugins/config/life-token-budget.json': { sessions: { [KEY]: stage === 'silent'
      ? { hardLimitYuan: 0.1 } : { coldLimitYuan: 0.1, weakMinIntervalMin: 30 } } } } });
  h.setMode('reserved2'); const st = h.getSocialV2State(KEY); st.bootstrapSent = true;
  const sid = await h.ensureSession(KEY);
  if (stage !== 'normal') h.tokenLedger.ingestEvent({ sessionId: sid, at: Date.now() - 10, model: 'deepseek-flash', event: { type: 'assistant/message', seq: 1,
    data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 100 } } } });
  assert.equal(h.tokenBudgetOf(KEY).stage, stage);
  t.after(() => h.close()); return { h, st };
}

for (const stage of ['weak', 'silent']) {
  test(`${stage}: website notifications bypass model budget, keep delivery receipts and never invoke a model`, async t => {
    const { h } = await open(t, stage), now = Date.now();
    const items = [{ id: 'website-1', text: '网站正文更新', sourceAt: now, expiresAt: now + 60000 }];
    assert.equal((await h.taskCaps.sendNotificationBatch(KEY, items)).sent, true);
    await h.taskCaps.sendNotificationBatch(KEY, items);
    assert.equal(h.calls.sent.filter(x => x.text.includes('网站正文更新')).length, 1);
    assert.equal(h.calls.prompts.length, 0);
    assert.equal(await h.sendToQQ(KEY, 'ordinary model reply'), stage !== 'silent');
  });
  test(`${stage}: a due reminder sends its stored text without model dispatch and consumes only the successful batch`, async t => {
    const { h, st } = await open(t, stage);
    st.pendingReminderItems = [{ id: 'schedule-1', text: '提交实验报告', dueAt: Date.now(), requestedAt: Date.now(), intervalMinutes: 5 }];
    await h.sendWakePromptV2(KEY, 'reminder');
    assert.equal(h.calls.sent.filter(x => x.text.includes('提交实验报告')).length, 1);
    assert.equal(h.calls.prompts.length, 0); assert.equal(st.pendingReminderItems.length, 0);
  });
  test(`${stage}: time bubbles use a short literal template rather than executing their LLM hint`, async t => {
    const { h, st } = await open(t, stage);
    st.lastTimeBubbleId = '2026-10-29:lunch';
    st.pendingTimeBubble = { label: '午饭点', hint: 'INSTRUCTION_ONLY_NEVER_SEND' };
    await h.sendWakePromptV2(KEY, 'timeBubble');
    assert.equal(h.calls.sent.length, 1); assert.match(h.calls.sent[0].text, /午饭点/);
    assert.ok(!h.calls.sent[0].text.includes('INSTRUCTION_ONLY_NEVER_SEND'));
    assert.equal(h.calls.prompts.length, 0); assert.equal(st.pendingTimeBubble, null);
    st.pendingTimeBubble = { label: '午饭点', hint: '' };
    await h.sendWakePromptV2(KEY, 'timeBubble'); assert.equal(h.calls.sent.length, 1);
  });
}

test('direct notifications keep pause and whitelist gates and do not consume receipts when blocked', async t => {
  const { h } = await open(t), now = Date.now(), items = [{ id: 'blocked', text: 'never while paused', sourceAt: now, expiresAt: now + 60000 }];
  h.socialV2.paused = true;
  assert.equal((await h.taskCaps.sendNotificationBatch(KEY, items)).ok, false);
  h.socialV2.paused = false;
  assert.equal((await h.taskCaps.sendNotificationBatch('private:999', items)).ok, false);
  assert.equal(h.calls.sent.length, 0);
  assert.equal(h.taskCaps.deliveryStatus('notification:' + KEY + ':blocked').status, 'absent');
});

test('a website notice does not pretend to answer an unrelated question or cancel its thinking timers', async t => {
  const { h } = await open(t, 'normal');h.v2TurnStartAt.set(h.state.sessions[KEY],Date.now());
  const at = h.noteMessageAckInbound(KEY, Date.now()); h.scheduleMessageReadAck(KEY, at);
  assert.equal(h.messageAckArmed.has(KEY), true);
  await h.taskCaps.sendNotificationBatch(KEY, [{ id: 'independent-notice', text: '独立网站通知', sourceAt: at, expiresAt: at + 60000 }]);
  assert.equal(h.messageAckArmed.has(KEY), true, 'notification is not a reply to the pending user question');
});

function enterWeak(h) {
  h.tokenLedger.ingestEvent({ sessionId: h.state.sessions[KEY], at: Date.now() - 10, model: 'deepseek-flash',
    event: { type: 'assistant/message', seq: 900, data: { turn: 900, step: 1,
      usage: { inputTokens: 1_000_000, outputTokens: 100 } } } });
  assert.equal(h.tokenBudgetOf(KEY).stage, 'weak');
}
function turnStart(h, turn) {
  return h.queueDshEnvelope({ payload: { type: 'session/event', sessionId: h.state.sessions[KEY],
    event: { type: 'turn/start', data: { turn } } } });
}

test('accepted reminder awaiting turn start is not sent again by direct fallback after entering weak budget', async t => {
  const { h, st } = await open(t, 'normal');
  st.pendingReminderItems = [{ id: 'accepted-reminder', text: 'accepted reminder body', dueAt: Date.now(), requestedAt: 1, intervalMinutes: 5 }];
  await h.sendWakePromptV2(KEY, 'reminder');
  assert.equal(h.calls.prompts.length, 1);
  enterWeak(h);
  await h.sendWakePromptV2(KEY, 'reminder');
  assert.equal(h.calls.sent.length, 0, 'accepted model reminder already owns this batch before turn/start arrives');
  assert.equal(st.pendingReminderItems.length, 1);
  assert.equal(h.calls.prompts.length, 1);
});

test('active ordinary turn cannot hide a separate accepted reminder from direct fallback arbitration', async t => {
  const { h, st } = await open(t, 'normal');
  await h.deliverPrompt(KEY, 'ordinary accepted round');
  await turnStart(h, 1);
  st.pendingReminderItems = [{ id: 'queued-behind-ordinary', text: 'queued reminder body', dueAt: Date.now(), requestedAt: 1, intervalMinutes: 5 }];
  await h.deliverPrompt(KEY, '', { wakeReason: 'reminder' });
  assert.equal(h.calls.prompts.length, 2);
  enterWeak(h);
  await h.sendWakePromptV2(KEY, 'reminder');
  assert.equal(h.calls.sent.length, 0, 'check accepted reminders independently of the active ordinary envelope');
  assert.equal(st.pendingReminderItems.length, 1);
  assert.equal(h.calls.prompts.length, 2);
});

test('bubble delivery blocked before any receipt claim does not consume its daily allowance', async t => {
  const { h, st } = await open(t, 'weak');
  st.lastTimeBubbleId = 'fixture-unclaimed-bubble';
  st.pendingTimeBubble = { label: 'fixture bubble', hint: 'do not execute this hint' };
  const original = h.pluginHost.callService.bind(h.pluginHost);
  h.pluginHost.callService = (service, method, payload) => service === 'scheduler' && method === 'claimDelivery'
    ? { ok: false, reason: 'ledger_busy' } : original(service, method, payload);
  for (let i = 0; i < 4; i++) await h.sendWakePromptV2(KEY, 'timeBubble');
  assert.equal(h.calls.sent.length, 0);
  assert.equal(h.calls.prompts.length, 0);
  assert.ok(st.pendingTimeBubble, 'unclaimed delivery remains pending');
  assert.equal(h.pluginHost.get('life-proactive-time-bubble').state.byKey?.[KEY]?.count || 0, 0);
  assert.equal(h.pluginHost.allowsWake('timeBubble', { key: KEY }), true);
});
