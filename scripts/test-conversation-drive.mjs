import assert from 'node:assert/strict';
import test from 'node:test';
import { planConversationDrive } from '../src/conversation-drive.js';
import { createPlugin } from '../plugins/qq-components/ctx-chat-topic-drive/index.js';

test('eligible private and group turns defer the followup choice to the model', () => {
  for (const isGroup of [false, true]) {
    const plan = planConversationDrive({
      isGroup,
      now: 1_000_000,
      config: {},
      state: { unread: [{ plain: '我最近在学做面包', userId: '2' }], recentMessages: [] }
    });
    assert.equal(plan.kind, 'followup');
    assert.match(plan.line, /由你判断|你自己判断/);
  }
});

test('closing and explicit waiting never force followups or new topics in normal/proactive turns', () => {
  for (const text of ['晚安', '先这样', '等我一下，先别发了']) for (const proactive of [false, true]) {
    assert.equal(planConversationDrive({ now: 4_000_000, proactive, state: { unread: [{ text }], recentMessages: [] }, config: { newTopicProbability: 1 } }).kind, 'none');
  }
});
test('authorized proactive topic selection has no second lottery, cold ordinary turns cannot initiate', () => {
  const opts = { now: 4_000_000, state: {}, config: { newTopicProbability: 0, seeds: ['写作', '运动'] }, random: () => { throw Error('no lottery'); } };
  assert.equal(planConversationDrive(opts).kind, 'none');
  assert.equal(planConversationDrive({ ...opts, proactive: true }).kind, 'newTopic');
});
test('no unanswered question repeats; task clarification bypasses optional social cooldown', () => {
  const state = { unread: [{ text: '这个函数怎么写？', time: 200 }], recentMessages: [{ isSelf: true, text: '后来呢？', time: 300 }], driveFollowUpAt: 4_000_000, driveLastKind: 'followup' };
  assert.equal(planConversationDrive({ state, now: 4_000_001, proactive: true }).kind, 'none');
  assert.equal(planConversationDrive({ state, now: 4_000_001, needsClarification: true }).reason, 'clarification');
});
test('component prompt is read-only and actual-send semantic service owns cooldown per key', () => {
  let stored = {}; const ctx = { config: {}, state: { get: () => stored, set: p => { stored = { ...stored, ...p }; } }, registerTool() {}, capabilities: {} };
  const plugin = createPlugin(ctx), key = 'private:1';
  const payload = { key, reason: 'message', st: { unread: [{ text: '我开始写小说了', time: 100 }] }, patchSession() { throw Error('no bridge business writes'); } };
  assert.match(plugin.hooks.beforePrompt(payload), /追问/); assert.deepEqual(stored, {});
  assert.equal(typeof plugin.services?.conversationDrive?.sent, 'function');
  plugin.services.conversationDrive.sent({ key, success: false, eventId: 'x', kind: 'followup', at: 200 }); assert.deepEqual(stored, {});
  plugin.services.conversationDrive.sent({ key, success: true, eventId: 'x', kind: 'followup', at: Date.now(), text: '写到哪里啦？' });
  assert.equal(plugin.hooks.beforePrompt(payload), '');
  assert.match(plugin.hooks.beforePrompt({ ...payload, key: 'group:1' }), /追问/);
});
test('new topic semantics also apply inside normal replies without granting cold outbound permission', () => {
  const plan = planConversationDrive({ now: 4_000_000, topicIntent: 'newTopic', state: { unread: [{ text: '今天总算把报告写完了', time: 100 }] }, config: { seeds: ['周末计划'] } });
  assert.equal(plan.kind, 'newTopic'); assert.equal(plan.topicId, '周末计划');
});
test('topic selector avoids repeating actual sent topic and injected selection stays deterministic', () => {
  const plan = planConversationDrive({ proactive: true, now: 4_000_000, selectTopic: pool => pool.at(-1), state: { lastTopicId: '写作' }, config: { seeds: ['写作', '运动'] } });
  assert.equal(plan.topicId, '运动');
});
test('multipart semantic receipts count one topic while recording later actual question', () => {
  let state = {}; const plugin = createPlugin({ config: {}, state: { get: () => state, set: p => { state = { ...state, ...p }; } }, registerTool() {}, capabilities: {} });
  const sent = plugin.services.conversationDrive.sent;
  sent({ key: 'private:1', success: true, episodeId: 'e', eventId: 'one', kind: 'newTopic', topicId: '运动', at: 100, text: '今天想到散步' });
  sent({ key: 'private:1', success: true, episodeId: 'e', eventId: 'two', at: 200, text: '你呢？' });
  sent({ key: 'private:1', success: true, episodeId: 'e', eventId: 'two', at: 200, text: '你呢？' });
  assert.equal(state.driveByKey['private:1'].driveCount, 1); assert.equal(state.driveByKey['private:1'].lastQuestionAt, 200);
});
test('followup then new topic in one episode preserves both cooldowns and spends topic quota once', () => {
  let state = {}; const plugin = createPlugin({ config: {}, state: { get: () => state, set: p => { state = { ...state, ...p }; } }, registerTool() {}, capabilities: {} });
  const sent = plugin.services.conversationDrive.sent, key = 'private:2';
  sent({ key, success: true, episodeId: 'e', eventId: 'first', kind: 'followup', at: 100, text: '报告写完了吗？' });
  sent({ key, success: true, episodeId: 'e', eventId: 'second', kind: 'newTopic', topicId: '周末散步', at: 200, text: '周末想出去走走吗？' });
  sent({ key, success: true, episodeId: 'e', eventId: 'third', kind: 'newTopic', topicId: '周末散步', at: 300, text: '一起去哪里呢？' });
  const drive = state.driveByKey[key];
  assert.equal(drive.driveCount, 1); assert.equal(drive.driveFollowUpAt, 100);
  assert.equal(drive.driveNewTopicAt, 200); assert.deepEqual(drive.driveNewTopicTimes, [200]);
  assert.equal(drive.lastTopicId, '周末散步'); assert.equal(drive.lastQuestionAt, 300);
});
test('ordinary followup cannot invite a new topic through disabled, cooldown or hourly gates', () => {
  const now = 4_000_000, unread = [{ text: '今天报告写到一半了', time: 100 }];
  const cases = [
    { config: { newTopicMaxPerHour: 0 }, state: { unread } },
    { config: {}, state: { unread, driveNewTopicAt: now - 10 * 60000 } },
    { config: { newTopicMaxPerHour: 2 }, state: { unread, driveNewTopicTimes: [now - 2 * 60000, now - 60000] } }
  ];
  for (const item of cases) {
    const normal = planConversationDrive({ now, ...item });
    assert.equal(normal.kind, 'followup'); assert.doesNotMatch(normal.line, /新话题|换题/);
    assert.equal(planConversationDrive({ now, topicIntent: 'newTopic', ...item }).kind, 'none');
    assert.equal(planConversationDrive({ now, needsClarification: true, ...item }).reason, 'clarification');
  }
  const allowed = planConversationDrive({ now, state: { unread, driveNewTopicAt: now - 45 * 60000, driveNewTopicTimes: [now - 3600000] } });
  assert.match(allowed.line, /新话题/);
});
