// 已读/已回复双时间戳（seenAt / repliedAt）回归：重启不重刷已回复消息、也不漏掉缺戳的消息。
// 全程用 bridgeHarness 的隔离状态文件与桩网关，不碰真实 QQ / DSH / state。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { bridgeHarness,fixtureReplyTurn } from './audit-bridge-harness.mjs';

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
  const call = async (route, { body, query = '', token, agent = true } = {}) => {if(agent && /send-message|send-burst|reply$|\/api\/send\//.test(route))await fixtureReplyTurn(h,KEY);return new Promise((resolve, reject) => {
    const st = h.getSocialV2State(KEY);
    // 控制台服务端即使对 agent 调用也会先过 x-console-token 鉴权，缺了就是 401。
    const headers = { 'x-console-token': 'fixture-console-token' };
    if (agent) headers['x-agent-token'] = token ?? st.agentToken;
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
  };
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
await test('each normal incoming message records its count-based receipt window', async () => {
  const c = await open();
  try {
    c.append('first inbound');
    assert.equal(c.st().doubleStampCheck?.triggerSeq, 1, 'normal text arrival must create a receipt audit');
    assert.deepEqual(Array.from(c.st().doubleStampCheck?.windowSeqs ?? []), [1]);

    c.append('second inbound');
    assert.equal(c.st().doubleStampCheck?.triggerSeq, 2);
    assert.deepEqual(Array.from(c.st().doubleStampCheck?.windowSeqs ?? []), [1, 2], 'the previous A messages and current trigger belong to the window');
    assert.deepEqual(Array.from(c.st().doubleStampCheck?.receipts ?? [], (item) => item.state), ['unseen', 'unseen']);
    const snapshot = c.h.buildWakeSnapshotV2(KEY);
    assert.equal(snapshot.conversationId, KEY);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.receiptWindow.map((item) => item.seq))), [1]);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.messages.map((item) => item.seq))), [1, 2]);
  } finally { await c.close(); }
});

await test('messages-purpose wait is rejected while any inbound receipt is still pending', async () => {
  const c = await open();
  try {
    const seq = c.append('inbound must be answered before waiting for another user turn');
    const wait = await c.call('wait', { body: { purpose: 'messages', timeoutMs: 1000 } });
    assert.equal(wait.status, 409, JSON.stringify(wait.data));
    assert.deepEqual(wait.data.pendingSeqs, [seq]);
    assert.match(wait.data.error, /先读取并处理/);
  } finally { await c.close(); }
});

await test('messages-purpose wait remains available after the reply receipt closes the inbound turn', async () => {
  const c = await open();
  try {
    c.append('inbound to answer');
    assert.equal((await c.call('unread')).status, 200);
    const sent = await c.call('/api/send/private', { body: { token: c.st().agentToken, userId: '123', message: 'completed answer' } });
    assert.equal(sent.status, 200);
    const receipt = await c.call('/api/socialV2/receipt-report', { body: { conversationId: KEY, receipts: [{ seq: 1, status: 'replied' }] } });
    assert.equal(receipt.status, 200);
    const wait = await c.call('wait', { body: { purpose: 'messages', timeoutMs: 100 } });
    assert.equal(wait.status, 200, JSON.stringify(wait.data));
    assert.equal(wait.data.purpose, 'messages');
    assert.deepEqual(seqs(c.st().unread), []);
  } finally { await c.close(); }
});

await test('a message returned by wait is persisted as seen before the next receipt report', async () => {
  const c = await open();
  try {
    const waiting = c.call('wait', { body: { purpose: 'messages', timeoutMs: 800 } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const seq = c.append('arrived during wait');
    const result = await waiting;
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const offered = result.data.newMessages.find((item) => item.seq === seq);
    assert.ok(offered?.seenAt > 0, 'wait-returned messages must be stamped seen before they reach the model');
    assert.ok(c.st().unread.find((item) => item.seq === seq)?.seenAt > 0, 'seenAt must be stored, not only added to the response');
  } finally { await c.close(); }
});

await test('legacy mark-read cannot infer repliedAt while JSON receipt reporting is enabled', async () => {
  const c = await open();
  try {
    c.append('reply status must come from the JSON receipt report');
    assert.equal((await c.call('unread')).status, 200);
    const marked = await c.call('mark-read', { body: { throughSeq: 1 } });
    assert.equal(marked.status, 200);
    assert.deepEqual(seqs(c.st().unread), [1], 'mark-read may not remove the message before a replied JSON receipt');
    assert.ok(!Number(c.st().unread[0].repliedAt), 'legacy acknowledgment must not forge repliedAt');
  } finally { await c.close(); }
});

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
    const report = await c.call('/api/socialV2/receipt-report', { body: { conversationId: KEY, receipts: [{ seq: 1, status: 'replied' }] } });
    assert.equal(report.status, 200, `JSON receipt must succeed: ${JSON.stringify(report.data)}`);
    assert.deepEqual(seqs(c.st().unread), [], 'a replied message leaves the unread buffer');
    assert.equal(c.st().lastReadThroughSeq, 1);

    // 落盘状态就是重启后会读到的状态：已双戳的消息不应再出现在 unread 里。
    const saved = c.readSavedState().conversations[KEY];
    assert.deepEqual(seqs(saved.unread), []);
    assert.equal(saved.lastReadThroughSeq, 1);
  } finally { await c.close(); }
});

await test('a successful send remains valid reply evidence after a bridge restart', async () => {
  let c = await open();
  c.append('message delivered while the agent was waiting');
  const read = await c.call('unread');
  assert.ok(read.data.messages[0].seenAt > 0);
  const sent = await c.call('/api/send/private', { body: { token: c.st().agentToken, userId: '123', message: 'reply before restart' } });
  assert.equal(sent.status, 200);
  const savedState = c.readSavedState();
  assert.deepEqual(savedState.conversations[KEY].receiptSendPendingSeqs, [1], 'persist only the seen message for which a successful send is evidence');
  await c.close();

  c = await open({ savedState });
  try {
    const report = await c.call('/api/socialV2/receipt-report', {
      body: { conversationId: KEY, receipts: [{ seq: 1, status: 'replied' }] },
    });
    assert.equal(report.status, 200, `known successful send must remain reportable after restart: ${JSON.stringify(report.data)}`);
    assert.deepEqual(seqs(c.st().unread), []);
  } finally { await c.close(); }
});

await test('a successful send cannot authorize a message that arrived afterward', async () => {
  const c = await open();
  try {
    c.append('first message seen before sending');
    await c.call('unread');
    const sent = await c.call('/api/send/private', { body: { token: c.st().agentToken, userId: '123', message: 'reply to first' } });
    assert.equal(sent.status, 200);
    const secondSeq = c.append('second message arrived after the successful send');
    const read = await c.call('unread', { query: '&afterSeq=1' });
    assert.ok(read.data.messages.some((item) => item.seq === secondSeq && item.seenAt > 0));
    const report = await c.call('/api/socialV2/receipt-report', {
      body: { conversationId: KEY, receipts: [{ seq: secondSeq, status: 'replied' }] },
    });
    assert.equal(report.status, 409);
    assert.match(report.data.error, /没有对应的成功发送记录/);
    assert.deepEqual(seqs(c.st().unread), [1, 2]);
  } finally { await c.close(); }
});

await test('a delegated send records reply evidence on the conversation that received the reply', async () => {
  const c = await open();
  try {
    const targetKey = 'group:456';
    const target = c.h.getSocialV2State(targetKey);
    c.h.appendSocialV2Message(targetKey, 'fixture-person', 'reply arrived during the delegated wait', 'reply arrived during the delegated wait', false, false, 'group-fixture-1', [], '789', []);
    target.unread[0].seenAt = Date.now();
    const sent = await c.h.sendAgentReplyV2(targetKey, 'acknowledgment in target conversation', { token: c.st().agentToken });
    assert.equal(sent.sent, 1);
    assert.deepEqual(Array.from(target.receiptSendPendingSeqs), [1], 'the target conversation needs its own seq-scoped send evidence');
    const report = await c.call('/api/socialV2/receipt-report', {
      body: { conversationId: targetKey, receipts: [{ seq: 1, status: 'replied' }] },
    });
    assert.equal(report.status, 200, `delegated reply must close the target receipt: ${JSON.stringify(report.data)}`);
    assert.deepEqual(Array.from(target.unread), []);
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
    const report = await c.call('/api/socialV2/receipt-report', { body: { conversationId: KEY, receipts: [{ seq: 1, status: 'replied' }] } });
    assert.equal(report.status, 200, JSON.stringify(report.data));
    assert.deepEqual(seqs(c.st().unread), [2], 'the unseen arrival must stay pending');
    const unseen = c.st().unread[0];
    assert.ok(!Number(unseen.repliedAt), 'a follow-up check may read it, but this reply must not mark it replied');
    assert.equal(c.st().doubleStampCheck?.enabled, true, 'reply-time window check must be enabled by default');
    assert.ok(c.st().doubleStampCheck?.checkedAt > 0, 'reply-time window check must record when it ran');
    assert.equal(c.st().doubleStampCheck?.triggerSeq, 2, 'the new message is the current check trigger');
    assert.deepEqual(Array.from(c.st().doubleStampCheck?.windowSeqs ?? []), [1, 2]);
  } finally { await c.close(); }
});

await test('plain-text agent replies run the configured double-stamp window check', async () => {
  const c = await open();
  try {
    c.append('message seen before the turn');
    assert.equal((await c.call('unread')).status, 200);
    c.append('message arrived while the agent was generating');

    await c.h.sendAgentReplyV2(KEY, 'the agent plain-text reply');

    assert.equal(c.st().doubleStampCheck?.enabled, true);
    assert.ok(c.st().doubleStampCheck?.checkedAt > 0);
    assert.equal(c.st().doubleStampCheck?.triggerSeq, 2);
    assert.deepEqual(Array.from(c.st().doubleStampCheck?.windowSeqs ?? []), [1, 2]);
    assert.deepEqual(seqs(c.st().unread), [1, 2], 'a sent response without a JSON receipt must leave both messages pending');
  } finally { await c.close(); }
});

await test('double-stamp window setting is exposed and bounded by the config API', async () => {
  const c = await open();
  try {
    const saved = await c.call('/api/socialV2/config', { agent: false, body: { doubleStamp: { enabled: false, windowCount: 999 } } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const loaded = await c.call('/api/socialV2/config', { agent: false });
    assert.equal(loaded.data.config.doubleStamp.enabled, false);
    assert.equal(loaded.data.config.doubleStamp.windowCount, 100);
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

// ── 4. 老状态无戳：不能仅凭水位假装消息已读或已回复 ────────────────────────
await test('legacy messages without stamps remain pending regardless of the persisted watermark', async () => {
  const c = await open({ savedState: savedConversation({
    unread: [message(1), message(2)],
    recentMessages: [message(1), message(2)],
    lastUnreadSeq: 2,
    lastReadThroughSeq: 1,
  }) });
  try {
    const st = c.st();
    assert.deepEqual(seqs(st.unread), [1, 2], 'legacy messages without timestamps are not inferred complete');
    assert.ok(!Number(st.unread[0].seenAt), 'messages are not marked seen on load');
    assert.ok(!Number(st.unread[0].repliedAt), 'messages are not marked replied on load');

    // /state 只读：未看过的消息不会被标成 seen，更不会被标成 replied。
    const state = await c.call('state');
    assert.equal(state.data.awaitingReplyCount, 0, 'never-seen legacy message must not be reported as seen');
    assert.equal(state.data.firstPendingSeq, 1);
    assert.equal(state.data.lastReadThroughSeq, 1, 'watermark keeps its legacy value without completing messages');
    assert.equal(state.data.pendingMessages[0].seenAt, null);
    assert.equal(state.data.pendingMessages[0].repliedAt, null);

    const view = await c.call('unread');
    assert.equal(view.data.awaitingReplyCount, 2, 'reading marks both messages seen, so both await JSON reply receipts');
    assert.equal(view.data.readThroughSeq, 2, 'the watermark advances only now that the message was seen');
    assert.deepEqual(seqs(view.data.messages), [1, 2]);
    assert.ok(view.data.messages.every((item) => item.seenAt > 0 && !Number(item.repliedAt)));
  } finally { await c.close(); }
});

// ── 5. mark_read(throughSeq) 不替代逐条 JSON 回复回执 ───────────────────────
await test('mark-read preserves seen messages until the JSON receipt reports replied', async () => {
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

    // 补读那条老消息之后，水位才能推进；mark-read 本身不能替代 JSON 回复回执。
    const full = await c.call('unread');
    assert.equal(full.data.readThroughSeq, 2);
    assert.ok(full.data.messages.every((m) => m.seenAt > 0));
    const marked = await c.call('mark-read', { body: { throughSeq: 2 } });
    assert.equal(marked.status, 200);
    assert.deepEqual(seqs(c.st().unread), [1, 2]);
    assert.ok(c.st().unread.every((m) => m.seenAt > 0 && !Number(m.repliedAt)));

    const sent = await c.call('/api/send/private', { body: { token: c.st().agentToken, userId: '123', message: 'reply to both' } });
    assert.equal(sent.status, 200);
    const report = await c.call('/api/socialV2/receipt-report', { body: { conversationId: KEY, receipts: [{ seq: 1, status: 'replied' }, { seq: 2, status: 'replied' }] } });
    assert.equal(report.status, 200, JSON.stringify(report.data));
    assert.deepEqual(seqs(c.st().unread), []);
    const saved = c.readSavedState().conversations[KEY];
    assert.deepEqual(seqs(saved.unread), []);
    assert.equal(saved.lastReadThroughSeq, 2);
  } finally { await c.close(); }
});

await test('a seen status report does not erase confirmed delivery evidence before replied is reported', async () => {
  const c = await open();
  try {
    c.append('read before reply');await c.call('unread');
    const sent=await c.call('/api/send/private',{body:{token:c.st().agentToken,userId:'123',message:'actual reply'}});
    assert.equal(sent.status,200);
    const seen=await c.call('receipt-report',{body:{receipts:[{seq:1,status:'seen'}]}});assert.equal(seen.status,200);
    assert.deepEqual(Array.from(c.st().receiptSendPendingSeqs),[1],'read confirmation must retain independent successful-send evidence');
    const replied=await c.call('receipt-report',{body:{receipts:[{seq:1,status:'replied'}]}});assert.equal(replied.status,200,JSON.stringify(replied.data));
  } finally { await c.close(); }
});

await test('an actual quoted send binds its precise incoming message before the seen callback catches up', async () => {
  const c = await open();
  try {
    c.append('arrived inside a running turn');
    for(const row of [...c.st().unread,...c.st().recentMessages])if(row.seq===1)row.messageId='123001';
    const sent=await c.call('send-message',{body:{messages:'reply with exact quote',replyToMessageId:'1'}});
    assert.equal(sent.status,200,JSON.stringify(sent.data));
    assert.deepEqual(Array.from(c.st().receiptSendPendingSeqs),[1],'quote records the successful target without forging a read stamp');
    assert.ok(!Number(c.st().unread[0].seenAt));assert.ok(!Number(c.st().unread[0].repliedAt));
    c.append('later unrelated message');await c.call('unread');
    const denied=await c.call('receipt-report',{body:{receipts:[{seq:2,status:'replied'}]}});assert.equal(denied.status,409);
    const replied=await c.call('receipt-report',{body:{receipts:[{seq:1,status:'replied'}]}});assert.equal(replied.status,200,JSON.stringify(replied.data));
    assert.deepEqual(seqs(c.st().unread),[2]);
  } finally { await c.close(); }
});

await test('preserving session renewal archives reviewed backlog but retains mood, pending arrivals and history',async()=>{
 const c=await open();try{
   c.append('reviewed historical record');await c.call('unread');c.append('fresh unreviewed arrival');
   const sid=await fixtureReplyTurn(c.h,KEY),st=c.st(),token=st.agentToken;st.mood=73;st.pendingReminder={id:'preserved-reminder'};
   const result=await c.call('/api/session/reset',{agent:false,body:{preserveState:true,freshContext:true,resolveSeqs:[1],reason:'管理员核对旧记录后归档，保留原始聊天'}});
   assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.previousSessionId,sid);assert.equal(result.data.preserved,true);
   assert.equal(c.st(),st);assert.equal(st.mood,73);assert.equal(st.pendingReminder.id,'preserved-reminder');assert.notEqual(st.agentToken,token);
   assert.deepEqual(seqs(st.unread),[2]);assert.equal(st.recentMessages.find(m=>m.seq===1).repliedAt,undefined);assert.ok(st.recentMessages.find(m=>m.seq===1).resolvedAt>0);
   assert.equal(c.h.state.sessions[KEY],undefined);
   assert.ok(st.modelContextSince>0);const reloaded=await open({savedState:c.readSavedState()});try{assert.equal(reloaded.st().modelContextSince,st.modelContextSince);assert.deepEqual(seqs(reloaded.st().unread),[2]);assert.ok(reloaded.st().recentMessages.find(m=>m.seq===1).resolvedAt>0);}finally{await reloaded.close();}
 }finally{await c.close();}
});
await test('preserving renewal refuses to close unread arrivals and leaves the current session intact',async()=>{
 const c=await open();try{c.append('not yet read');const sid=await fixtureReplyTurn(c.h,KEY),token=c.st().agentToken;
   const result=await c.call('/api/session/reset',{agent:false,body:{preserveState:true,resolveSeqs:[1],reason:'未读消息不应被关闭'}});
   assert.equal(result.status,409);assert.equal(c.h.state.sessions[KEY],sid);assert.equal(c.st().agentToken,token);assert.deepEqual(seqs(c.st().unread),[1]);
 }finally{await c.close();}
});

await test('real HTTP sends reject duplicate text for the same read batch, but admit a new human batch',async()=>{
 const c=await open();try{
   c.append('first hello');await c.call('unread');
   const sid=await fixtureReplyTurn(c.h,KEY),envelope=c.h.activeTurnEnvelopes.get(sid);envelope.replyPlan=Object.freeze({...envelope.replyPlan,maxMessages:10});
   const body={token:c.st().agentToken,userId:'123',message:'我在呀。',conversationIntent:'reply'};
   const first=await c.call('/api/send/private',{body});assert.equal(first.status,200,JSON.stringify(first.data));
   const duplicate=await c.call('/api/send/private',{body});assert.notEqual(duplicate.status,200);assert.match(duplicate.data.error,/duplicate_delivery/);
   c.append('another human hello');await c.call('unread');
   const next=await c.call('/api/send/private',{body});assert.equal(next.status,200,JSON.stringify(next.data));
 }finally{await c.close();}
});

console.log(failures ? `Read receipts regressions: ${tests - failures}/${tests} passed.` : `Read receipts bridge regressions: ${tests}/${tests} passed.`);
if (failures) process.exitCode = 1;
