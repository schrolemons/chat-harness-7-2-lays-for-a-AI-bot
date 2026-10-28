import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { bridgeHarness } from './audit-bridge-harness.mjs';
const key = 'private:123';
async function open() {
  const h = await bridgeHarness({ config: { sendDelayMs: 0, socialV2: { enabled: true,
    readReceipt: { ackPrivate: true, ackGroup: true, ackWhileGenerating: true }, wake: { batchWindowMs: 10 } } } });
  h.setMode('reserved2');
  for (const id of ['obs-health-monitor', 'obs-bridge-health', 'obs-self-review', 'life-campus-watch', 'life-daily-worklog', 'eval-regression']) h.pluginHost.setEnabled(id, false);
  const call = h.pluginHost.callService.bind(h.pluginHost);
  h.pluginHost.callService = (name, method, args) => name === 'messageAck' && method === 'plan'
    ? { wait: { enabled: true, delayMs: 20, text: 'ACK-WAIT' }, apology: { enabled: true, delayMs: 180, text: 'ACK-APOLOGY' } }
    : call(name, method, args);
  const st = h.getSocialV2State(key);
  st.bootstrapSent = true;
  st.wakeConfig.batchWindowMs = 10;
  const sid = await h.ensureSession(key);
  h.v2TurnStartAt.set(sid, Date.now());
  return h;
}
function inbound(h, text = '计时器测试') {
  h.appendSocialV2Message(key, 'owner', text, text, false, true, String(Date.now()), [], '123', []);
  const at = h.noteMessageAckInbound(key);
  h.scheduleWakeV2(key, 'private', at);
}
async function tick(h, ms) { await sleep(ms); await h.pluginHost.tick(Date.now() + 10); await sleep(50); }
const sends = h => h.calls.sent.filter(x => /^ACK-/.test(x.text)).map(x => x.text);

test('new inbound during an active turn sends both phrases without accepting a second prompt', async () => {
  const h = await open();
  try {
    h.cfg.socialV2.readReceipt.ackWhileGenerating = false; // 旧配置不能再让思考阶段停止两个计时器。
    const before = h.calls.prompts.length;
    inbound(h);
    assert.ok(h.messageAckArmed.get(key), 'existing active turn must arm latest inbound');
    await tick(h, 100);
    await tick(h, 500);
    assert.deepEqual(sends(h), ['ACK-WAIT', 'ACK-APOLOGY']);
    assert.equal(h.calls.prompts.length, before, 'do not inject another DSH turn');
  } finally { h.cancelMessageReadAck(key); await h.close(); }
});
test('real reply during active-turn acknowledgement cancels the remaining apology', async () => {
  const h = await open();
  try {
    inbound(h);
    await tick(h, 100);
    assert.deepEqual(sends(h), ['ACK-WAIT']);
    await h.sendToQQ(key, '真实回复');
    await tick(h, 500);
    assert.deepEqual(sends(h), ['ACK-WAIT']);
    assert.equal(h.messageAckArmed.get(key), undefined);
  } finally { h.cancelMessageReadAck(key); await h.close(); }
});
test('queued-only prompts also arm; hard-capped active turns remain silent', async () => {
  const h = await open();
  try {
    h.v2TurnStartAt.clear();
    h.promptQueues.set(key, { running: true, queue: [] });
    inbound(h);
    assert.ok(h.messageAckArmed.get(key), 'do not depend on a new prompt being accepted');
    const sid = h.state.sessions[key];
    h.v2TurnStartAt.set(sid, Date.now());
    h.pluginHost.setConfig('life-token-budget', { globalHardLimitYuan: 0.01 });
    await h.pluginHost.reload('life-token-budget');
    h.tokenLedger.ingestEvent({ sessionId: sid, at: Date.now(), model: 'deepseek-flash', event: {
      type: 'assistant/message', seq: 1, data: { turn: 1, step: 1, usage: { inputTokens: 1000000 } } } });
    inbound(h);
    assert.equal(h.messageAckArmed.get(key), undefined);
  } finally { h.cancelMessageReadAck(key); await h.close(); }
});
test('new inbound cancels the old round and restarts both timers for the latest message', async () => {
  const h = await open();
  try {
    inbound(h, 'older');
    const old = h.messageAckArmed.get(key);
    inbound(h, 'newest');
    assert.notEqual(h.messageAckArmed.get(key), old);
    assert.ok(h.messageAckArmed.get(key));
    await tick(h, 100);
    await tick(h, 500);
    assert.deepEqual(sends(h), ['ACK-WAIT', 'ACK-APOLOGY']);
  } finally { h.cancelMessageReadAck(key); await h.close(); }
});
test('first private inbound during bootstrap also arms both timers', async () => {
  const h = await open();
  try {
    h.getSocialV2State(key).bootstrapSent = false;
    await h.handleIncoming('private', 123, { user_id: 123, self_id: 999, message_id: 77,
      message: [{ type: 'text', data: { text: 'first message' } }] }, h.cfg);
    assert.ok(h.messageAckArmed.get(key));
  } finally { h.cancelMessageReadAck(key); await h.close(); }
});
test('active group turn follows the latest user message even without another wake trigger', async () => {
  const h = await open();
  const group = 'group:456';
  try {
    const sid = await h.ensureSession(group);
    h.v2TurnStartAt.set(sid, Date.now());
    const st = h.getSocialV2State(group);
    st.bootstrapSent = true;
    st.wakeConfig.mode = 'diving';
    st.wakeConfig.triggers = { atMention: false, nameMention: false, question: false, keyword: false,
      anyMessage: false, probability: 0, poke: false };
    await h.handleIncoming('group', 456, { user_id: 789, self_id: 999, group_id: 456,
      message_id: 78, message: [{ type: 'text', data: { text: '普通消息' } }] }, h.cfg);
    assert.ok(h.messageAckArmed.get(group));
  } finally { h.cancelMessageReadAck(group); await h.close(); }
});
test('queuing a reply keeps timers until QQ send begins; older in-flight success cannot cancel newer inbound', async () => {
  const h = await open();
  let release;
  try {
    const original = h.bot.sendPrivateMessage.bind(h.bot);
    let first = true;
    h.bot.sendPrivateMessage = async (...args) => {
      if (first) { first = false; await new Promise(resolve => { release = resolve; }); }
      return original(...args);
    };
    const previousSend = h.sendToQQ(key, 'old reply');
    while (!release) await sleep(5);
    inbound(h, 'new incoming during previous network request');
    release(); await previousSend;
    assert.ok(h.messageAckArmed.get(key), 'old reply completion must not cancel the new message timers');
    first = true;
    const blocker = h.sendToQQ(key, 'previous batch part');
    await sleep(10);
    inbound(h, 'latest');
    const nextSend = h.sendToQQ(key, 'queued reply');
    assert.ok(h.messageAckArmed.get(key), 'enqueue is not the send boundary');
    release(); await blocker; await nextSend;
    assert.equal(h.messageAckArmed.get(key), undefined);
  } finally { release?.(); h.cancelMessageReadAck(key); await h.close(); }
});
