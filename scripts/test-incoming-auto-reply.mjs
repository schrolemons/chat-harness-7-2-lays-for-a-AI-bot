import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness, fixtureReplyTurn } from './audit-bridge-harness.mjs';

let messageId = 0;
const event = (text, kind = 'private', message) => ({
  post_type: 'message', message_type: kind, self_id: 999, user_id: 123,
  group_id: kind === 'group' ? 456 : undefined, message_id: 'auto-reply-fixture-' + ++messageId,
  sender: { nickname: 'fixture' }, raw_message: text,
  message: message ?? [{ type: 'text', data: { text } }],
});

test('auto replies are dropped before model, receipts, queues and incoming observers in every chat mode', async () => {
  const h = await bridgeHarness();
  try {
    const observed = [];
    const call = h.pluginHost.callService.bind(h.pluginHost);
    h.pluginHost.callService = (service, method, payload) => {
      if ((service === 'proactive' && method === 'incoming')
          || (service === 'tokenBudget' && method === 'observeIncoming')) observed.push({ service, method });
      return call(service, method, payload);
    };
    for (const mode of ['chat', 'reserved', 'reserved2']) {
      h.setMode(mode);
      for (const kind of ['private', 'group']) {
        const key = kind === 'private' ? 'private:123' : 'group:456';
        await h.handleIncoming(kind, kind === 'private' ? 123 : 456,
          event(' \n[自动回复]我暂时不在线，给管理员带句话：稍后联系', kind), h.cfg);
        assert.equal(h.calls.created.length, 0, mode + ': no DSH session');
        assert.equal(h.calls.prompts.length, 0, mode + ': no model prompt');
        assert.equal(h.calls.sent.length, 0, mode + ': no mechanical or relay reply');
        assert.equal(h.messageAckInboundAt.has(key), false, mode + ': no receipt timer');
        assert.equal(h.getSocialV2State(key).recentMessages.length, 0, mode + ': no pending backlog');
      }
    }
    assert.deepEqual(observed, []);
  } finally { await h.close(); }
});

test('filtered auto replies do not enter an active turn or replace its receipt timers', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    const key = 'private:123';
    await fixtureReplyTurn(h, key);
    const inboundAt = h.noteMessageAckInbound(key);
    h.armMessageReadAckV2(key, 'private', inboundAt);
    const armed = h.messageAckArmed.get(key);
    const prompts = h.calls.prompts.length;
    await h.handleIncoming('private', 123, event('[自动回复]稍后再说'), h.cfg);
    assert.equal(h.getSocialV2State(key).recentMessages.filter(m => !m.isSelf).length, 0);
    assert.equal(h.messageAckInboundAt.get(key), inboundAt);
    assert.equal(h.messageAckArmed.get(key), armed);
    assert.equal(h.calls.prompts.length, prompts);
  } finally { await h.close(); }
});

test('QQ metadata cannot hide an auto-reply prefix or turn quoted text into that prefix', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    const segments = [
      { type: 'reply', data: { id: 'quoted-message' } },
      { type: 'at', data: { qq: '999' } },
      { type: 'text', data: { text: ' [自动' } },
      { type: 'text', data: { text: '回复]不在线' } },
      { type: 'image', data: { file: 'must-not-download' } },
    ];
    await h.handleIncoming('group', 456, event('[CQ:at,qq=999] [自动回复]不在线', 'group', segments), h.cfg);
    assert.equal(h.calls.images.length, 0);
    assert.equal(h.calls.created.length, 0);
    assert.equal(h.getSocialV2State('group:456').recentMessages.length, 0);
    const filter = payload => h.pluginHost.callService('incomingFilter', 'evaluate', payload);
    assert.equal(filter({ message: [{ type: 'reply', data: { text: '[自动回复]旧消息' } },
      { type: 'text', data: { text: '现在我回来了' } }] }).blocked, false);
    assert.equal(filter({ rawMessage: '\n[自动回复]原始文本兜底' }).blocked, true);
    assert.equal(filter({ message: [{ type: 'text', data: { text: '你好' } }],
      rawMessage: '[自动回复]不一致的原始文本' }).blocked, false);
  } finally { await h.close(); }
});

test('ordinary messages and literal prefix mentions still reach the normal conversation', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    for (const text of ['我回来了', '请解释 [自动回复] 这个标记', '[自动回复功能]怎么关']) {
      await h.handleIncoming('private', 123, event(text), h.cfg);
    }
    assert.equal(h.getSocialV2State('private:123').recentMessages.length, 3);
    assert.equal(h.getSocialV2State('private:123').bootstrapSent, true);
    assert.equal(h.messageAckInboundAt.has('private:123'), true);
  } finally { await h.close(); }
});
