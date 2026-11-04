import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin as createTopics } from '../plugins/qq-components/ctx-chat-topic-drive/index.js';
import { createPlugin as createWait } from '../plugins/qq-components/life-conversation-wait/index.js';
import { createProactive } from '../plugins/qq-components/life-wake-reasons/proactive.mjs';
import { createOutboundTransport } from '../src/outbound-context.js';
const memory = initial => { let data = initial || {}; return { get: () => data, set: patch => Object.assign(data, patch) }; };
function fixture() {
  const key = 'private:1', now = 10000000, topicState = memory(), proactiveState = memory({ proactiveByKey: { [key]: { stage: 3, willingness: 60, source: 'ai', availabilityVersion: 1, phase: 'scheduled', nextAt: now + 1000 } } });
  const proactive = createProactive({ config: { curfewEnabled: false }, state: proactiveState });
  const services = { proactive, mood: { sent() {} }, replyPlan: { reserve: () => ({ ok: true, waitMs: 0 }), authorize: () => ({ok:true}), commit() {}, release() {}, resolve: () => ({ maxMessageChars: 500 }) } };
  const call = (service, method, payload) => services[service]?.[method]?.(payload) ?? null;
  const topics = createTopics({ config: {}, state: topicState, capabilities: {}, callService: call, registerTool() {}, log() {}, warn() {} });
  services.conversationDrive = topics.services.conversationDrive;
  const wait = createWait({ config: { endProbabilityPercent: 0, probabilityStepPercent: 25 }, state: memory(), callService: call });
  const transport = createOutboundTransport({ callService: call, clock: () => now, sleep: async () => {}, guard: () => () => {} });
  return { key, now, topicState, proactiveState, topics, proactive, wait, transport };
}
test('wait-cycle asks for an action only after no-end and exposes the configured weighted branch', () => {
  const f = fixture(); let rolls = [.9, .6];
  const v = f.wait.services.waitCycle.timeout({ key: f.key, scope: 'sid:1', seq: 0, startSeq: 0, random: () => rolls.shift() });
  assert.equal(v.endRound, false); assert.equal(v.action, 'newTopic');
  assert.equal(f.topics.services.conversationDrive.afterWait({ key: f.key, scope: 'sid:1', seq: 0, emptyWaits: 1, endRound: false, random: () => .99 }).action, 'newTopic');
});
test('successful topic wave counts once as proactive, resets stage, preserves objective willingness', async () => {
  const f = fixture(), plan = { maxMessageChars: 500 };
  const context = { key: f.key, actionId: 'wave', envelope: { sessionId: 'sid', turn: 1 }, origin: 'conversation', reason: 'message', plan, conversationIntent: 'newTopic', topicId: 'music' };
  for (const n of [1, 2]) await f.transport.perform({ key: f.key, context, text: '聊聊最近听的音乐' + n, send: async () => ({ data: { message_id: n } }) });
  const p = f.proactiveState.get().proactiveByKey[f.key], d = f.topicState.get().driveByKey[f.key];
  assert.equal(p.stage, 0); assert.equal(p.lastProactiveAt, f.now); assert.equal(p.activeConversationCount, 1);
  assert.equal(p.willingness, 60, 'our own send is not evidence the human is busy');
  assert.equal(d.driveNewTopicTimes.length, 1);
});
test('failed sends do not consume topic or proactive counts; cooldown blocks actual optional sends', async () => {
  const f = fixture(), context = { key: f.key, actionId: 'wave', envelope: { sessionId: 'sid', turn: 1 }, origin: 'conversation', reason: 'message', plan: { maxMessageChars: 500 }, conversationIntent: 'newTopic' };
  await assert.rejects(f.transport.perform({ key: f.key, context, text: '新话题', send: async () => { const e = Error('failed'); e.knownFailed = true; throw e; } }));
  assert.equal(f.topicState.get().driveByKey?.[f.key]?.driveNewTopicTimes?.length || 0, 0);
  assert.equal(f.proactiveState.get().proactiveByKey[f.key].activeConversationCount || 0, 0);
  f.topicState.set({ driveByKey: { [f.key]: { driveNewTopicAt: f.now - 1000 } } });
  let sent = false;
  await assert.rejects(f.transport.perform({ key: f.key, context, text: '再次换话题', send: async () => { sent = true; return {}; } }));
  assert.equal(sent, false);
});

test('reminders bypass chat-topic cooldown and do not draw or count a new topic',async()=>{
  for (const reason of ['reminder','milkStock','scheduledContact:scheduled-id','notification','taskDone']) {
    const f=fixture();
    f.topicState.set({driveByKey:{[f.key]:{driveNewTopicAt:f.now-1000,driveNewTopicTimes:[f.now-1000]}}});
    const drive=f.topics.services.conversationDrive;
    const choice=drive.afterWait({key:f.key,scope:'sid:1',seq:0,emptyWaits:1,endRound:false,originReason:reason,random:()=>assert.fail('reminder entered chat draw')});
    assert.equal(choice.action,'wait');
    const context={key:f.key,sourceKey:f.key,actionId:'notice',envelope:{sessionId:'sid',turn:1},origin:'purpose',reason,plan:{maxMessageChars:500},conversationIntent:'newTopic'};
    let writes=0;
    await f.transport.perform({key:f.key,context,text:'到点了，记得休息好吗？',send:async()=>{writes++;return {};}});
    assert.equal(writes,1);
    assert.deepEqual(f.topicState.get().driveByKey[f.key].driveNewTopicTimes,[f.now-1000]);
    assert.equal(f.topicState.get().driveByKey[f.key].driveFollowUpAt,undefined);
  }
});
