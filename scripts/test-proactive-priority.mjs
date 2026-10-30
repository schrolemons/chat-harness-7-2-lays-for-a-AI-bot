// Read-only behavior audit: real bridge functions, temporary state, fake QQ/DSH.
// Exercises arbitration through real turn/start/end and temporary receipt files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';
import { createPlugin as schedulerPlugin } from '../plugins/qq-components/life-scheduler/index.js';
import { createPlugin as reminderPlugin } from '../plugins/qq-components/life-schedule-reminder/index.js';

const KEY = 'private:123';
async function open(t) {
  const h = await bridgeHarness({ config: { sendDelayMs: 0, socialV2: { enabled: true,
    curfew: { enabled: false }, proactive: { enabled: false }, readReceipt: { enabled: false }, wake: { preSleepWaitEnabled: false } } } });
  h.setMode('reserved2');
  for (const id of ['obs-health-monitor', 'obs-bridge-health', 'obs-self-review', 'life-campus-watch', 'life-daily-worklog', 'eval-regression']) h.pluginHost.setEnabled(id, false);
  t.after(() => h.close());
  const st = h.getSocialV2State(KEY); st.bootstrapSent = true;
  const sid = await h.ensureSession(KEY);
  return { h, st, sid };
}

function event(h, sid, type, data) { return h.queueDshEnvelope({ payload: { type: 'session/event', sessionId: sid, event: { type, data } } }); }

test('proactive wake preempts an active time-bubble model turn once and does not clear the DSH inbox', async t => {
  const { h, st, sid } = await open(t);
  st.pendingTimeBubble = { label: 'synthetic bubble' };
  await h.sendWakePromptV2(KEY, 'timeBubble'); await event(h, sid, 'turn/start', { turn: 1 });
  const token = st.agentToken;
  await Promise.all([h.sendWakePromptV2(KEY, 'proactiveCheck'), h.sendWakePromptV2(KEY, 'proactiveCheck')]);
  assert.equal(h.calls.cancelled.filter(call => call?.method === 'session/cancel' && call.params.sessionId === sid).length, 1);
  assert.equal(h.calls.cancelled.filter(call => typeof call === 'string').length, 0, 'stopSessionWork must not clear unrelated inbox reminders');
  assert.notEqual(st.agentToken, token);
  assert.equal(h.calls.prompts.length, 1, 'new model turn waits for the old turn/end');
  await event(h, sid, 'assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'old bubble must not leak' }] } });
  await event(h, sid, 'turn/end', { turn: 1, reason: { kind: 'completed' } });
  assert.equal(h.calls.sent.length, 0, 'late text and stopped notices from a preempted bubble are suppressed');
  await h.pluginHost.tick(Date.now() + 2000); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(h.calls.prompts.length, 2);
  assert.equal(st.lastWakeReason, 'proactiveCheck');
});

test('current: proactive wake leaves an active schedule reminder and its payload untouched', async t => {
  const { h, st, sid } = await open(t);
  st.pendingReminderItems = [{ id: 'fixture-reminder', text: 'fixture reminder', dueAt: Date.now() }];
  await h.sendWakePromptV2(KEY, 'reminder'); await event(h, sid, 'turn/start', { turn: 1 });
  for (const reason of ['proactiveCheck', 'careCheck', 'newsShare', 'idleRescue', 'timeBubble']) await h.sendWakePromptV2(KEY, reason);
  assert.equal(h.calls.cancelled.length, 0);
  assert.equal(st.pendingReminderItems[0].id, 'fixture-reminder');
  assert.ok(st.pendingWakeReasons.some(item => item.reason === 'proactiveCheck'));
  assert.equal(h.calls.prompts.length, 1);
});

test('a non-reminder prompt does not consume the pending reminder payload', async t => {
  const { h, st } = await open(t);
  st.pendingReminderItems = [{ id: 'fixture-reminder', text: 'unique pending reminder', dueAt: Date.now() }];
  h.buildWakePromptV2(KEY, 'proactiveCheck');
  assert.equal(st.pendingReminderItems.length, 1, 'proactive prompt must preserve the independent reminder queue');
});

test('queued schedule reminder is selected before an earlier time bubble', async t => {
  const { h, st } = await open(t);
  h.queuePendingWakeReason(KEY, st, 'timeBubble', 0);
  h.queuePendingWakeReason(KEY, st, 'reminder', 0);
  const replayed = h.replayPendingWakeReasonsV2(KEY);
  assert.equal(replayed.reason, 'reminder');
});

test('current: cancelling pending bubble tasks preserves reminder tasks, but cannot stop a running callback', async () => {
  const plugin = schedulerPlugin({ runtime: {}, config: {} }), scheduler = plugin.services.scheduler;
  let release, started = false, finished = false, reminded = false;
  const running = scheduler.schedule({ id: 'bubble:running', owner: 'life-proactive-time-bubble', at: 1,
    run: async () => { started = true; await new Promise(resolve => { release = resolve; }); finished = true; } });
  scheduler.schedule({ id: 'bubble:pending', owner: 'life-proactive-time-bubble', at: 100, run() {} });
  scheduler.schedule({ id: 'reminder:pending', owner: 'life-schedule-reminder', at: 100, run: () => { reminded = true; } });
  await plugin.hooks.onTick({ now: 1 });
  assert.equal(started, true);
  assert.equal(scheduler.cancel(running), false, 'one-shot callback was removed from pending map before running');
  scheduler.cancelOwner('life-proactive-time-bubble');
  assert.equal(scheduler.status().pending, 1);
  release(); await Promise.resolve();
  assert.equal(finished, true, 'removing pending jobs is not model/callback preemption');
  await plugin.hooks.onTick({ now: 100 });
  assert.equal(reminded, true);
});

test('current: an accepted interval reminder remains incomplete and becomes due again after its interval', () => {
  let saved = {}, wakeCalls = 0;
  const plugin = reminderPlugin({ config: { enabled: true }, capabilities: { requestReminderWake: () => { wakeCalls++; return true; } },
    state: { get: () => structuredClone(saved), set: patch => { saved = { ...saved, ...structuredClone(patch) }; } } });
  const now = Date.now(), dueAt = now + 60000;
  const added = plugin.services.schedules.add({ key: KEY, title: 'synthetic persistent reminder', dueAt, leadMinutes: 0, intervalMinutes: 2 });
  assert.equal(added.ok, true);
  plugin.hooks.onTick({ now: dueAt });
  assert.equal(wakeCalls, 1); assert.equal(saved.items[0].completedAt, undefined); assert.equal(saved.items[0].firedAt, undefined);
  plugin.hooks.onTick({ now: dueAt + 2 * 60000 });
  assert.equal(wakeCalls, 2); assert.equal(saved.items[0].id, added.item.id);
});

test('queued bubble sends recheck their cancelled origin immediately before transport', async t => {
  const { h, st, sid } = await open(t);
  st.pendingTimeBubble = { label: 'synthetic bubble' };
  await h.sendWakePromptV2(KEY, 'timeBubble'); await event(h, sid, 'turn/start', { turn: 1 });
  const original = h.bot.sendPrivateMessage.bind(h.bot); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  h.bot.sendPrivateMessage = async (id, text) => { entered(); await new Promise(resolve => { release = resolve; }); await original(id, text); };
  const first = h.sendToQQ(KEY, 'already in flight'); await ready;
  const queued = h.sendToQQ(KEY, 'queued old bubble');
  await h.sendWakePromptV2(KEY, 'proactiveCheck'); release();
  assert.equal(await first, true); assert.equal(await queued, false);
  assert.deepEqual(h.calls.sent.map(item => item.text), ['already in flight']);
});

test('failed reminder dispatch retains its payload and successful reminder output consumes only that batch', async t => {
  const { h, st, sid } = await open(t);
  st.pendingReminderItems = [{ id: 'fixture-reminder', text: 'fixture reminder', dueAt: Date.now(), requestedAt: 1 }];
  const original = h.api.sessions.prompt;
  h.api.sessions.prompt = async () => ({ result: { ok: false, error: { code: 'fixture-rejected', message: 'not accepted' } } });
  await h.sendWakePromptV2(KEY, 'reminder'); assert.equal(st.pendingReminderItems.length, 1);
  h.api.sessions.prompt = original;
  await h.sendWakePromptV2(KEY, 'reminder'); await event(h, sid, 'turn/start', { turn: 2 });
  // The same schedule may become due for a later occurrence during this turn.
  st.pendingReminderItems.push({ id: 'later-reminder', text: 'later cycle', dueAt: Date.now() + 1000, requestedAt: 2 });
  await event(h, sid, 'tool/call', { turn: 2, name: 'mcp__snowluma__qq_send_message', callId: 'reminder-send', arguments: {} });
  await event(h, sid, 'tool/result', { turn: 2, message: { source: { callId: 'reminder-send' }, content: [{ type: 'text', text: 'synthetic delivery confirmed' }] } });
  await event(h, sid, 'turn/end', { turn: 2, reason: { kind: 'completed' } });
  assert.deepEqual(Array.from(st.pendingReminderItems, item => item.id), ['later-reminder']);
});

test('a duplicate late preempted turn/end cannot clear a newer reminder turn', async t => {
  const { h, st, sid } = await open(t);
  st.pendingTimeBubble = { label: 'synthetic bubble' };
  await h.sendWakePromptV2(KEY, 'timeBubble'); await event(h, sid, 'turn/start', { turn: 1 });
  await h.sendWakePromptV2(KEY, 'proactiveCheck');
  st.pendingReminderItems = [{ id: 'protected', text: 'protected reminder', dueAt: Date.now() }];
  await h.deliverPrompt(KEY, '', { wakeReason: 'reminder' });
  await event(h, sid, 'turn/start', { turn: 2 });
  await event(h, sid, 'turn/end', { turn: 1, reason: { kind: 'aborted' } });
  assert.equal(h.isConversationBusyV2(KEY, st), true);
  assert.equal(h.collectors.get(sid).has(2), true);
  assert.equal(st.pendingReminderItems[0].id, 'protected');
  await h.sendWakePromptV2(KEY, 'careCheck');
  assert.equal(h.calls.cancelled.filter(call => call?.method === 'session/cancel').length, 1);
});

test('a late cancellation response is settled before the replacement wake can dispatch', async t => {
  const { h, st, sid } = await open(t);
  st.pendingTimeBubble = { label: 'synthetic bubble' };
  await h.sendWakePromptV2(KEY, 'timeBubble'); await event(h, sid, 'turn/start', { turn: 1 });
  const original = h.api.callUnary; let release;
  h.api.callUnary = async (method, params) => method === 'session/cancel' ? new Promise(resolve => { release = () => resolve({ result: { ok: true, value: {} } }); }) : original(method, params);
  const preempt = h.sendWakePromptV2(KEY, 'proactiveCheck');
  const ended = event(h, sid, 'turn/end', { turn: 1, reason: { kind: 'completed' } });
  await new Promise(resolve => setTimeout(resolve, 20));
  await h.pluginHost.tick(Date.now() + 2000); assert.equal(h.calls.prompts.length, 1);
  release(); await preempt; await ended;
  await h.pluginHost.tick(Date.now() + 2000); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(h.calls.prompts.length, 2);
});

for (const terminalKind of ['aborted', 'completed']) test('unknown cancellation stays pending until same-turn ' + terminalKind + ', then lets an independent reminder run once', async t => {
  const { h, st, sid } = await open(t);
  st.pendingTimeBubble = { label: 'synthetic bubble' };
  await h.sendWakePromptV2(KEY, 'timeBubble'); await event(h, sid, 'turn/start', { turn: 1 });
  let attempts = 0;
  h.api.callUnary = async () => { attempts++; throw Error('fixture transport outcome unknown'); };
  await h.sendWakePromptV2(KEY, 'proactiveCheck');
  st.pendingReminderItems = [{ id: 'protected', text: 'protected reminder', dueAt: Date.now() }];
  await h.sendWakePromptV2(KEY, 'reminder');
  assert.equal(h.isConversationBusyV2(KEY, st), true, 'unknown transport outcome alone is not proof the old turn ended');
  await event(h, sid, 'assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'old bubble must remain suppressed' }] } });
  await event(h, sid, 'turn/end', { turn: 1, reason: { kind: terminalKind } });
  assert.equal(st.pendingWakeReason, 'reminder', 'real matching terminal event must release the reminder queue');
  await h.pluginHost.tick(Date.now() + 2000); await new Promise(resolve => setTimeout(resolve, 30));
  await event(h, sid, 'turn/start', { turn: 2 });
  await h.sendWakePromptV2(KEY, 'careCheck');
  assert.equal(attempts, 1); assert.equal(h.calls.prompts.length, 2);
  assert.equal(st.lastWakeReason, 'reminder');
  assert.equal(h.isConversationBusyV2(KEY, st), true, 'the newer reminder is still protected');
  assert.equal(h.calls.sent.length, 0, 'never replay old bubble output or a stopped notice');
  assert.equal(st.pendingReminderItems[0].id, 'protected');
  const receipt = h.pluginHost.callService('scheduler', 'deliveryStatus', { id: 'wake-preempt:' + sid + ':1' });
  assert.equal(receipt.status, 'uncertain');
});
