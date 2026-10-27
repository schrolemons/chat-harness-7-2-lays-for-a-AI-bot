// 已读/已回复双时间戳（seenAt / repliedAt）回归：重启不重刷已回复消息、也不漏掉缺戳的消息。
// 全程用 bridgeHarness 的隔离状态文件与桩网关，不碰真实 QQ / DSH / state。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const KEY = 'private:123';
let failures = 0;
let tests = 0;

const seqs = (messages) => Array.from(messages ?? [], (message) => message.seq);

const CONFIG = { socialV2: {
  wake: { preSleepWaitEnabled: false, preSleepWaitMs: 1000 },
  wait: { minMs: 100, maxMs: 2000, minQuietAfterNewMs: 0 },
  proactive: { enabled: false },
  sticker: { enabled: false },
} };

async function open({ savedState } = {}) {
  const h = await bridgeHarness({
    config: CONFIG,
    files: savedState ? { 'state/social-v2.json': savedState } : undefined,
  });
  h.setMode('reserved2');
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const call = (route, { body, query = '', token } = {}) => new Promise((resolve, reject) => {
    const st = h.getSocialV2State(KEY);
    // 控制台服务端即使对 agent 调用也会先过 x-console-token 鉴权，缺了就是 401。
    const headers = { 'x-console-token': 'fixture-console-token', 'x-agent-token': token ?? st.agentToken };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const req = http.request({
      hostname: '127.0.0.1', port,
      path: route.startsWith('/api/') ? route : `/api/socialV2/${route}?key=${encodeURIComponent(KEY)}${query}`,
      method: body === undefined ? 'GET' : 'POST', headers,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (error) { reject(new Error(`bad JSON from ${route}: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => req.destroy(new Error(`fixture HTTP request timed out: ${route}`)));
    req.end(body === undefined ? undefined : JSON.stringify({ key: KEY, ...body }));
  });
  const append = (text) => {
    const st = h.getSocialV2State(KEY);
    const id = `fixture-${st.lastUnreadSeq + 1}`;
    h.appendSocialV2Message(KEY, 'fixture-person', text, text, false, false, id, [], '789', []);
    return h.getSocialV2State(KEY).lastUnreadSeq;
  };
  const statePath = path.join(h.temp, 'state', 'social-v2.json');
  const readSavedState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return {
    h, call, append, readSavedState,
    st: () => h.getSocialV2State(KEY),
    async close() { await new Promise((resolve) => server.close(resolve)); await h.close(); },
  };
}

async function test(name, run) {
  tests++;
  try { await run(); console.log('PASS', name); }
  catch (error) { failures++; console.error('FAIL', name, error.stack); }
}

const savedConversation = (fields) => ({
  paused: false,
  conversations: { [KEY]: { wakeConfig: { mode: 'active', infinite: true, confirmedBy: 'set_wake_config' }, ...fields } },
});
const message = (seq, fields = {}) => ({
  seq, messageId: `saved-${seq}`, sender: 'fixture-person', time: Date.now() - (10 - seq) * 60000,
  text: `message ${seq}`, plain: `message ${seq}`, isSelf: false, media: [], forwardIds: [], ...fields,
});

// ── 1. 读取 = seenAt；回复 = repliedAt；回复后重启不重刷 ─────────────────────
await test('reading stamps seenAt and a batch reply stamps repliedAt', async () => {
  const c = await open();
  try {
    c.append('first');
    const read = await c.call('unread');
    assert.equal(read.status, 200);
    assert.equal(read.data.readThroughSeq, 1);
    assert.ok(read.data.messages[0].seenAt > 0, 'the read message must carry seenAt');
    assert.equal(read.data.messages[0].awaitingReply, true, 'seen-but-unreplied must be flagged');
    assert.equal(c.st().unread[0].seenAt, read.data.messages[0].seenAt, 'receipt is stored on the buffer');

    const sent = await c.call('/api/send/private', { body: { token: c.st().agentToken, userId: '123', message: 'reply' } });
    assert.equal(sent.status, 200, `send must succeed: ${JSON.stringify(sent.data)}`);
    assert.equal(sent.data.sent, 1);
    assert.deepEqual(seqs(c.st().unread), [], 'a replied message leaves the unread buffer');
    assert.equal(c.st().lastReadThroughSeq, 1);

    // 落盘状态就是重启后会读到的状态：已双戳的消息不应再出现在 unread 里。
    const saved = c.readSavedState().conversations[KEY];
    assert.deepEqual(seqs(saved.unread), []);
    assert.equal(saved.lastReadThroughSeq, 1);
  } finally { await c.close(); }
});

// ── 2. 回复只盖「本轮看过的」：新到的消息不跟着变成已回复 ────────────────────
await test('a reply does not stamp a newer message the model never saw', async () => {
  const c = await open();
  try {
    c.append('seen one');
    assert.equal((await c.call('unread')).status, 200);
    c.append('unseen new arrival');
    const sent = await c.call('/api/send/private', { body: { token: c.st().agentToken, userId: '123', message: 'reply' } });
    assert.equal(sent.status, 200);
    assert.deepEqual(seqs(c.st().unread), [2], 'the unseen arrival must stay pending');
    const unseen = c.st().unread[0];
    assert.ok(!Number(unseen.seenAt), 'unseen message must not be marked seen by the reply');
    assert.ok(!Number(unseen.repliedAt), 'unseen message must not be marked replied by the reply');
    assert.equal(c.st().lastReadThroughSeq, 1, 'the watermark stops before the unseen message');
  } finally { await c.close(); }
});

// ── 3. 重启：已双戳摘除；只有 seenAt 的仍然待处理；水位卡在第一个缺戳处 ──────
await test('restart drops fully stamped messages and resumes at the first missing stamp', async () => {
  const now = Date.now();
  const c = await open({ savedState: savedConversation({
    unread: [
      message(1, { seenAt: now - 50000, repliedAt: now - 45000 }),
      message(2, { seenAt: now - 40000 }),
      message(3),
      message(4),
    ],
    recentMessages: [message(1), message(2), message(3), message(4)],
    lastUnreadSeq: 4,
    lastReadThroughSeq: 2,
  }) });
  try {
    const st = c.st();
    assert.deepEqual(seqs(st.unread), [2, 3, 4], 'only the fully stamped message is normalized away');
    assert.ok(st.unread[0].seenAt > 0, 'seenAt survives restart');
    assert.ok(!Number(st.unread[0].repliedAt), 'seen-but-unreplied keeps no repliedAt');
    assert.equal(st.lastReadThroughSeq, 2, 'watermark must not be dragged forward past pending messages');

    // /state 只读，不会给消息打 seenAt：这里能看到「重启后」的原始双戳状态。
    const state = await c.call('state');
    assert.equal(state.data.awaitingReplyCount, 1, 'only the seen-but-unreplied message is outstanding');
    assert.equal(state.data.firstPendingSeq, 2, 'restart resumes at the first missing stamp');
    const stateBySeq = new Map(state.data.pendingMessages.map((m) => [m.seq, m]));
    assert.equal(stateBySeq.get(2).awaitingReply, true);
    assert.equal(stateBySeq.get(2).seenAt > 0, true);
    assert.equal(stateBySeq.get(3).seenAt, null, 'never-seen message must not be marked seen on load');
    assert.equal(stateBySeq.get(4).repliedAt, null);

    // 唤醒快照也必须从第一条缺戳的消息开始（此时第 3、4 条还没被看过）。
    const snapshot = c.h.buildWakeSnapshotV2(KEY);
    assert.equal(snapshot.pendingFromSeq, 2, 'wake snapshot points at the first missing stamp');
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.awaitingReplySeqs)), [2]);

    // 读取本身会给整页补 seenAt（这是「交给模型看过了」的唯一事实来源）。
    const view = await c.call('unread');
    assert.equal(view.data.firstPendingSeq, 2, 'reading a page still resumes at the first missing stamp');
    assert.deepEqual(seqs(view.data.messages), [2, 3, 4]);
    assert.equal(view.data.messages[0].awaitingReply, true);
  } finally { await c.close(); }
});

// ── 4. 老状态无戳：水位以下的按兜底归一化，水位以上的保持未读、不被标成已回复 ──
await test('legacy messages without stamps only fall back to the persisted watermark', async () => {
  const c = await open({ savedState: savedConversation({
    unread: [message(1), message(2)],
    recentMessages: [message(1), message(2)],
    lastUnreadSeq: 2,
    lastReadThroughSeq: 1,
  }) });
  try {
    const st = c.st();
    assert.deepEqual(seqs(st.unread), [2], 'legacy message at or below the watermark is treated as processed');
    assert.ok(!Number(st.unread[0].seenAt), 'message above the watermark must not get seenAt on load');
    assert.ok(!Number(st.unread[0].repliedAt), 'message above the watermark must not get repliedAt on load');

    // /state 只读：未看过的消息不会被标成 seen，更不会被标成 replied。
    const state = await c.call('state');
    assert.equal(state.data.awaitingReplyCount, 0, 'never-seen legacy message must not be reported as seen');
    assert.equal(state.data.firstPendingSeq, 2);
    assert.equal(state.data.lastReadThroughSeq, 1, 'watermark keeps its legacy value');
    assert.equal(state.data.pendingMessages[0].seenAt, null);
    assert.equal(state.data.pendingMessages[0].repliedAt, null);

    const view = await c.call('unread');
    assert.equal(view.data.awaitingReplyCount, 1, 'reading marks it seen, so it becomes awaiting-reply');
    assert.equal(view.data.readThroughSeq, 2, 'the watermark advances only now that the message was seen');
    assert.deepEqual(seqs(view.data.messages), [2]);
  } finally { await c.close(); }
});

// ── 5. mark_read(throughSeq) 只给已有 seenAt 的补 repliedAt，绝不越权盖章 ────
await test('mark-read only stamps messages that already carry seenAt', async () => {
  const c = await open();
  try {
    c.append('older unseen');
    c.append('newer seen');
    const late = await c.call('unread', { query: '&afterSeq=1&limit=10' });
    assert.deepEqual(seqs(late.data.messages), [2]);
    assert.equal(late.data.readThroughSeq, 0, 'an unseen earlier message blocks the watermark');

    // 想用水位 2 一口气收尾会被拒绝：没有 seenAt 的消息不允许被标成已回复。
    const denied = await c.call('mark-read', { body: { throughSeq: 2 } });
    assert.equal(denied.status, 400);
    assert.deepEqual(seqs(c.st().unread), [1, 2]);
    assert.ok(!Number(c.st().unread[0].seenAt));

    // 补读那条老消息之后，水位才能推进，两条一起双戳并摘除。
    const full = await c.call('unread');
    assert.equal(full.data.readThroughSeq, 2);
    assert.ok(full.data.messages.every((m) => m.seenAt > 0));
    const marked = await c.call('mark-read', { body: { throughSeq: 2 } });
    assert.equal(marked.status, 200);
    assert.deepEqual(seqs(c.st().unread), []);
    const saved = c.readSavedState().conversations[KEY];
    assert.deepEqual(seqs(saved.unread), []);
    assert.equal(saved.lastReadThroughSeq, 2);
  } finally { await c.close(); }
});

console.log(failures ? `Read receipts regressions: ${tests - failures}/${tests} passed.` : `Read receipts bridge regressions: ${tests}/${tests} passed.`);
if (failures) process.exitCode = 1;
