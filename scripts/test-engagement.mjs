import test from 'node:test';
import assert from 'node:assert/strict';
import { planReplyShape } from '../src/reply-shape.js';
import { createProactive } from '../plugins/qq-components/life-wake-reasons/proactive.mjs';
test('shared engagement formula multiplies subjective mood and objective availability', async () => {
  const { engagementFactors } = await import('../plugins/qq-components/ctx-chat-reply-shape/engagement.mjs');
  const f = engagementFactors({ score: 60 }, 60);
  assert.ok(Math.abs(f.factor - .4624) < 1e-10);
  assert.equal(engagementFactors({ enabled: false, score: 0 }, 100).factor, 1);
});
test('availability changes reply count and depth, never the mood style', () => {
  const mood = { score: 100, replyCeiling: 3, styleInstruction: '温柔活泼' };
  const free = planReplyShape({ key: 'private:1', incomingText: '哈哈', mood, willingness: 100 });
  const busy = planReplyShape({ key: 'private:1', incomingText: '哈哈', mood, willingness: 0 });
  assert.ok(free.maxMessages > busy.maxMessages);
  assert.notEqual(free.detailLevel, busy.detailLevel);
  assert.equal(free.styleInstruction, busy.styleInstruction);
  assert.equal(busy.styleInstruction, '温柔活泼');
});
test('objective availability changes only with a reasoned assessment, never our own sends or unanswered waits', () => {
  let state = {};
  const service = createProactive({ config: { curfewEnabled: false, initialWillingness: 60, purposeWillingnessDelta: -50, activityWillingnessDelta: 50 }, state: { get: () => state, set: p => Object.assign(state, p) } });
  assert.equal(service.setWillingness({ key: 'private:1', value: 20, reason: '用户明确说正在开会', now: 1000 }).ok, true);
  service.observe({ key: 'private:1', kind: 'sent', reason: 'privateFollowup', success: true, eventId: 'a', episodeId: 'a', at: 2000, isProactive: true });
  service.observe({ key: 'private:1', kind: 'incoming', hasText: true, eventId: 'b', at: 3000 });
  assert.equal(service.availability({ key: 'private:1' }).willingness, 20);
  assert.equal(service.setWillingness({ key: 'private:1', value: 100, reason: '' }).ok, false);
});
