import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveFollowupLimits, isFollowupAllowed } from './followup-policy.mjs';

test('session followup controls cannot exceed global interval or daily cap', () => {
  assert.deepEqual(effectiveFollowupLimits(
    { minIntervalMinutes: 120, dailyLimit: 3 },
    { minIntervalMinutes: 240, dailyLimit: 1 }
  ), { minIntervalMinutes: 240, dailyLimit: 1 });
});

test('shorter session interval cannot relax the global followup wait', () => {
  const limits = effectiveFollowupLimits({ minIntervalMinutes: 240, dailyLimit: 3 }, { minIntervalMinutes: 5, dailyLimit: 9 });
  assert.equal(isFollowupAllowed({ limits, lastSentAt: 1000, sentToday: 0, now: 1000 + 10 * 60000 }), false);
  assert.deepEqual(limits, { minIntervalMinutes: 240, dailyLimit: 3 });
});

test('followup policy blocks when either effective interval or daily limit is reached', () => {
  const limits = effectiveFollowupLimits({ minIntervalMinutes: 60, dailyLimit: 2 }, {});
  assert.equal(isFollowupAllowed({ limits, lastSentAt: 1000, sentToday: 1, now: 1000 + 59 * 60000 }), false);
  assert.equal(isFollowupAllowed({ limits, lastSentAt: 0, sentToday: 2, now: 1000 }), false);
  assert.equal(isFollowupAllowed({ limits, lastSentAt: 1000, sentToday: 1, now: 1000 + 60 * 60000 }), true);
});

test('a zero daily cap disables private followups', () => {
  const limits = effectiveFollowupLimits({ minIntervalMinutes: 0, dailyLimit: 0 }, { dailyLimit: 3 });
  assert.equal(limits.dailyLimit, 0);
  assert.equal(isFollowupAllowed({ limits, lastSentAt: 0, sentToday: 0, now: 1000 }), false);
});
