import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopicActions } from '../plugins/qq-components/ctx-chat-topic-drive/topic-actions.mjs';
import { createOutboundTransport } from '../src/outbound-context.js';
import { engagementFactors } from '../plugins/qq-components/ctx-chat-reply-shape/engagement.mjs';
import { effectiveProactiveStage, normalizeProactivePolicy } from '../plugins/qq-components/life-wake-reasons/proactive-policy.mjs';
import { createPlugin as createWait } from '../plugins/qq-components/life-conversation-wait/index.js';
test('terminal wait revokes the previous topic permission and its nonterminal guidance', () => {
  const data = {}, state = { get: () => data, set: p => Object.assign(data, p) };
  const actions = createTopicActions({ state });
  const waitState = {}, wait = createWait({ state: { get: () => waitState, set: p => Object.assign(waitState, p) },
    config: { endProbabilityPercent: 0, probabilityStepPercent: 25 }, callService: (_, method, payload) => actions[method]?.(payload) });
  const args = { key: 'private:1', scope: 's:1', seq: 0, startSeq: 0 };
  let rolls = [.9, .6];
  assert.equal(wait.services.waitCycle.timeout({ ...args, random: () => rolls.shift() }).action, 'newTopic');
  const lease = actions.reserve({ ...args, operationId: 'old-permission', text: '新话题' });
  const ended = wait.services.waitCycle.timeout({ ...args, random: () => 0 });
  assert.equal(ended.endRound, true);
  assert.doesNotMatch(ended.guidance || '', /本轮不结束/);
  assert.equal(actions.authorize({ key: args.key, lease }).ok, false);
  assert.equal(actions.reserve({ ...args, operationId: 'after-end', text: '再追问' }).ok, false);
});
test('same-topic cooldown does not block a different identified topic', () => {
  const key = 'private:1', now = 10000000;
  const state = { driveByKey: { [key]: { driveFollowUpAt: now - 1000, followupByTopic: { music: now - 1000 } } } };
  const actions = createTopicActions({ state: { get: () => state, set: patch => Object.assign(state, patch) } });
  assert.equal(actions.reserve({ key, operationId: 'a', kind: 'followup', topicId: 'music', now }).ok, false);
  assert.equal(actions.reserve({ key, operationId: 'b', kind: 'followup', topicId: 'walk', now }).ok, true);
});
test('oversized rejected topic message releases its lease without a send', async () => {
  const data = {}, key = 'group:1', actions = createTopicActions({ state: { get: () => data, set: patch => Object.assign(data, patch) } });
  const call = (s, m, p) => s === 'conversationDrive' ? actions[m]?.(p) : null;
  const transport = createOutboundTransport({ callService: call });
  await assert.rejects(transport.perform({ key, context: { conversationIntent: 'newTopic', plan: { maxMessageChars: 2 } }, text: '超过两个字', send: () => { throw Error('must not send'); } }), /message_length/);
  assert.deepEqual(data.topicLeases, {});
});
test('both scores still scale proactive probability at the maximum silence stage', () => {
  const policy = normalizeProactivePolicy({}), mood = { score: 0 }, w = 0;
  const result = effectiveProactiveStage(policy, 100, w, mood);
  assert.ok(Math.abs(result.effectiveProbability - policy.probabilityMax * engagementFactors(mood, w).factor) < 1e-10);
  assert.ok(result.effectiveProbability < effectiveProactiveStage(policy, 100, 100, mood).effectiveProbability);
  assert.ok(result.effectiveProbability < effectiveProactiveStage(policy, 100, 0, { score: 100 }).effectiveProbability);
});
