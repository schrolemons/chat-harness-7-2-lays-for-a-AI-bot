// 补话失败守卫的最小回归：
// 模型回合报错/被中止后，已经布下的「已读补话」定时器必须被取消，
// 到点也不许冒「用户别急嘛，我在认真想啦」这类话术；新消息进来后照常重新计时。
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const key = 'private:123';

async function open() {
  const h = await bridgeHarness({ config: { ownerQQ: 999, sendDelayMs: 0, socialV2: { enabled: true,
    readReceipt: { ackPrivate: true, ackGroup: true, ackWhileGenerating: true }, wake: { batchWindowMs: 10 } } } });
  h.setMode('reserved2');
  h.pluginHost.setConfig('ctx-chat-reply-shape', { intervalMinMs: 0, intervalMaxMs: 0, longGapProbability: 0 });
  await h.pluginHost.reload('ctx-chat-reply-shape');
  for (const id of ['obs-health-monitor', 'obs-bridge-health', 'obs-self-review', 'life-campus-watch', 'life-daily-worklog', 'eval-regression']) h.pluginHost.setEnabled(id, false);
  const call = h.pluginHost.callService.bind(h.pluginHost);
  h.pluginHost.callService = (name, method, args) => name === 'messageAck' && method === 'plan'
    ? { wait: { enabled: true, delayMs: 20, text: 'ACK-WAIT' }, apology: { enabled: true, delayMs: 180, text: 'ACK-APOLOGY' } }
    : call(name, method, args);
  const st = h.getSocialV2State(key);
  st.bootstrapSent = true;
  st.wakeConfig.batchWindowMs = 10;
  await h.ensureSession(key);
  return h;
}

function arm(h) {
  const at = h.noteMessageAckInbound(key);
  h.scheduleMessageReadAck(key, at);
  assert.ok(h.messageAckArmed.get(key), '补话定时器应先布点');
  return at;
}

async function failTurn(h, kind, beforeEnd) {
  const sid = h.state.sessions[key];
  await h.deliverPrompt(key, 'fixture turn');
  await h.queueDshEnvelope({ payload: { type: 'session/event', sessionId: sid, event: { type: 'turn/start', data: { turn: 1 } } } });
  await beforeEnd?.();
  await h.queueDshEnvelope({ payload: { type: 'session/event', sessionId: sid,
    event: { type: 'turn/end', data: { turn: 1, reason: kind === 'error'
      ? { kind: 'error', error: { message: 'fixture model failure' } } : { kind: 'aborted' } } } } });
}

async function settle(h, ms = 500) {
  await sleep(ms);
  await h.pluginHost.tick(Date.now() + 10);
  await sleep(50);
}

const sends = (h) => h.calls.sent.filter((x) => /^ACK-/.test(x.text)).map((x) => x.text);

test('回合抛错后取消补话定时器，到点也不发话术', async () => {
  const h = await open();
  try {
    arm(h);
    await failTurn(h, 'error');
    assert.equal(h.messageAckArmed.get(key), undefined, '报错回合必须摘掉补话定时器');
    await settle(h, 500);
    assert.deepEqual(sends(h), [], '报错回合不许再冒补话话术');
  } finally { h.cancelMessageReadAck(key); await h.close(); }
});

for (const kind of ['rejected', 'throws']) {
  test(`DSH投递${kind}时取消当前批次的补话`, async () => {
    const h = await open();
    try {
      arm(h);
      let called = false;
      h.api.sessions.prompt = async () => {
        called = true;
        if (kind === 'throws') throw Error('fixture dispatch failure');
        return { result: { ok: false, error: { code: 'fixture-rejected', message: 'not accepted' } } };
      };
      const deliver = h.deliverPrompt(key, 'fixture wake', { wakeReason: 'private', silent: true });
      if (kind === 'throws') await assert.rejects(deliver, /fixture dispatch failure/);
      else assert.equal((await deliver).ok, false);
      assert.equal(called, true, '必须确实经过 DSH 投递边界');
      assert.equal(h.messageAckArmed.get(key), undefined);
      await settle(h);
      assert.deepEqual(sends(h), []);
    } finally { h.cancelMessageReadAck(key); await h.close(); }
  });
}

test('旧回合迟到错误不取消新布点，但没有运行模型时不发补话', async () => {
  const h = await open();
  try {
    arm(h);
    let newer;
    await failTurn(h, 'error', () => { arm(h); newer = h.messageAckArmed.get(key); });
    assert.equal(h.messageAckArmed.get(key), newer);
    await settle(h, 120); await settle(h, 500);
    assert.deepEqual(sends(h), [], '没有运行的模型，保持沉默');
  } finally { h.cancelMessageReadAck(key); await h.close(); }
});

test('旧投递拒绝不取消新布点，但没有运行模型时不发补话', async () => {
  const h = await open(); let release;
  try {
    arm(h);
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    h.api.sessions.prompt = async () => { started(); return new Promise(resolve => { release = resolve; }); };
    const deliver = h.deliverPrompt(key, 'fixture pending wake', { wakeReason: 'private', silent: true });
    await ready;
    arm(h); const newer = h.messageAckArmed.get(key);
    release({ result: { ok: false, error: { code: 'fixture-rejected', message: 'not accepted' } } });
    assert.equal((await deliver).ok, false);
    assert.equal(h.messageAckArmed.get(key), newer);
    await settle(h, 120); await settle(h, 500);
    assert.deepEqual(sends(h), [], '没有运行的模型，保持沉默');
  } finally { h.cancelMessageReadAck(key); await h.close(); }
});

test('回合被中止后取消补话定时器，到点也不发话术', async () => {
  const h = await open();
  try {
    arm(h);
    await failTurn(h, 'aborted');
    assert.equal(h.messageAckArmed.get(key), undefined, '中止回合必须摘掉补话定时器');
    await settle(h, 500);
    assert.deepEqual(sends(h), [], '中止回合不许再冒补话话术');
  } finally { h.cancelMessageReadAck(key); await h.close(); }
});

test('失败标记只压住当轮：新消息进来后照常重新布点并补话', async () => {
  const h = await open();
  try {
    arm(h);
    await failTurn(h, 'error');
    await settle(h, 100);
    assert.deepEqual(sends(h), []);
    await h.deliverPrompt(key,'fixture new model turn');
    await h.queueDshEnvelope({payload:{type:'session/event',sessionId:h.state.sessions[key],event:{type:'turn/start',data:{turn:2}}}});
    arm(h); // 新一批消息，确实有新的模型回合在运行
    assert.ok(h.messageAckArmed.get(key), '新消息必须能重新布点');
    await settle(h, 120);
    await settle(h, 500);
    assert.deepEqual(sends(h), ['ACK-WAIT', 'ACK-APOLOGY'], '新消息的补话不受上一轮失败影响');
  } finally { h.cancelMessageReadAck(key); await h.close(); }
});
