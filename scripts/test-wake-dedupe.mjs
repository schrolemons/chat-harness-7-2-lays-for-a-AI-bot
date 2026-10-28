// 唤醒排队去重 + 补话计时/去重回归：node scripts/test-wake-dedupe.mjs
//
// 验收口径：
//   ① 双戳（seenAt/repliedAt）照常每条都打，没回的消息依旧是未读，去重不得吞消息；
//   ② 只对「唤醒投递」去重：同一会话排队多个唤醒时只保留最新一条，不因此产生多条补话；
//   ③ 两组延迟从最新完整入站消息起算；合并、繁忙和新 prompt 接受不影响计时；
//   ④ 同一批消息可以先后冒两句话术：「正在认真想」之后再过几秒「抱歉让大家等」；
//      道歉以「到点仍没有任何出站」为前提，中间我回了就取消；
//   ⑤ 不等待新 prompt；不进入回复流程的额度/静音/模式拦截仍不发送补话。
//
// 用 bridgeHarness：真实 bridge 逻辑 + 临时状态 + 桩网关，不碰真实 QQ / DSH / state。
// 真实补话延迟太长（等待 5000ms / 道歉 8300ms），测试里把 messageAck.plan 桩成 60/1200ms，
// 合并窗口桩成 40ms，再用 pluginHost.tick(now) 手动推进调度时钟，从而能确定性地断言时序。
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const KEY = 'private:123';
const GROUP_KEY = 'group:456';
const CONFIG = { socialV2: {
  wake: { preSleepWaitEnabled: false },
  proactive: { enabled: false },
  sticker: { enabled: false },
  readReceipt: { enabled: true, ackPrivate: true, ackGroup: true },
} };

let tests = 0;
let failures = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seqs = (list) => Array.from(list ?? [], (m) => m.seq);
const ackSends = (h, kind = 'private') => h.calls.sent.filter((m) => m.kind === kind && /^ACK-/.test(String(m.text)));

async function test(name, run) {
  tests += 1;
  try { await run(); console.log('PASS', name); }
  catch (error) { failures += 1; console.error('FAIL', name, error.stack); }
}

async function open() {
  const h = await bridgeHarness({ config: CONFIG });
  h.setMode('reserved2');
  // 巡检类插件在 pluginHost.tick() 时会真的发 QQ 告警（一次正常出站会取消挂着的补话，
  // 把计时断言搅乱），测试里统一关掉它们。只关「会主动说话」的，唤醒链路的组件保持开启。
  for (const id of [
    'obs-health-monitor', 'obs-bridge-health', 'obs-self-review',
    'life-campus-watch', 'life-daily-worklog', 'eval-regression',
  ]) {
    h.pluginHost.setEnabled(id, false);
  }
  return h;
}

function append(h, text, key = KEY) {
  const st = h.getSocialV2State(key);
  const id = `fixture-${st.lastUnreadSeq + 1}`;
  h.appendSocialV2Message(key, 'fixture-person', text, text, false, false, id, [], '789', []);
  return h.getSocialV2State(key).lastUnreadSeq;
}

// 模拟「AI 正在生成」：isConversationBusyV2 会因此判忙，唤醒只能进排队。
function forceBusy(h) { h.promptQueues.set(KEY, { running: true, queue: [] }); }

async function waitFor(check, budgetMs = 3000, stepMs = 20) {
  for (let waited = 0; waited < budgetMs; waited += stepMs) {
    if (check()) return true;
    await sleep(stepMs);
  }
  return check();
}

// ── 1. 繁忙期间连发：唤醒只留最新一条，未读/双戳一条不动 ────────────────────
await test('繁忙期间连发三条：排队唤醒只留一条（seq 最新），未读与双戳不受影响', async () => {
  const h = await open();
  try {
    const st = h.getSocialV2State(KEY);
    forceBusy(h);
    const appended = [];
    for (const text of ['第一条', '第二条', '第三条']) {
      appended.push(append(h, text));
      h.scheduleWakeV2(KEY, 'private');
    }
    assert.deepEqual(seqs(st.unread), appended, '去重只作用于唤醒投递：未读缓冲必须保留每一条消息');
    assert.equal(
      st.pendingWakeReasons.length, 1,
      `排队里只应剩一条消息类唤醒，实际：${JSON.stringify(st.pendingWakeReasons)}`
    );
    assert.equal(st.pendingWakeReasons[0].seq, appended.at(-1), '保留的必须是最后一条（seq 最新）');
    assert.ok(
      st.unread.every((m) => !Number(m.seenAt) && !Number(m.repliedAt)),
      '去重不得替消息抢打 seenAt/repliedAt（双戳只能由读/回触发）'
    );
  } finally { h.cancelMessageReadAck(KEY); await h.close(); }
});

// ── 2. 定时器/事件类唤醒不参与合并，一条都不能少 ────────────────────────────
await test('定时器类唤醒不与消息类合并：timeout 仍然单独排队', async () => {
  const h = await open();
  try {
    const st = h.getSocialV2State(KEY);
    forceBusy(h);
    append(h, '连发一'); h.scheduleWakeV2(KEY, 'private');
    append(h, '连发二'); h.scheduleWakeV2(KEY, 'private');
    append(h, '连发三'); h.scheduleWakeV2(KEY, 'private');
    h.scheduleWakeV2(KEY, 'timeout');
    const reasons = Array.from(st.pendingWakeReasons, (item) => item.reason).sort();
    assert.deepEqual(
      reasons, ['private', 'timeout'],
      `应保留「一条消息类 + 一条定时器」，实际：${JSON.stringify(st.pendingWakeReasons)}`
    );
  } finally { h.cancelMessageReadAck(KEY); await h.close(); }
});

// ── 3. 繁忙结束后的重放：多条排队只换一次唤醒投递 ──────────────────────────
await test('繁忙结束后重放：三条消息只投递一次唤醒，不会各跑一轮', async () => {
  const h = await open();
  try {
    forceBusy(h);
    for (const text of ['a', 'b', 'c']) { append(h, text); h.scheduleWakeV2(KEY, 'private'); }
    h.promptQueues.delete(KEY);
    const before = h.calls.prompts.length;
    const first = h.replayPendingWakeReasonsV2(KEY);
    assert.equal(first?.action, 'replayed', '应补发一次唤醒');
    assert.equal(h.replayPendingWakeReasonsV2(KEY), null, '队列应已清空，不得再各补一轮');
    await h.pluginHost.tick(Date.now() + 5000); // 手动推进调度时钟，触发合并窗口后的投递
    const delivered = await waitFor(() => h.calls.prompts.length > before);
    assert.ok(delivered, '合并窗口结束后应投递一次唤醒');
    assert.equal(
      h.calls.prompts.length - before, 1,
      `三条消息只该换一次唤醒，实际投递 ${h.calls.prompts.length - before} 次`
    );
  } finally { h.cancelMessageReadAck(KEY); await h.close(); }
});

// ── 4. 旧状态里堆了多条消息类条目：重放时同样只算最新一条 ──────────────────
await test('旧状态堆了多条消息类条目：重放合并为一轮，只保留最新 seq', async () => {
  const h = await open();
  try {
    const st = h.getSocialV2State(KEY);
    const s1 = append(h, '旧一');
    const s2 = append(h, '旧二');
    const s3 = append(h, '旧三');
    st.pendingWakeReasons = [
      { reason: 'keyword', seq: s1 },
      { reason: 'private', seq: s2 },
      { reason: 'private', seq: s3 },
    ];
    const before = h.calls.prompts.length;
    const first = h.replayPendingWakeReasonsV2(KEY);
    assert.equal(first?.action, 'replayed');
    assert.equal(st.pendingWakeReasons.length, 0, '三条消息类条目必须合并成一次投递');
    assert.equal(h.replayPendingWakeReasonsV2(KEY), null);
    await h.pluginHost.tick(Date.now() + 5000);
    const delivered = await waitFor(() => h.calls.prompts.length > before);
    assert.ok(delivered);
    assert.equal(h.calls.prompts.length - before, 1);
  } finally { h.cancelMessageReadAck(KEY); await h.close(); }
});

// ── 5. 硬验收（一批两句话术）：先「等待」，几秒后「道歉」；中间有出站则不道歉 ──
//
// 新口径（机主确认）：同一批消息可以先后冒两句补话 ——「正在认真想」之后再过几秒
// 「抱歉让大家等」；但道歉必须以「到点仍没有任何出站」为前提，中间我回了就取消。
// 布点跟随最新完整用户消息，不依赖新的唤醒是否被接受；额度等回复禁令仍须遵守。
//
// 为可断言，把 messageAck.plan 桩成 wait=60ms / apology=1200ms，合并窗口桩成 40ms，
// 用 pluginHost.tick(now) 手动推进调度时钟。
function stubAckPlan(h) {
  const originalCall = h.pluginHost.callService.bind(h.pluginHost);
  h.pluginHost.callService = (name, method, args) => (name === 'messageAck' && method === 'plan')
    ? {
      wait: { enabled: true, delayMs: 60, text: 'ACK-WAIT' },
      apology: { enabled: true, delayMs: 1200, text: 'ACK-APOLOGY' },
    }
    : originalCall(name, method, args);
  return () => { h.pluginHost.callService = originalCall; };
}

// 真实入站调度路径立即布点；新唤醒仍可合并和排队，两者互不依赖。
async function armThroughWake(h, { trigger = 'private', key = KEY } = {}) {
  const st = h.getSocialV2State(key);
  st.wakeConfig.batchWindowMs = 40;
  append(h, '需要认真回答的一条消息', key);
  const at = h.noteMessageAckInbound(key, Date.now());
  h.scheduleWakeV2(key, trigger, at);
  assert.ok(h.messageAckArmed.get(key), '最新入站消息应立即布置两组计时器');
  return at;
}

// 推进调度时钟到现在（调度器按 at <= now 触发）。
const tickNow = (h) => h.pluginHost.tick(Date.now() + 10);

await test('一批消息：先冒「正在认真想」，再冒「抱歉让大家等」（两句都在，顺序正确）', async () => {
  const h = await open();
  try {
    const st = h.getSocialV2State(KEY);
    const restore = stubAckPlan(h);
    try {
      await armThroughWake(h);

      // ① 收到最新消息就布点，两组定时器都在调度器里。
      const types = Array.from(h.pluginHost.callService('scheduler', 'status').types);
      assert.ok(
        types.includes('message-ack-wait') && types.includes('message-ack-apology'),
        `最新入站消息应同时布下等待/道歉两个定时器，实际：${JSON.stringify(types)}`
      );

      // ② 等待组到点：只冒第一句，道歉组的定时器不许被清掉。
      await sleep(200);
      await tickNow(h);
      const first = await waitFor(() => ackSends(h).length >= 1);
      assert.ok(first, '越过等待组延迟后应冒第一句');
      assert.equal(ackSends(h)[0].text, 'ACK-WAIT');
      const afterWait = Array.from(h.pluginHost.callService('scheduler', 'status').types);
      assert.ok(
        afterWait.includes('message-ack-apology'),
        `第一句发出后道歉组必须仍在排队，实际：${JSON.stringify(afterWait)}`
      );

      // ③ 道歉组到点：这批消息之后仍无任何出站 ⇒ 第二句照发。
      await sleep(1400);
      await tickNow(h);
      const second = await waitFor(() => ackSends(h).length >= 2);
      assert.ok(second, `越过道歉组延迟后应冒第二句，实际：${JSON.stringify(ackSends(h))}`);
      assert.deepEqual(ackSends(h).map((m) => m.text), ['ACK-WAIT', 'ACK-APOLOGY']);
      // 补话发出后 sendToQQ 还有打字间隔（sendDelayMs），等它落地再断言账本清空。
      assert.ok(
        await waitFor(() => h.messageAckArmed.get(KEY) === undefined, 3000),
        '两句都落地后补话账本必须清空'
      );
      assert.ok(
        st.unread.every((m) => !Number(m.repliedAt)),
        '补话不算回复：不得给未读消息盖 repliedAt'
      );
    } finally { restore(); }
  } finally { h.cancelMessageReadAck(KEY); await h.close(); }
});

await test('群聊同一批：也是先「正在认真想」再「抱歉让大家等」（与私聊同理）', async () => {
  const h = await open();
  try {
    const restore = stubAckPlan(h);
    try {
      await armThroughWake(h, { trigger: 'atMention', key: GROUP_KEY });

      await sleep(200);
      await tickNow(h);
      assert.ok(await waitFor(() => ackSends(h, 'group').length >= 1), '群聊应先冒「正在认真想」');
      assert.equal(ackSends(h, 'group')[0].text, 'ACK-WAIT');
      assert.ok(
        Array.from(h.pluginHost.callService('scheduler', 'status').types).includes('message-ack-apology'),
        '群聊第一句发出后道歉组必须仍在排队'
      );

      await sleep(1400);
      await tickNow(h);
      assert.ok(await waitFor(() => ackSends(h, 'group').length >= 2), '群聊应再冒「抱歉让大家等」');
      assert.deepEqual(ackSends(h, 'group').map((m) => m.text), ['ACK-WAIT', 'ACK-APOLOGY']);
      assert.equal(ackSends(h, 'private').length, 0, '群聊补话不得串到私聊通道');
    } finally { restore(); }
  } finally { h.cancelMessageReadAck(GROUP_KEY); await h.close(); }
});

await test('连发多条只按最新消息计时：先等待再道歉，不依赖唤醒接受且不会每条各冒一轮', async () => {
  const h = await open();
  try {
    const st = h.getSocialV2State(KEY);
    st.wakeConfig.batchWindowMs = 40;
    const restore = stubAckPlan(h);
    try {
      let lastAt = 0;
      for (let i = 0; i < 6; i += 1) {
        append(h, `连发${i}`);
        lastAt = h.noteMessageAckInbound(KEY, Date.now());
        h.scheduleWakeV2(KEY, 'private', lastAt);
        await sleep(15); // 间隔 15ms < 合并窗口 40ms
      }
      assert.equal(seqs(st.unread).length, 6, '六条消息都应是未读');

      // ① 连发期间（唤醒还没被接受）：一条话术都不许冒。
      await h.pluginHost.tick(Date.now() + 10);
      await sleep(100);
      assert.equal(ackSends(h).length, 0, `连发期间不得冒话术，实际：${JSON.stringify(ackSends(h))}`);

      // 按最新完整消息计时，不能等待新的唤醒被接受。
      assert.ok(h.messageAckArmed.get(KEY));
      await sleep(100);
      await tickNow(h);
      assert.ok(await waitFor(() => ackSends(h).length >= 1), '停手后应冒一句「正在认真想」');
      assert.equal(ackSends(h).length, 1, `六条连发只该有一句等待，实际：${JSON.stringify(ackSends(h))}`);
      assert.equal(ackSends(h)[0].text, 'ACK-WAIT');

      await sleep(1400);
      await h.pluginHost.tick(Date.now() + 10);
      assert.ok(await waitFor(() => ackSends(h).length >= 2), '随后应再冒一句「抱歉让大家等」');
      assert.deepEqual(ackSends(h).map((m) => m.text), ['ACK-WAIT', 'ACK-APOLOGY']);
      assert.ok(
        st.unread.every((m) => !Number(m.repliedAt)),
        '补话不算回复：不得给未读消息盖 repliedAt'
      );
    } finally { restore(); }
  } finally { h.cancelMessageReadAck(KEY); await h.close(); }
});

await test('真实组件配置（等待 8000ms / 道歉 8300ms）两句都能落地：发送链不会误杀道歉', async () => {
  const h = await open();
  try {
    // 不桩 messageAck.plan：用 life-message-ack 自己的配置（测试环境无 state 覆盖，取组件默认）。
    const st = h.getSocialV2State(KEY);
    st.wakeConfig.batchWindowMs = 40;
    await armThroughWake(h);
    const realSends = () => h.calls.sent.filter((m) => m.kind === 'private');

    await sleep(8300); // 越过等待组 8000ms
    await tickNow(h);
    assert.ok(await waitFor(() => realSends().length >= 1, 5000), '等待组应按配置的 delayMs 发出');
    await sleep(1200); // 道歉组 8300ms 已到点（第一句的发送链还在 sendDelayMs 里）
    await tickNow(h);
    assert.ok(
      await waitFor(() => realSends().length >= 2, 5000),
      `道歉组不应被等待组的发送链误杀，实际发送：${JSON.stringify(realSends().map((m) => m.text))}`
    );
  } finally { h.cancelMessageReadAck(KEY); await h.close(); }
});

await test('补话期间我有真实出站：道歉不再发（道歉以「到点仍无出站」为前置）', async () => {
  const h = await open();
  try {
    const restore = stubAckPlan(h);
    try {
      await armThroughWake(h);

      await sleep(200);
      await tickNow(h);
      assert.ok(await waitFor(() => ackSends(h).length >= 1), '应先冒「正在认真想」');
      assert.equal(ackSends(h)[0].text, 'ACK-WAIT');

      // 我在道歉到点之前真的回了一句：任何正常出站都必须把整批补话摘掉。
      await h.sendToQQ(KEY, '真实回复：我想好了');

      await sleep(1400);
      await tickNow(h);
      await sleep(200);
      assert.deepEqual(
        ackSends(h).map((m) => m.text), ['ACK-WAIT'],
        `已经有出站就不得再补道歉，实际：${JSON.stringify(ackSends(h))}`
      );
      assert.equal(h.messageAckArmed.get(KEY), undefined, '出站后补话账本必须清空');
      assert.equal(
        Array.from(h.pluginHost.callService('scheduler', 'status').types).some((t) => String(t).startsWith('message-ack')),
        false,
        '出站后不得残留补话定时器'
      );
    } finally { restore(); }
  } finally { h.cancelMessageReadAck(KEY); await h.close(); }
});

await test('唤醒被额度闸门跳过：一条补话都不许冒（先说了等我一下然后消失）', async () => {
  const h = await open();
  try {
    const st = h.getSocialV2State(KEY);
    st.wakeConfig.batchWindowMs = 40;
    stubAckPlan(h);
    const originalCall = h.pluginHost.callService.bind(h.pluginHost);
    h.pluginHost.callService = (name, method, args) => (
      name === 'tokenBudget' && method === 'canDispatch' ? false : originalCall(name, method, args)
    );

    append(h, '额度已经用完时进来的一条消息');
    const at = h.noteMessageAckInbound(KEY, Date.now());
    h.scheduleWakeV2(KEY, 'private', at);

    const promptsBefore = h.calls.prompts.length;
    await sleep(1200);
    await tickNow(h);
    await sleep(150);
    assert.equal(h.calls.prompts.length, promptsBefore, '额度闸门跳过时唤醒提示词不应被投递');

    // 额度禁止回复时不布补话：推很久也不许冒话术。
    await sleep(1500);
    await tickNow(h);
    await sleep(300);
    assert.equal(ackSends(h).length, 0, `唤醒被跳过时不得补话，实际：${JSON.stringify(ackSends(h))}`);
    assert.equal(h.messageAckArmed.get(KEY), undefined, '被跳过的唤醒不得留下补话账本');
    assert.equal(
      Array.from(h.pluginHost.callService('scheduler', 'status').types).some((t) => String(t).startsWith('message-ack')),
      false,
      '被跳过的唤醒不得留下补话定时器'
    );
  } finally { h.cancelMessageReadAck(KEY); await h.close(); }
});

console.log(failures
  ? `Wake dedupe regressions: ${tests - failures}/${tests} passed.`
  : `Wake dedupe regressions: ${tests}/${tests} passed.`);
if (failures) process.exitCode = 1;
