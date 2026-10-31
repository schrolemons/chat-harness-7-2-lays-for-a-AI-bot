// Real silent-budget ingress -> persisted recovery window -> real bridge fake
// model dispatch. Production state, QQ and model endpoints are never used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const PRIVATE = 'private:124', GROUP = 'group:456';
async function open({ key = PRIVATE, dailyLimit = 1, countBy = 'session', cold = false } = {}) {
  const h = await bridgeHarness({
    config: { allow: { private: ['123', '124', '125'], groups: ['456'] }, sendDelayMs: 0,
      socialV2: { curfew: { enabled: false }, proactive: { enabled: false }, sticker: { enabled: false },
        persistentMemory: { enabled: false }, dailyDiary: { enabled: false }, selfReview: { enabled: false },
        dailyNews: { enabled: false }, care: { enabled: false }, idleRescue: { enabled: false } } },
    files: {
      'state/plugins/config/life-token-budget.json': { sessions: { [key]: { coldLimitYuan: cold ? 0.1 : 0, hardLimitYuan: 0.1, weakMinIntervalMin: 30 } },
        recoveryWindows: { privateMessages: 5, groupMessages: 5, groupAtMessages: 5 },
        mechanicalPrivateReplies: ['fixture silent mechanical'], mechanicalGroupReplies: ['fixture group mechanical'] },
      'state/plugins/config/ctx-knowledge-quota.json': { dailyLimit, countBy, deflectText: 'fixture professional refusal' }
    }
  });
  h.setMode('reserved2'); h.setSelfIdentity('fixture-bot', '9');
  const st = h.getSocialV2State(key); st.bootstrapSent = true;
  st.wakeConfig.triggers = { anyMessage: false, atMention: true, nameMention: false, question: false, keywords: [], speakerIds: [], probability: 0 };
  const sid = await h.ensureSession(key);
  assert.equal(h.tokenLedger.ingestEvent({ sessionId: sid, at: Date.now() - 10, model: 'deepseek-flash', event: {
    type: 'assistant/message', seq: 1, data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 100 } }
  } }), true);
  assert.equal(h.tokenBudgetOf(key).stage, 'silent');
  const incoming = async (text, { messageId, at = key === GROUP, userId = '124' } = {}) => {
    const [kind, id] = key.split(':');
    await h.handleIncoming(kind, Number(id), { self_id: 9, user_id: Number(userId), group_id: kind === 'group' ? Number(id) : undefined,
      message_id: messageId, sender: { nickname: 'fixture-person-' + userId },
      message: [...(at ? [{ type: 'at', data: { qq: '9' } }] : []), { type: 'text', data: { text } }] }, h.cfg);
  };
  const setHardLimit = async hardLimitYuan => {
    const current = h.pluginHost.get('life-token-budget').config;
    assert.equal(h.pluginHost.setConfig('life-token-budget', { sessions: { ...current.sessions, [key]: { ...current.sessions[key], hardLimitYuan } } }).ok, true);
    await h.pluginHost.reload('life-token-budget');
  };
  const recover = async () => { await setHardLimit(0); await h.pluginHost.tick(); };
  const submitted = () => h.calls.prompts.map(call => call.content.filter(part => part.type === 'text').map(part => part.text).join('\n')).join('\n');
  const usage = bucket => h.pluginHost.callService('knowledgeQuota', 'usage', bucket || key).used;
  return { h, key, incoming, setHardLimit, recover, submitted, usage, close: () => h.close() };
}

test('private recovery charges each eligible original ID before sending only admitted requests to the model', async () => {
  const f = await open();
  try {
    await f.incoming('这个算法为什么正确？ PRIVATE_ALLOWED_1', { messageId: 'private-1' });
    await f.incoming('这个定理为什么成立？ PRIVATE_BLOCKED_2', { messageId: 'private-2' });
    await f.incoming('这个积分为什么这样计算？ PRIVATE_BLOCKED_3', { messageId: 'private-3' });
    assert.equal(f.h.calls.prompts.length, 0);
    assert.equal(f.usage(), 0, 'silent capture itself must not allocate professional answers');
    await f.recover();
    assert.equal(f.usage(), 1);
    assert.equal(f.h.calls.prompts.length, 1);
    assert.ok(f.submitted().includes('PRIVATE_ALLOWED_1'));
    assert.ok(!f.submitted().includes('PRIVATE_BLOCKED_2'));
    assert.ok(!f.submitted().includes('PRIVATE_BLOCKED_3'));
  } finally { await f.close(); }
});

test('recovery never leaks exceeded bodies through recoveryText even when beforePrompt sees no unread', async () => {
  const f = await open({ dailyLimit: 0 });
  try {
    await f.incoming('请解释算法，RECOVERY_MUST_NOT_REACH_MODEL', { messageId: 'zero-recovery' });
    assert.equal(f.h.getSocialV2State(PRIVATE).unread.length, 0, 'silent path stores a separate recovery queue');
    await f.recover();
    assert.ok(!f.submitted().includes('RECOVERY_MUST_NOT_REACH_MODEL'));
    assert.equal(f.h.calls.prompts.length, 0, 'all-denied recovery must not spend a model round');
    assert.equal(f.usage(), 0);
  } finally { await f.close(); }
});

test('one actual message admission is reused across recovery replay and later ticks without another charge', async () => {
  const f = await open({ dailyLimit: 2 });
  try {
    const text = '这个算法为什么正确？ REUSED_REAL_MESSAGE';
    const admitted = await f.h.pluginHost.callService('knowledgeQuota', 'preflight', {
      key: PRIVATE, plainContent: text, messageId: 'same-real-message', userId: '124', allowed: true, reason: 'private'
    });
    assert.equal(admitted.action, 'allow');
    await f.incoming(text, { messageId: 'same-real-message' });
    await f.incoming('这个定理为什么成立？ NEW_REAL_MESSAGE', { messageId: 'new-real-message' });
    await f.recover();
    assert.equal(f.usage(), 2);
    assert.ok(f.submitted().includes('REUSED_REAL_MESSAGE'));
    assert.ok(f.submitted().includes('NEW_REAL_MESSAGE'));
    const calls = f.h.calls.prompts.length;
    await f.h.pluginHost.tick();
    assert.equal(f.usage(), 2);
    assert.equal(f.h.calls.prompts.length, calls, 'a consumed recovery window must not replay');
  } finally { await f.close(); }
});

test('group recovery uses atSelf requests for allowance; ordinary technical background is context only', async () => {
  const f = await open({ key: GROUP });
  try {
    await f.incoming('这个算法为什么正确？ GROUP_TECH_BACKGROUND', { messageId: 'background', at: false, userId: '126' });
    await f.incoming('这个定理为什么成立？ GROUP_ALLOWED_AT', { messageId: 'mention-1', at: true, userId: '124' });
    await f.incoming('这个积分为什么这样计算？ GROUP_BLOCKED_AT', { messageId: 'mention-2', at: true, userId: '125' });
    await f.recover();
    assert.equal(f.usage(), 1);
    const decisions = Object.values(f.h.pluginHost.get('ctx-knowledge-quota').state.hits || {});
    assert.ok(decisions.some(d => d.messageId === 'mention-1' && d.action === 'allow'));
    assert.ok(!decisions.some(d => d.messageId === 'background'), 'non-trigger background must not consume or get a professional admission');
    assert.ok(f.submitted().includes('GROUP_ALLOWED_AT'));
    assert.ok(!f.submitted().includes('GROUP_BLOCKED_AT'));
  } finally { await f.close(); }
});

test('recovered group requests respect each real author bucket and do not charge background authors', async () => {
  const f = await open({ key: GROUP, countBy: 'user' });
  try {
    await f.incoming('这个算法为什么正确？ BACKGROUND_126', { messageId: 'background126', at: false, userId: '126' });
    await f.incoming('这个定理为什么成立？ AUTHOR_124', { messageId: 'author124', at: true, userId: '124' });
    await f.incoming('这个积分为什么这样计算？ AUTHOR_125', { messageId: 'author125', at: true, userId: '125' });
    await f.recover();
    assert.equal(f.usage('group:456#124'), 1);
    assert.equal(f.usage('group:456#125'), 1);
    assert.equal(f.usage('group:456#126'), 0);
    assert.ok(f.submitted().includes('AUTHOR_124'));
    assert.ok(f.submitted().includes('AUTHOR_125'));
  } finally { await f.close(); }
});

test('hard recovery stays held in weak stage and cannot bypass private five-message admission', async () => {
  const f = await open({ dailyLimit: 3, cold: true });
  try {
    await f.incoming('这个算法为什么正确？ FIRST_WEAK_RECOVERY', { messageId: 'weak-first' });
    await f.recover();
    assert.equal(f.usage(), 0);
    assert.equal(f.h.tokenBudgetOf(PRIVATE).stage, 'weak');
    assert.equal(f.h.taskCaps.budgetRecoveryStatus(PRIVATE).allowed, false);
    await f.setHardLimit(0.1);
    await f.incoming('这个定理为什么成立？ WAIT_FOR_WEAK_WINDOW', { messageId: 'weak-second' });
    const prompts = f.h.calls.prompts.length;
    await f.recover();
    assert.equal(f.usage(), 0, 'weak state must not preallocate a separate recovery model round');
    assert.equal(f.h.calls.prompts.length, prompts);
    assert.equal(f.h.pluginHost.callService('tokenBudget', 'recoveryPending', { key: PRIVATE }), 2);
  } finally { await f.close(); }
});
