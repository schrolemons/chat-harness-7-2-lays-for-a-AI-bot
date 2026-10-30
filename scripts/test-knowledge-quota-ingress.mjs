// Executes real bridge initialization, ingress and HTTP handlers with temporary
// state and fake gateway/model boundaries. No real QQ, DSH or production fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const PRIVATE = 'private:124', GROUP = 'group:456';
async function open({ dailyLimit = 1, countBy = 'session' } = {}) {
  const h = await bridgeHarness({
    config: { allow: { private: ['123', '124'], groups: ['456'] }, sendDelayMs: 0,
      socialV2: { curfew: { enabled: false }, proactive: { enabled: false }, sticker: { enabled: false },
        wake: { preSleepWaitEnabled: false, preSleepWaitMs: 1000 },
        dailyNews: { enabled: false }, care: { enabled: false }, idleRescue: { enabled: false } } },
    files: { 'state/plugins/config/life-wake-reasons.json':{initialProbability:0,probabilityStep:0,groupAtBonus:1,groupNameBonus:0,groupQuestionBonus:0,groupPokeBonus:0}, 'state/plugins/config/ctx-knowledge-quota.json': { dailyLimit, countBy, deflectText: 'fixture quota refusal' } }
  });
  h.setMode('reserved2'); h.setSelfIdentity('fixture-bot', '9');
  for (const key of [PRIVATE, GROUP]) {
    const st = h.getSocialV2State(key); st.bootstrapSent = true;
    st.wakeConfig.triggers = { anyMessage: false, atMention: true, nameMention: false, question: false, keywords: [], speakerIds: [], probability: 0 };
  }
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const api = async (route, { key = PRIVATE, agent = true, body, agentCall = false } = {}) => {
    const headers = { 'x-console-token': 'fixture-console-token' };
    if (agent) headers['x-agent-token'] = h.getSocialV2State(key).agentToken;
    if (agentCall) headers['x-agent-call'] = '1';
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const incoming = async (key, text, { messageId = 'message1', at = false, userId = '124' } = {}) => {
    const [kind, id] = key.split(':');
    const event = { message_id: messageId, message_seq: messageId, user_id: Number(userId), self_id: 9,
      sender: { nickname: 'fixture-person' }, group_id: kind === 'group' ? Number(id) : undefined,
      message: [...(at ? [{ type: 'at', data: { qq: '9' } }] : []), { type: 'text', data: { text } }] };
    await h.handleIncoming(kind, Number(id), event, h.cfg);
  };
  return { h, api, incoming, async close() { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); await h.close(); } };
}
const used = (f, key) => f.h.pluginHost.callService('knowledgeQuota', 'usage', key).used;

test('real ingress uses semantic intent without requiring domain words and keeps that decision in beforePrompt', async () => {
  const f = await open(); let calls = 0;
  try {
    f.h.taskCaps.learningPrompt = async () => { calls++; return JSON.stringify({ category: 'professional', confidence: 0.98, reason: '请求线性代数概念解释' }); };
    await f.incoming(PRIVATE, '这几个向量张成的空间有几维？', { messageId: 'semantic-no-keyword' });
    assert.equal(used(f, PRIVATE), 1); assert.equal(calls, 1);
    f.h.buildWakePromptV2(PRIVATE, 'private'); f.h.buildWakePromptV2(PRIVATE, 'private');
    assert.equal(used(f, PRIVATE), 1); assert.equal(calls, 1);
    assert.equal(f.h.pluginHost.callService('knowledgeQuota', 'report', PRIVATE).recentClassifications[0].source, 'ai');
  } finally { await f.close(); }
});

test('real ingress semantic casual verdict is not recharged by a keyword-bearing prompt', async () => {
  const f = await open();
  try {
    f.h.taskCaps.learningPrompt = async () => JSON.stringify({ category: 'casual', confidence: 0.96, reason: '关心对方近况' });
    await f.incoming(PRIVATE, '你为什么最近总写代码呀？', { messageId: 'semantic-casual' });
    f.h.buildWakePromptV2(PRIVATE, 'private');
    assert.equal(used(f, PRIVATE), 0); assert.equal(f.h.calls.sent.length, 0);
  } finally { await f.close(); }
});

test('real ingress uncertain intent sends clarification once and closes admission without quota use', async () => {
  const f = await open();
  try {
    f.h.taskCaps.learningPrompt = async () => JSON.stringify({ category: 'uncertain', confidence: 0.6, reason: '缺少专业求助的明确意图' });
    await f.incoming(PRIVATE, '这个你怎么看？', { messageId: 'semantic-uncertain' });
    assert.equal(used(f, PRIVATE), 0); assert.equal(f.h.calls.sent.length, 1);
    assert.match(f.h.calls.sent[0].text, /详细解释/);
    assert.ok(!f.h.getSocialV2State(PRIVATE).unread.some(m => m.messageId === 'semantic-uncertain'));
    assert.equal(f.h.calls.prompts.length, 0);
  } finally { await f.close(); }
});

for (const key of [PRIVATE, GROUP]) test('real eligible ingress reserves one allowance before model scheduling: ' + key, async () => {
  const f = await open();
  try {
    await f.incoming(key, '这个算法为什么正确？', { at: key === GROUP });
    assert.equal(used(f, key), 1);
    assert.equal(f.h.calls.prompts.length, 0, 'ingress should reserve before the batching/model boundary');
  } finally { await f.close(); }
});

test('first nontrigger group discussion initializes without charging professional quota', async () => {
  const f = await open();
  try {
    f.h.getSocialV2State(GROUP).bootstrapSent = false;
    await f.incoming(GROUP, '这个算法为什么正确？');
    assert.equal(used(f, GROUP), 0);
    const text = f.h.buildWakePromptV2(GROUP, 'bootstrap');
    assert.ok(!text.includes('专业问答配额'));
    assert.equal(used(f, GROUP), 0);
    assert.equal(f.h.calls.sent.length, 0);
  } finally { await f.close(); }
});

test('ingress classifies full original text beyond the stored two-hundred-character preview', async () => {
  const f = await open();
  try {
    const text = '这是背景材料。'.repeat(55) + '这个算法为什么正确？';
    await f.incoming(PRIVATE, text, { messageId: 'long-original' });
    assert.ok(f.h.getSocialV2State(PRIVATE).recentMessages.find(m => m.messageId === 'long-original').plain.length <= 200);
    assert.equal(used(f, PRIVATE), 1, 'domain and question live outside the stored preview');
  } finally { await f.close(); }
});

test('each eligible request in a batch is charged before one scheduled round', async () => {
  const f = await open({ dailyLimit: 3 });
  try {
    await f.incoming(PRIVATE, '这个算法为什么正确？', { messageId: 'batch1' });
    await f.incoming(PRIVATE, '这个算法为什么正确？', { messageId: 'batch2' });
    assert.equal(used(f, PRIVATE), 2);
    assert.equal(f.h.calls.prompts.length, 0);
  } finally { await f.close(); }
});

test('last admitted request keeps the same real beforePrompt allowance on repeated builds', async () => {
  const f = await open();
  try {
    await f.incoming(PRIVATE, '这个算法为什么正确？', { messageId: 'last-allowance' });
    const first = f.h.buildWakePromptV2(PRIVATE, 'private');
    const second = f.h.buildWakePromptV2(PRIVATE, 'private');
    assert.equal(used(f, PRIVATE), 1);
    assert.ok(first.includes('这是今天最后一次专业问答额度'));
    assert.ok(second.includes('这是今天最后一次专业问答额度'));
    assert.ok(!first.includes('专业问答配额已用完'));
    assert.ok(!second.includes('专业问答配额已用完'));
  } finally { await f.close(); }
});

test('exceeded request is stamped and absent from unread before refusal send, with no model schedule', async () => {
  const f = await open({ dailyLimit: 0 }); let observed = false;
  try {
    const original = f.h.taskCaps.sendSessionText;
    f.h.taskCaps.sendSessionText = async (key, text) => {
      observed = true;
      const st = f.h.getSocialV2State(key), recent = st.recentMessages.find(m => m.messageId === 'blocked-before-send');
      assert.ok(Number(recent?.seenAt) > 0 && Number(recent?.repliedAt) > 0);
      assert.ok(!st.unread.some(m => m.messageId === 'blocked-before-send'));
      const unread = await f.api('/api/socialV2/unread?key=' + encodeURIComponent(key), { key });
      assert.equal(unread.status, 200);
      assert.ok(!unread.data.messages.some(m => m.messageId === 'blocked-before-send'));
      return original(key, text);
    };
    await f.incoming(PRIVATE, '这个算法为什么正确？', { messageId: 'blocked-before-send' });
    assert.equal(observed, true);
    assert.equal(f.h.calls.sent.length, 1);
    assert.equal(f.h.calls.sent[0].text, 'fixture quota refusal');
    assert.equal(f.h.calls.prompts.length, 0);
    assert.equal(f.h.getSocialV2State(PRIVATE).pendingWakeTimer ?? null, null);
    assert.equal(used(f, PRIVATE), 0);
  } finally { await f.close(); }
});

test('handled refusal does not poison a later ordinary message or its real beforePrompt', async () => {
  const f = await open({ dailyLimit: 0 });
  try {
    await f.incoming(PRIVATE, '这个算法为什么正确？', { messageId: 'blocked-history' });
    await f.incoming(PRIVATE, '今天吃饭了吗？', { messageId: 'ordinary-after-refusal' });
    const prompt = f.h.buildWakePromptV2(PRIVATE, 'private');
    assert.equal(used(f, PRIVATE), 0);
    assert.ok(!prompt.includes('专业问答配额已用完'));
    assert.ok(!f.h.getSocialV2State(PRIVATE).unread.some(m => m.messageId === 'blocked-history'));
    assert.ok(f.h.getSocialV2State(PRIVATE).unread.some(m => m.messageId === 'ordinary-after-refusal'));
  } finally { await f.close(); }
});

test('agent generic quota management is forbidden while console can query and reset', async () => {
  const f = await open();
  try {
    f.h.pluginHost.callService('knowledgeQuota', 'evaluate', { key: PRIVATE, plainContent: '请解释算法', messageId: 'admin-fixture', userId: '124' });
    const body = { tool: 'knowledge_quota', input: { action: 'reset', key: PRIVATE } };
    const forbidden = await f.api('/api/plugins/call', { body, agentCall: true });
    assert.equal(forbidden.status, 403);
    assert.equal(used(f, PRIVATE), 1);
    const queried = await f.api('/api/plugins/call', { agent: false, body: { tool: 'knowledge_quota', input: { action: 'query', key: PRIVATE } } });
    assert.equal(queried.status, 200);
    const reset = await f.api('/api/plugins/call', { agent: false, body });
    assert.equal(reset.status, 200); assert.equal(used(f, PRIVATE), 0);
  } finally { await f.close(); }
});

test('active model cannot fetch unadmitted incoming text during an awaited earlier ingress hook', async () => {
  const f = await open({ dailyLimit: 0 }); let release;
  try {
    const original = f.h.pluginHost.relayIncoming;
    let entered; const atBoundary = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    f.h.pluginHost.relayIncoming = async payload => { entered('paused'); await gate; return original(payload); };
    const incoming = f.incoming(PRIVATE, '请解释算法，FIXTURE_PRIVATE_TECH_BODY', { messageId: 'ingress-race' });
    try {
      assert.equal(await Promise.race([atBoundary, incoming.then(() => 'completed-before-earlier-hook')]), 'paused', 'exercise an in-flight ingress, not an already completed refusal');
      const unread = await f.api('/api/socialV2/unread?key=' + encodeURIComponent(PRIVATE));
      const recent = await f.api('/api/socialV2/recent?key=' + encodeURIComponent(PRIVATE));
      assert.equal(unread.status, 200); assert.equal(recent.status, 200);
      assert.ok(!JSON.stringify(unread.data).includes('FIXTURE_PRIVATE_TECH_BODY'), 'pending admission must not leak through get_unread');
      assert.ok(!JSON.stringify(recent.data).includes('FIXTURE_PRIVATE_TECH_BODY'), 'pending admission must not leak through get_recent');
      assert.ok(!f.h.buildWakePromptV2(PRIVATE, 'private').includes('FIXTURE_PRIVATE_TECH_BODY'), 'pending admission must not leak through plugin beforePrompt');
    } finally { release(); await incoming; }
  } finally { release?.(); await f.close(); }
});

test('refused technical body stays out of later model recent context while console retains evidence', async () => {
  const f = await open({ dailyLimit: 0 });
  try {
    await f.incoming(PRIVATE, '请解释算法，FIXTURE_REFUSED_BODY', { messageId: 'refused-history' });
    const agentRecent = await f.api('/api/socialV2/recent?key=' + encodeURIComponent(PRIVATE));
    assert.equal(agentRecent.status, 200);
    assert.ok(!JSON.stringify(agentRecent.data).includes('FIXTURE_REFUSED_BODY'));
    const consoleRecent = await f.api('/api/socialV2/recent?key=' + encodeURIComponent(PRIVATE), { agent: false });
    assert.equal(consoleRecent.status, 200);
    assert.ok(JSON.stringify(consoleRecent.data).includes('FIXTURE_REFUSED_BODY'));
    await f.incoming(PRIVATE, '今天吃饭了吗？', { messageId: 'later-context' });
    const snapshot = f.h.buildWakeSnapshotV2(PRIVATE);
    assert.ok(!JSON.stringify(snapshot).includes('FIXTURE_REFUSED_BODY'));
    assert.ok(!f.h.buildWakePromptV2(PRIVATE, 'private').includes('FIXTURE_REFUSED_BODY'));
  } finally { await f.close(); }
});

test('messages without a QQ messageId use distinct sequence admissions and refusal closes the exact sequence', async () => {
  const f = await open();
  try {
    await f.incoming(PRIVATE, '这个算法为什么正确？', { messageId: null });
    assert.equal(used(f, PRIVATE), 1);
    const first = f.h.buildWakePromptV2(PRIVATE, 'private');
    const retry = f.h.buildWakePromptV2(PRIVATE, 'private');
    assert.ok(!first.includes('专业问答配额已用完'));
    assert.ok(!retry.includes('专业问答配额已用完'));
    assert.equal(used(f, PRIVATE), 1);
    await f.incoming(PRIVATE, '这个算法为什么正确？', { messageId: null });
    const st = f.h.getSocialV2State(PRIVATE), refused = st.recentMessages.find(m => m.seq === 2);
    assert.ok(Number(refused?.seenAt) > 0 && Number(refused?.repliedAt) > 0);
    assert.ok(!st.unread.some(m => m.seq === 2));
    assert.equal(f.h.calls.sent.length, 1);
    assert.equal(used(f, PRIVATE), 1);
  } finally { await f.close(); }
});

test('ordinary ingress becomes model-visible after admission instead of remaining permanently pending', async () => {
  const f = await open({ dailyLimit: 0 });
  try {
    await f.incoming(PRIVATE, '今天吃饭了吗？FIXTURE_ORDINARY_VISIBLE', { messageId: 'ordinary-visible' });
    const unread = await f.api('/api/socialV2/unread?key=' + encodeURIComponent(PRIVATE));
    const recent = await f.api('/api/socialV2/recent?key=' + encodeURIComponent(PRIVATE));
    assert.equal(unread.status, 200); assert.equal(recent.status, 200);
    assert.ok(JSON.stringify(unread.data).includes('FIXTURE_ORDINARY_VISIBLE'));
    assert.ok(JSON.stringify(recent.data).includes('FIXTURE_ORDINARY_VISIBLE'));
    assert.equal(used(f, PRIVATE), 0);
  } finally { await f.close(); }
});

test('refused source text cannot reenter admitted context through a later ordinary QQ reply', async () => {
  const f = await open({ dailyLimit: 0 });
  const refusedBody = '请解释算法，FIXTURE_REFUSED_QUOTED_BODY';
  try {
    await f.incoming(PRIVATE, refusedBody, { messageId: '777' });
    assert.equal(f.h.getSocialV2State(PRIVATE).recentMessages.find(m => m.messageId === '777')?.quotaAdmission, 'rejected');
    f.h.bot.getMessage = async id => ({ message_id: id, user_id: 124,
      sender: { user_id: 124, nickname: 'fixture-person' },
      message: [{ type: 'text', data: { text: refusedBody } }] });
    await f.h.handleIncoming('private', 124, { message_id: '778', user_id: 124, self_id: 9,
      sender: { nickname: 'fixture-person' }, message: [
        { type: 'reply', data: { id: '777' } }, { type: 'text', data: { text: '嗯嗯' } }
      ] }, f.h.cfg);
    const recent = await f.api('/api/socialV2/recent?key=' + encodeURIComponent(PRIVATE));
    assert.equal(recent.status, 200);
    assert.ok(!JSON.stringify(recent.data).includes('FIXTURE_REFUSED_QUOTED_BODY'), 'reply expansion must not launder a rejected source into an admitted message');
    assert.ok(!JSON.stringify(f.h.buildWakeSnapshotV2(PRIVATE)).includes('FIXTURE_REFUSED_QUOTED_BODY'));
    assert.ok(!f.h.buildWakePromptV2(PRIVATE, 'private').includes('FIXTURE_REFUSED_QUOTED_BODY'));
    assert.equal(used(f, PRIVATE), 0);
  } finally { await f.close(); }
});

test('evicted refused message detail stays blocked before any OneBot history fetch', async () => {
  const f = await open({ dailyLimit: 0 }); let historyReads = 0;
  try {
    f.h.cfg.socialV2.context ||= {};
    f.h.cfg.socialV2.context.recentLimit = 1;
    await f.incoming(PRIVATE, '请解释算法，FIXTURE_EVICTED_REFUSED_BODY', { messageId: '777' });
    await f.incoming(PRIVATE, '今天吃饭了吗？', { messageId: '778' });
    assert.ok(!f.h.getSocialV2State(PRIVATE).recentMessages.some(m => m.messageId === '777'), 'normal bounded history must evict the original source');
    f.h.bot.getMessage = async id => { historyReads++; return { message_id: id, user_id: 124,
      sender: { user_id: 124, nickname: 'fixture-person' },
      message: [{ type: 'text', data: { text: '请解释算法，FIXTURE_EVICTED_REFUSED_BODY' } }] }; };
    const detail = await f.api('/api/socialV2/message-detail?key=' + encodeURIComponent(PRIVATE) + '&messageId=777');
    assert.equal(detail.status, 403, 'admission denial must outlive the recent-message buffer');
    assert.ok(!JSON.stringify(detail.data).includes('FIXTURE_EVICTED_REFUSED_BODY'));
    assert.equal(historyReads, 0, 'reject before requesting withheld source text from OneBot');
  } finally { await f.close(); }
});

test('paused professional ingress cannot bypass admission after ordinary chat resumes', async () => {
  const f = await open({ dailyLimit: 0 });
  try {
    f.h.socialV2.paused = true;
    await f.incoming(PRIVATE, '请解释算法，FIXTURE_PAUSED_TECHNICAL_BODY', { messageId: 'paused-request' });
    assert.equal(f.h.calls.sent.length, 0, 'pause must not send a quota refusal');
    f.h.socialV2.paused = false;
    await f.incoming(PRIVATE, '今天吃饭了吗？', { messageId: 'resumed-ordinary' });
    const recent = await f.api('/api/socialV2/recent?key=' + encodeURIComponent(PRIVATE));
    assert.equal(recent.status, 200);
    assert.ok(!JSON.stringify(recent.data).includes('FIXTURE_PAUSED_TECHNICAL_BODY'), 'paused ingress must not become admitted merely because its handler returned early');
    assert.ok(!JSON.stringify(f.h.buildWakeSnapshotV2(PRIVATE)).includes('FIXTURE_PAUSED_TECHNICAL_BODY'));
    assert.ok(!f.h.buildWakePromptV2(PRIVATE, 'private').includes('FIXTURE_PAUSED_TECHNICAL_BODY'));
    assert.equal(used(f, PRIVATE), 0);
  } finally { await f.close(); }
});
