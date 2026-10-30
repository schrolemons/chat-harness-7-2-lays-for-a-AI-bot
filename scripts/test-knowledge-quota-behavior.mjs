import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlugin } from '../plugins/qq-components/ctx-knowledge-quota/index.js';
import { createPluginHost } from '../src/plugin-host.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../plugins/qq-components/ctx-knowledge-quota/plugin.json', import.meta.url), 'utf8'));
function fixture(config = {}, capabilities = {}, initial = {}) {
  let stored = structuredClone(initial);
  const plugin = createPlugin({ config: { ...manifest.config, ...config }, capabilities,
    state: { get: () => structuredClone(stored), set: patch => { stored = { ...stored, ...structuredClone(patch) }; } },
    registerTool() {}, warn() {}, log() {} });
  return { plugin, svc: plugin.services.knowledgeQuota, before: payload => plugin.hooks.beforePrompt(payload), state: () => structuredClone(stored) };
}
function request(text = '这个算法为什么正确？', options = {}) {
  const { key = 'private:124', messageId = 'm1', userId = '124', reason = 'question', isOwner = false, ...rest } = options;
  return { key, reason, isOwnerKey: isOwner && key.startsWith('private:'),
    st: { unread: [{ text, plain: text, messageId, userId, isOwner }] }, ...rest };
}
const positives = [
  '这个算法为什么正确？', '这段 Python 代码为什么报错？', '数学归纳法是什么',
  '论文中对照组有什么作用？', '请写一段 Python 代码', '证明这个定理',
  '推导欧拉公式', '比较两种算法的复杂度', '计算这个积分', '求解这个微分方程',
  '解释量子纠缠', '帮我设计一个实验验证假设', '请综述强化学习的研究现状',
  '什么是矩阵的秩', 'Python 中的装饰器是什么', '帮我看一下这段代码',
  '给我一份算法复杂度分析', 'Explain this SQL query', 'How does this algorithm work?',
  '这个定理成立吗？', '这个 Python 代码对吗？', '这个公式能用于边界情况吗？',
  '这个模型是否收敛？', '这两个算法一样吗？', '这个积分结果是多少？', '科研实验的样本量要多大？',
  '这里的生物实验有问题吗？',
  '@fixture 请解释算法',
];
const negatives = [
  '今天吃什么？', '刚看完一篇论文', '今天写代码好累', '论文写完了吗？',
  '你今天写代码了吗？', '帮我提醒明天交论文', '听说他研究量子物理',
  '代码代码代码', '这论文真好笑？', '我们别聊代码了，吃饭吗？',
  'Python？', '今天天气很好', '哈哈哈', '我不需要解释算法，先去吃饭',
];
for (const text of [
  '@9这个定理为什么成立？ TRAILING_CONTEXT',
  '@9请解释算法 TRAILING_CONTEXT',
  '@9@123请解释算法 TRAILING_CONTEXT'
]) test('adjacent QQ mention normalization preserves the professional request: ' + text, () => {
  const f = fixture(); f.before(request(text)); assert.equal(f.svc.usage('private:124').used, 1);
});
for (const text of positives) test('professional request counts: ' + text, () => {
  const f = fixture(); f.before(request(text)); assert.equal(f.svc.usage('private:124').used, 1);
});
for (const text of negatives) test('casual mention does not count: ' + text, () => {
  const f = fixture(); assert.equal(f.before(request(text)), ''); assert.equal(f.svc.usage('private:124').used, 0);
});

test('same message retry keeps final admitted allowance; a new identical message consumes another allowance', () => {
  const f = fixture({ dailyLimit: 2 });
  f.before(request(undefined, { messageId: 'm1' }));
  const final = f.before(request(undefined, { messageId: 'm2' }));
  assert.equal(f.svc.usage('private:124').used, 2);
  assert.ok(!final.includes('配额已用完'));
  assert.equal(f.before(request(undefined, { messageId: 'm2' })), final);
  assert.ok(f.before(request(undefined, { messageId: 'm3' })).includes('配额已用完'));
});

test('different long messages sharing the first eighty characters are charged separately', () => {
  const f = fixture(); const prefix = '请解释这个算法' + '细节'.repeat(50);
  f.before(request(prefix + '问题一', { messageId: 'long1' }));
  f.before(request(prefix + '问题二', { messageId: 'long2' }));
  assert.equal(f.svc.usage('private:124').used, 2);
});

test('full-text fallback without message IDs avoids eighty-character collisions', () => {
  const f = fixture(); const prefix = '请解释这个算法' + '细节'.repeat(50);
  f.before(request(prefix + '问题一', { messageId: null }));
  f.before(request(prefix + '问题二', { messageId: null }));
  assert.equal(f.svc.usage('private:124').used, 2);
});

test('owner exemption applies to actual group author and can be disabled', () => {
  for (const key of ['private:124', 'group:456']) {
    const f = fixture(); f.before(request(undefined, { key, isOwner: true }));
    assert.equal(f.svc.usage(key).used, 0);
    const nonExempt = fixture({ exemptOwner: false }); nonExempt.before(request(undefined, { key, isOwner: true }));
    assert.equal(nonExempt.svc.usage(key).used, 1);
  }
});

test('group session buckets share usage; user buckets isolate authors and private remains one session', () => {
  const session = fixture(); const user = fixture({ countBy: 'user' });
  for (const [messageId, userId] of [['a', '124'], ['b', '125']]) {
    const p = request(undefined, { key: 'group:456', messageId, userId }); session.before(p); user.before(p);
  }
  assert.equal(session.svc.usage('group:456').used, 2);
  assert.equal(user.svc.usage('group:456#124').used, 1);
  assert.equal(user.svc.usage('group:456#125').used, 1);
  user.before(request()); assert.equal(user.svc.usage('private:124').used, 1);
});

test('querying a group in per-user mode returns its real member counters rather than a misleading zero', () => {
  const f = fixture({ countBy: 'user' });
  f.before(request(undefined, { key: 'group:456', userId: '124', messageId: 'a' }));
  f.before(request(undefined, { key: 'group:456', userId: '125', messageId: 'b' }));
  f.before(request(undefined, { key: 'group:789', userId: '124', messageId: 'c' }));
  const group = f.svc.report('group:456');
  assert.equal(group.countBy, 'user'); assert.equal(group.exemptOwner, true);
  assert.deepEqual(group.entries.map(x => [x.key, x.used]), [['group:456#124', 1], ['group:456#125', 1]]);
  assert.equal(f.svc.report('group:456#124').used, 1);
});

test('configured resetHour rolls usage over and an old message retry does not consume the new day', context => {
  let now = new Date(2026, 9, 29, 3, 59).getTime(); context.mock.method(Date, 'now', () => now);
  const f = fixture({ dailyLimit: 1, resetHour: 4 }); f.before(request());
  assert.equal(f.svc.usage('private:124').used, 1);
  now += 2 * 60000;
  assert.equal(f.svc.usage('private:124').used, 0);
  f.before(request()); assert.equal(f.svc.usage('private:124').used, 0);
  f.before(request(undefined, { messageId: 'new-day' })); assert.equal(f.svc.usage('private:124').used, 1);
});

test('reset clears both usage and matching dedup decisions without affecting another session', () => {
  const f = fixture(); f.before(request()); f.before(request(undefined, { key: 'private:125', userId: '125' }));
  f.svc.reset('private:124'); f.before(request());
  assert.equal(f.svc.usage('private:124').used, 1);
  assert.equal(f.svc.usage('private:125').used, 1);
});

test('only latest nonself message is classified; an earlier technical mention is not a new latest request', () => {
  const f = fixture(); const p = request(); p.st.unread.push({ text: '先去吃饭啦', userId: '124', messageId: 'm2' });
  f.before(p); assert.equal(f.svc.usage('private:124').used, 0);
});

test('maintenance and proactive turns never create counting decisions or quota prompt', () => {
  const f = fixture({ dailyLimit: 0 });
  for (const reason of ['memoryWrite', 'selfReview', 'selfOptimize', 'userFeedbackReview', 'slangLearn', 'maintenance', 'dailyDiary', 'taskDone', 'reminder', 'timeBubble', 'startupGreeting', 'careCheck', 'newsShare', 'idleRescue', 'proactiveCheck', 'scheduledContact:fixture']) {
    assert.equal(f.before(request(undefined, { reason })), '');
  }
  assert.deepEqual(f.state(), {});
});

test('custom domain words and disabled switch govern real counting without hidden defaults', () => {
  const f = fixture({ keywords: ['晶格'], dailyLimit: 2 });
  f.before(request('请推导晶格的色散关系')); assert.equal(f.svc.usage('private:124').used, 1);
  f.before(request('请写 Python 代码', { messageId: 'outside-custom-keywords' })); assert.equal(f.svc.usage('private:124').used, 1);
  const disabled = fixture({ enabled: false, dailyLimit: 0 });
  assert.equal(disabled.before(request()), ''); assert.deepEqual(disabled.state(), {});
});

test('zero allowance blocks the first identified request; ordinary chatting still passes', async () => {
  const f = fixture({ dailyLimit: 0 }, { sendSessionText: async () => true });
  assert.equal((await f.svc.preflight({ key: 'private:124', plainContent: '请解释算法', messageId: 'zero', allowed: true })).handled, true);
  assert.equal(f.svc.usage('private:124').used, 0);
  assert.equal((await f.svc.preflight({ key: 'private:124', plainContent: '你好呀', messageId: 'chat', allowed: true })).handled, false);
});

test('deflectText controls actual capability output; legacy style instructions are not consumed', async () => {
  const sent = [];
  const f = fixture({ dailyLimit: 0, deflectText: '  先自己查查资料呀。\n我现在讲不清。  ', deflectStyle: 'LEGACY_INSTRUCTIONS_MUST_NOT_APPEAR' },
    { sendSessionText: async (key, text) => { sent.push({ key, text }); return true; } });
  const p = { key: 'private:124', plainContent: '请解释算法', messageId: 'custom-deflect', userId: '124', allowed: true };
  assert.equal((await f.svc.preflight(p)).handled, true);
  assert.equal(sent[0].text, '先自己查查资料呀。 我现在讲不清。');
  assert.ok(!f.before(request('请解释算法', { messageId: 'custom-deflect' })).includes('LEGACY_INSTRUCTIONS'));
});

test('real preflight permits first request and mechanically handles exceeded private and group requests', async () => {
  for (const key of ['private:124', 'group:456']) {
    const sent = []; let modelDispatches = 0; let handled = 0;
    const f = fixture({ dailyLimit: 1 }, { sendSessionText: async (key, text) => { sent.push({ key, text }); return true; } });
    const run = async messageId => { const result = await f.svc.preflight({ key, plainContent: '请解释这个算法', messageId, userId: '124', allowed: true, onHandled: () => handled++ }); if (!result.handled) modelDispatches++; return result; };
    assert.equal((await run('first')).handled, false);
    assert.ok(!f.before(request('请解释这个算法', { key, messageId: 'first' })).includes('配额已用完'));
    assert.equal((await run('blocked')).handled, true);
    assert.equal(modelDispatches, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].key, key);
    assert.ok(!sent[0].text.includes('配额'));
    assert.equal((await run('blocked')).handled, true);
    assert.equal(sent.length, 1);
    assert.equal(handled, 2);
    assert.equal(f.svc.usage(key).used, 1);
  }
});

test('preflight failure remains handled and cannot auto-resend or fall through to a model', async () => {
  let attempts = 0; const f = fixture({ dailyLimit: 0 }, { sendSessionText: async () => { attempts++; throw Error('unconfirmed'); } });
  const p = { key: 'private:124', plainContent: '请解释算法', userId: '124', messageId: 'failed', allowed: true };
  assert.equal((await f.svc.preflight(p)).handled, true);
  assert.equal((await f.svc.preflight(p)).handled, true);
  assert.equal(attempts, 1);
  assert.equal(f.svc.usage('private:124').used, 0);
});

test('handled callback closes the pending message after durable claim and before external send', async () => {
  let handled = false; let f;
  f = fixture({ dailyLimit: 0 }, { sendSessionText: async () => {
    assert.equal(handled, true, 'get_unread must stop exposing this request before send awaits');
    assert.ok(Object.values(f.state().hits).some(hit => hit.deflection?.status === 'claimed'));
    return true;
  } });
  const result = await f.svc.preflight({ key: 'private:124', plainContent: '请解释算法', messageId: 'pending-race', allowed: true,
    onHandled: () => { handled = true; } });
  assert.equal(result.handled, true); assert.equal(result.delivered, true);
});

test('preflight call contexts with and without userId reuse the same real message decision', async () => {
  const f = fixture({ dailyLimit: 2 });
  await f.svc.preflight({ key: 'private:124', plainContent: '请解释算法', messageId: 'shared', userId: '124', allowed: true });
  await f.svc.preflight({ key: 'private:124', plainContent: '请解释算法', messageId: 'shared', allowed: true });
  f.before(request('请解释算法', { messageId: 'shared' }));
  assert.equal(f.svc.usage('private:124').used, 1);
});

test('persistence failure cannot fall through to model dispatch or send without a claim', async () => {
  let sent = 0;
  const p = createPlugin({ config: manifest.config, state: { get: () => ({}), set: () => { throw Error('disk unavailable'); } },
    capabilities: { sendSessionText: async () => { sent++; return true; } }, registerTool() {}, warn() {} });
  const result = await p.services.knowledgeQuota.preflight({ key: 'private:124', plainContent: '请解释算法', messageId: 'persist-fail', userId: '124', allowed: true });
  assert.equal(result.handled, true); assert.equal(result.receiptStatus, 'persist_failed'); assert.equal(sent, 0);
});

test('retention never deletes an unresolved outbound deflection receipt', async () => {
  const hits = Object.fromEntries(Array.from({ length: 1999 }, (_, i) => ['legacy-' + i, { at: Date.now() + 10000, action: 'allow' }]));
  const f = fixture({ dailyLimit: 0 }, { sendSessionText: async () => false }, { hits });
  const payload = { key: 'private:124', plainContent: '请解释算法', messageId: 'uncertain-oldest', userId: '124', allowed: true };
  await f.svc.preflight(payload);
  f.before(request('请解释算法', { messageId: 'newest' }));
  const record = Object.values(f.state().hits).find(hit => hit.messageId === 'uncertain-oldest');
  assert.equal(record?.deflection?.status, 'uncertain');
});

test('resetting allowance cannot delete sent or uncertain deflection receipts and replay refusal', async () => {
  for (const resetKey of ['private:124', '']) {
    let sends = 0; const f = fixture({ dailyLimit: 1 }, { sendSessionText: async () => { sends++; return true; } });
    f.before(request(undefined, { messageId: 'admitted' }));
    const p = { key: 'private:124', plainContent: '请解释算法', messageId: 'blocked', userId: '124', allowed: true };
    assert.equal((await f.svc.preflight(p)).handled, true);
    f.svc.reset(resetKey);
    assert.equal((await f.svc.preflight(p)).handled, true); assert.equal(sends, 1);
    assert.equal((await f.svc.preflight({ ...p, messageId: 'new-after-reset' })).handled, false);
  }
});

test('repeated preflight and beforePrompt share one refusal; ordinary conversation still passes', async () => {
  const sent = []; const f = fixture({ dailyLimit: 0 }, { sendSessionText: async (...args) => { sent.push(args); return true; } });
  const p = { key: 'private:124', plainContent: '请解释算法', messageId: 'shared-refusal', userId: '124', allowed: true };
  assert.equal((await f.svc.preflight(p)).handled, true);
  assert.ok(f.before(request('请解释算法', { messageId: 'shared-refusal' })).includes('配额已用完'));
  assert.equal((await f.svc.preflight(p)).handled, true); assert.equal(sent.length, 1);
  assert.equal((await f.svc.preflight({ ...p, plainContent: '今天吃什么？', messageId: 'casual' })).handled, false);
  assert.equal((await f.svc.preflight({ ...p, allowed: false, messageId: 'disallowed' })).handled, false);
});

test('one explicit admission service is exposed without a relay hook and classification stays read-only', () => {
  const f = fixture(); assert.deepEqual(Object.keys(f.plugin.hooks), ['beforePrompt']);
  assert.equal(f.svc.classify(request()).professional, true); assert.deepEqual(f.state(), {});
  assert.deepEqual(manifest.hooks, ['beforePrompt']);
});

test('unaddressed first group bootstrap cannot consume a professional allowance without prior admission', () => {
  const f = fixture({ dailyLimit: 1 });
  const p = request('请解释这个算法', { key: 'group:456', reason: 'bootstrap', messageId: 'unaddressed-bootstrap' });
  assert.equal(f.before(p), '');
  assert.equal(f.svc.usage('group:456').used, 0);
  assert.deepEqual(f.state(), {});
});

test('addressed group bootstrap reuses prior preflight admission and refusal without another classification path', async () => {
  for (const dailyLimit of [1, 0]) {
    const f = fixture({ dailyLimit }, { sendSessionText: async () => true });
    const incoming = { key: 'group:456', reason: 'atMention', plainContent: '请解释这个算法', messageId: 'addressed-bootstrap', userId: '124', allowed: true };
    const first = await f.svc.preflight(incoming);
    assert.equal(first.action, dailyLimit ? 'allow' : 'deflect');
    const result = f.svc.evaluate(request('请解释这个算法', { key: 'group:456', reason: 'bootstrap', messageId: 'addressed-bootstrap' }));
    assert.equal(result.action, first.action);
    assert.equal(result.duplicate, true);
    assert.equal(f.svc.usage('group:456').used, dailyLimit ? 1 : 0);
    assert.equal(result.prompt.includes('配额已用完'), dailyLimit === 0);
  }
});

test('quota counters and deflection send claim survive a real host reload with temporary state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-quota-behavior-')); let host; const sends = [];
  try {
    const dir = path.join(root, 'plugins/qq-components/ctx-knowledge-quota'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ ...manifest, main: 'entry.mjs' }));
    fs.writeFileSync(path.join(dir, 'entry.mjs'), 'export {createPlugin} from ' + JSON.stringify(pathToFileURL(path.resolve('plugins/qq-components/ctx-knowledge-quota/index.js')).href) + ';');
    host = createPluginHost({ root, startTimers: false, capabilities: { sendSessionText: async (key, text) => { sends.push({ key, text }); return true; } } });
    await host.loadAll(); host.setConfig('ctx-knowledge-quota', { dailyLimit: 1, deflectText: '第一种实际带过句' }); await host.reload('ctx-knowledge-quota');
    const preflight = messageId => host.callService('knowledgeQuota', 'preflight', { key: 'private:124', plainContent: '请解释算法', userId: '124', messageId, allowed: true });
    assert.equal((await preflight('first')).handled, false); assert.equal((await preflight('blocked')).handled, true);
    await host.reload('ctx-knowledge-quota'); assert.equal((await preflight('blocked')).handled, true);
    assert.equal(sends.length, 1); assert.equal(sends[0].text, '第一种实际带过句');
    host.setConfig('ctx-knowledge-quota', { deflectText: '第二种实际带过句' }); await host.reload('ctx-knowledge-quota');
    assert.equal((await preflight('another-blocked')).handled, true); assert.equal(sends[1].text, '第二种实际带过句');
    assert.equal(host.callService('knowledgeQuota', 'usage', 'private:124').used, 1);
  } finally {
    await host?.dispose(); assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('qq-quota-behavior-')); fs.rmSync(root, { recursive: true, force: true });
  }
});
