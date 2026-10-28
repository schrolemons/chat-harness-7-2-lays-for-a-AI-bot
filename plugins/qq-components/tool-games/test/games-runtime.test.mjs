import test from 'node:test';
import assert from 'node:assert/strict';
import { createGamesRuntime } from '../games-runtime.mjs';

test('catalog contains the extracted spark game and two lightweight interactions', () => {
  const runtime = createGamesRuntime();
  assert.deepEqual(runtime.catalog().games.map(game => game.id), ['spark', 'dice', 'riddle']);
});

test('spark requires participant consent and only returns fictional toy-play text', () => {
  const runtime = createGamesRuntime();
  const refused = runtime.start({ gameId: 'spark' });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'CONSENT_REQUIRED');
  const started = runtime.start({ gameId: 'spark', consentConfirmed: true });
  assert.equal(started.ok, true);
  assert.match(started.message, /虚构|玩具/);
  assert.doesNotMatch(started.message, /真实触电|伤口|疼痛/);
});

test('dice actions stay in range and are isolated to their own session', () => {
  let number = 0;
  const runtime = createGamesRuntime({ randomInt: () => (++number % 6) + 1 });
  const started = runtime.start({ gameId: 'dice' });
  const rolled = runtime.action({ sessionId: started.sessionId, action: 'roll' });
  assert.equal(rolled.ok, true);
  assert.ok(rolled.roll >= 1 && rolled.roll <= 6);
  assert.equal(runtime.action({ sessionId: started.sessionId, action: 'hint' }).code, 'ACTION_NOT_ALLOWED');
  assert.notEqual(runtime.status({ sessionId: '00000000-0000-4000-8000-000000000000' }).ok, true);
});

test('riddle supports hints, bounded answers, completion, and stopping', () => {
  const runtime = createGamesRuntime();
  const started = runtime.start({ gameId: 'riddle' });
  assert.equal(runtime.action({ sessionId: started.sessionId, action: 'hint' }).ok, true);
  const wrong = runtime.action({ sessionId: started.sessionId, action: 'answer', answer: '月亮' });
  assert.equal(wrong.correct, false);
  const right = runtime.action({ sessionId: started.sessionId, action: 'answer', answer: '影子' });
  assert.equal(right.correct, true);
  assert.equal(runtime.status({ sessionId: started.sessionId }).status, 'completed');
  assert.equal(runtime.stop({ sessionId: started.sessionId }).ok, true);
  assert.equal(runtime.status({ sessionId: started.sessionId }).code, 'SESSION_NOT_FOUND');
});

test('sessions expire and capacity is bounded', () => {
  let now = 1000;
  let id = 0;
  const runtime = createGamesRuntime({ now: () => now, randomUUID: () => `session-${++id}`, ttlMs: 10, maxSessions: 1 });
  const first = runtime.start({ gameId: 'dice' });
  assert.equal(runtime.start({ gameId: 'riddle' }).code, 'SESSION_LIMIT');
  now = 1011;
  assert.equal(runtime.status({ sessionId: first.sessionId }).code, 'SESSION_NOT_FOUND');
  assert.equal(runtime.start({ gameId: 'riddle' }).ok, true);
});
