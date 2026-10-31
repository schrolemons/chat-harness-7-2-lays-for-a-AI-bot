import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPluginHost } from '../src/plugin-host.js';

const T = Date.parse('2026-10-28T15:40:00Z'); // Shanghai 23:40
const minute = 60000;
const key = 'private:123';
async function fixture(t, config = {}, seed) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mood-lifecycle-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.cpSync(new URL('../plugins/qq-components/ctx-user-mood/', import.meta.url), path.join(root, 'plugins/qq-components/ctx-user-mood'), { recursive: true });
  const stateDir = path.join(root, 'state/plugins');
  fs.mkdirSync(path.join(stateDir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'config/ctx-user-mood.json'), JSON.stringify(config));
  if (seed) fs.writeFileSync(path.join(stateDir, 'ctx-user-mood.json'), JSON.stringify(seed));
  let host = createPluginHost({ root, startTimers: false });
  await host.loadAll();
  t.after(async () => { await host.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  return {
    get host() { return host; },
    stateFile: path.join(stateDir, 'ctx-user-mood.json'),
    call(method, payload) {
      const result = host.callService('mood', method, payload);
      assert.notEqual(result, null, `mood.${method} must return its service result`);
      return result;
    },
    read(k = key, now = T) { return this.call('read', { key: k, now }); },
    sent(extra = {}) { return this.call('sent', { key, proactiveId: 'p1', deliveryId: 'd1', wakeReason: 'proactiveCheck', sentAt: T, success: true, expectsReply: true, ...extra }); },
    incoming(extra = {}) { return this.call('incoming', { key, messageId: 'm1', userId: '123', at: T + minute, hasText: true, hasImage: false, isSelf: false, directedAtBot: false, ...extra }); },
    state() { return JSON.parse(fs.readFileSync(path.join(stateDir, 'ctx-user-mood.json'), 'utf8')); },
    async restart() { await host.dispose(); host = createPluginHost({ root, startTimers: false }); await host.loadAll(); }
  };
}

test('snapshot preserves 0/39/40/69/70/100 boundaries and never recovers with time', async t => {
  const f = await fixture(t);
  for (const [score, mode, band, replyCeiling, detailLevel, frequencyFactor] of [
    [0, 'critical', 'reflective', 1, 'concise', 0.2],
    [39, 'critical', 'reflective', 1, 'concise', 0.512],
    [40, 'normal', 'playful', 2, 'balanced', 0.52],
    [69, 'normal', 'playful', 2, 'balanced', 0.752],
    [70, 'normal', 'playful', 3, 'expanded', 0.76],
    [100, 'normal', 'playful', 3, 'expanded', 1]
  ]) {
    const k = `private:${score + 1000}`;
    f.call('initialize', { conversations: [{ key: k, score }], now: T });
    const view = f.read(k, T + 30 * 86400000);
    assert.deepEqual({ score: view.score, mode: view.mode, band: view.band, replyCeiling: view.replyCeiling, detailLevel: view.detailLevel }, { score, mode, band, replyCeiling, detailLevel });
    assert.ok(Math.abs(view.frequencyFactor - frequencyFactor) < 1e-12);
    assert.equal(view.unansweredStreak, 0);
    assert.equal(view.enabled, true);
    assert.equal('intervalMultiplier' in view, false);
  }
});

test('migration keeps valid zero and owned scores while rejecting malformed legacy values', async t => {
  const f = await fixture(t);
  f.call('initialize', { conversations: [{ key, score: 0 }, { key: 'group:2', score: 101 }, { key: 'private:3', score: null }, { key: 'private:4', score: '12' }], now: T });
  assert.equal(f.read().score, 0);
  f.call('initialize', { conversations: [{ key, score: 91 }], now: T });
  assert.equal(f.read().score, 0);
  assert.equal(f.read('group:2').score, 60);
  assert.equal(f.read('private:3').score, 60);
  assert.equal(f.read('private:4').score, 60);
  f.call('adjust', { key: 'private:5', action: 'dec', value: 20, now: T });
  f.call('initialize', { conversations: [{ key: 'private:5', score: 90 }], now: T });
  assert.equal(f.read('private:5').score, 40);
});

test('adjust validates positive finite amounts, clamps scores and isolates conversations', async t => {
  const f = await fixture(t, { maxAdjustment: 100 });
  for (const value of [0, -1, 101, NaN, Infinity, '10', null]) {
    assert.equal(f.call('adjust', { key, action: 'dec', value, now: T }).ok, false);
  }
  assert.equal(f.call('adjust', { key, action: 'set', value: 80, now: T }).ok, false);
  assert.equal(f.call('adjust', { key: 'private:evil', action: 'add', value: 10 }).ok, false);
  const change = f.call('adjust', { key, action: 'dec', value: 100, reason: 'explicit evaluation', now: T });
  assert.deepEqual([change.ok, change.before, change.score, change.reason], [true, 60, 0, 'explicit evaluation']);
  assert.equal(f.call('adjust', { key, action: 'add', value: 100, now: T }).score, 100);
  assert.equal(f.read('private:456').score, 60);
});

test('policy uses one configuration owner and disabled mood leaves scheduling neutral', async t => {
  const f = await fixture(t, { enabled: false, initial: 60, noReplyAfterMinutes: 5, decayPerHour: 99, dailyFloor: 99 });
  const policy = f.call('policy');
  assert.deepEqual({ enabled: policy.enabled, initial: policy.initial, noReplyAfterMinutes: policy.noReplyAfterMinutes }, { enabled: false, initial: 60, noReplyAfterMinutes: 5 });
  assert.equal('decayPerHour' in policy, false);
  assert.equal(f.read().frequencyFactor, 1);
  f.sent(); f.call('settle', { now: T + 100 * minute });
  assert.equal(f.read().score, 60);
});

test('image and text no longer trigger a first-message recovery', async t => {
  const f = await fixture(t);
  f.call('initialize', { conversations: [{ key, score: 10 }], now: T });
  f.incoming({ isSelf: true }); f.incoming({ hasText: false });
  assert.equal(f.read().score, 10);
  f.incoming({ hasText: false, hasImage: true });
  assert.equal(f.read().score, 10);
  f.call('adjust', { key, action: 'dec', value: 20, now: T + 2 * minute });
  f.incoming({ messageId: 'm2', at: T + 3 * minute });
  assert.equal(f.read().score, 0);
  await f.restart();
  f.incoming({ at: T + 25 * minute, hasText: false, hasImage: true });
  assert.equal(f.read().score, 0, 'old image replay on a new day is not new activity');
  f.incoming({ messageId: 'm3', at: T + 286 * minute });
  assert.equal(f.read().score, 60);
});

test('cross-day incoming settles overdue penalty before daily floor, preserving the 60 floor', async t => {
  const f = await fixture(t);
  f.call('initialize', { conversations: [{ key, score: 60 }], now: T });
  f.sent();
  f.incoming({ at: T + 285 * minute });
  assert.equal(f.read().score, 60);
  assert.equal(f.read().unansweredStreak, 0);
  f.call('settle', { now: T + 300 * minute });
  assert.equal(f.read().score, 60);
});

test('successful conversational reasons alone start waits; explicit failures and unknown outcomes do not', async t => {
  const f = await fixture(t, { noReplyAfterMinutes: 5 });
  for (const wakeReason of ['reminder', 'newsShare', 'message', 'campus', 'worklog']) f.sent({ proactiveId: wakeReason, deliveryId: wakeReason, wakeReason });
  f.sent({ proactiveId: 'failed', deliveryId: 'failed', success: false });
  f.sent({ proactiveId: 'unknown', deliveryId: 'unknown', success: undefined });
  f.sent({ proactiveId: 'no-reply', deliveryId: 'no-reply', expectsReply: false });
  f.call('settle', { now: T + 5 * minute });
  assert.equal(f.read().score, 60);
  for (const wakeReason of ['proactiveCheck', 'timeBubble', 'startupGreeting', 'privateFollowup']) f.sent({ proactiveId: wakeReason, deliveryId: wakeReason, wakeReason });
  f.call('settle', { now: T + 5 * minute - 1 });
  assert.equal(f.read().score, 60);
  f.call('settle', { now: T + 5 * minute });
  assert.equal(f.read().score, 20);
  assert.equal(f.read().unansweredStreak, 4);
});

test('partial multipart delivery deduplicates proactive receipts through restart and repeated ticks', async t => {
  const f = await fixture(t);
  f.sent({ success: false });
  f.sent({ deliveryId: 'd2' });
  f.sent({ deliveryId: 'd3', sentAt: T + 2 * minute });
  await f.restart();
  await f.host.tick(T + 20 * minute);
  await f.host.tick(T + 21 * minute);
  assert.equal(f.read().score, 50);
  assert.equal(f.read().unansweredStreak, 1);
  await f.restart();
  f.sent({ deliveryId: 'd4', sentAt: T + 30 * minute });
  f.call('settle', { now: T + 100 * minute });
  assert.equal(f.read().score, 50);
});

test('one consumed delivery ID cannot be recycled into a second proactive turn', async t => {
  const f = await fixture(t);
  f.sent();
  await f.restart();
  f.sent({ proactiveId: 'p2' });
  f.call('settle', { now: T + 20 * minute });
  assert.equal(f.read().score, 50);
});

test('private image response answers all earlier waits and persists completion', async t => {
  const f = await fixture(t);
  f.sent();
  f.sent({ proactiveId: 'p2', deliveryId: 'd2', sentAt: T + minute });
  f.incoming({ at: T + 2 * minute, userId: '456', hasText: false, hasImage: true });
  await f.restart();
  f.call('settle', { now: T + 100 * minute });
  assert.equal(f.read().score, 60);
  assert.equal(f.read().unansweredStreak, 0);
});

test('group human replies end waits without extra recovery; daily 04:00 floors independently', async t => {
  const f = await fixture(t);
  const group = 'group:789';
  f.call('initialize', { conversations: [{ key: group, score: 60 }], now: T });
  f.sent({ key: group, targetUserId: '123' });
  f.incoming({ key: group, userId: '456', at: T + minute });
  assert.equal(f.read(group).score, 60);
  f.call('settle', { now: T + 20 * minute });
  assert.equal(f.read(group).score, 50);
  f.sent({ key: group, proactiveId: 'p2', deliveryId: 'd2', targetUserId: '123', sentAt: T + 21 * minute });
  f.incoming({ key: group, messageId: 'm2', userId: '123', at: T + 22 * minute });
  f.sent({ key: group, proactiveId: 'p3', deliveryId: 'd3', targetUserId: '123', sentAt: T + 23 * minute });
  f.incoming({ key: group, messageId: 'm3', userId: '456', at: T + 24 * minute, directedAtBot: true });
  f.call('settle', { now: T + 300 * minute });
  assert.equal(f.read(group).score, 60, 'new day floor applies; valid responses consume both waits');
  assert.equal(f.read(group).unansweredStreak, 0);
});

test('zero enters pleading only following unanswered proactive turn and human return ends pleading', async t => {
  const f = await fixture(t);
  f.call('initialize', { conversations: [{ key, score: 0 }], now: T });
  assert.equal(f.read().band, 'reflective');
  f.sent(); f.call('settle', { now: T + 20 * minute });
  const view = f.read();
  assert.deepEqual([view.mode, view.band, view.replyCeiling, view.detailLevel], ['critical', 'pleading', 2, 'gentle-fragments']);
  f.incoming({ at: T + 21 * minute });
  assert.equal(f.read().band, 'reflective');
  assert.equal(f.read().unansweredStreak, 0);
});

test('old out-of-order incoming cannot answer a newer proactive turn', async t => {
  const f = await fixture(t);
  f.sent({ sentAt: T + 10 * minute });
  f.incoming({ at: T });
  f.call('settle', { now: T + 30 * minute });
  assert.equal(f.read().score, 50);
});

test('member mood observations preserve identity and score with no hourly drift', async t => {
  const f = await fixture(t, {}, { members: { 'group:789#123': { score: 0, updatedAt: T } } });
  assert.equal(f.host.callService('mood-users', 'list', { key: 'group:789', now: T + 30 * 86400000 }).items[0].mood, 0);
  const result = f.host.callService('mood-users', 'record', { key: 'group:789', userId: '123', delta: 5, now: T + 30 * 86400000 });
  assert.equal(result.score, 5);
  await f.restart();
  assert.equal(f.host.callService('mood-users', 'list', { key: 'group:789', now: T + 60 * 86400000 }).items[0].mood, 5);
  assert.equal(f.read('group:789').score, 60, 'member observations do not own conversation score');
});

test('configurable threshold and identity determine style and relative reply ceiling', async t => {
  const f = await fixture(t, { modeThreshold: 80, normalName: '晴天', criticalName: '雨天', normalStyle: '明亮且亲切', criticalStyle: '安静地思考' });
  for (const [score, mode, modeName, replyCeiling, text] of [[75, 'critical', '雨天', 1, '安静地思考'], [80, 'normal', '晴天', 2, '明亮且亲切'], [89, 'normal', '晴天', 2, '明亮且亲切'], [90, 'normal', '晴天', 3, '明亮且亲切'], [100, 'normal', '晴天', 3, '明亮且亲切']]) {
    const k = `private:${score}`;
    f.call('initialize', { conversations: [{ key: k, score }], now: T });
    const view = f.read(k);
    assert.deepEqual([view.mode, view.modeName, view.replyCeiling], [mode, modeName, replyCeiling]);
    assert.ok(view.styleInstruction.includes(text));
  }
});

test('threshold zero keeps zero mood in normal mode even with unanswered streak', async t => {
  const f = await fixture(t, { modeThreshold: 0 });
  f.call('initialize', { conversations: [{ key, score: 0 }], now: T });
  f.sent(); f.call('settle', { now: T + 20 * minute });
  assert.deepEqual([f.read().mode, f.read().modeName, f.read().band, f.read().replyCeiling], ['normal', '日常交流', 'playful', 2]);
});

test('explicit behavior rules enforce direction and amount while autonomous adjustments use their own cap', async t => {
  const f = await fixture(t, { maxAdjustment: 7, positiveRules: [{ id: 'help', label: '耐心帮助', delta: 9, description: '认真帮助解决问题' }], negativeRules: [{ id: 'hurt', label: '明确冒犯', delta: -4, description: '明确不尊重边界' }] });
  const policy = f.call('policy');
  assert.deepEqual(policy.positiveRules, [{ id: 'help', label: '耐心帮助', delta: 9, description: '认真帮助解决问题' }]);
  for (const extra of [{ value: 8 }, { value: 1, ruleId: 'absent' }, { value: 10, ruleId: 'help' }, { action: 'dec', value: 1, ruleId: 'help' }, { value: 1, ruleId: 'hurt' }, { action: 'dec', value: 5, ruleId: 'hurt' }]) {
    assert.equal(f.call('adjust', { key, action: 'add', now: T, ...extra }).ok, false);
  }
  assert.equal(f.read().score, 60);
  assert.equal(f.call('adjust', { key, action: 'add', value: 9, ruleId: 'help', reason: 'patient assistance', now: T }).score, 69);
  assert.equal(f.call('adjust', { key, action: 'dec', value: 4, ruleId: 'hurt', now: T }).score, 65);
  assert.equal(f.call('adjust', { key, action: 'add', value: 7, now: T }).score, 72);
});

test('default autonomous cap and behavior rules are exposed without automatic keyword scoring', async t => {
  const f = await fixture(t);
  const policy = f.call('policy');
  assert.equal(policy.maxAdjustment, 20);
  assert.deepEqual(policy.positiveRules.map(rule => rule.delta), [3, 5, 5]);
  assert.deepEqual(policy.negativeRules.map(rule => rule.delta), [-5, -10, -5]);
  assert.equal(policy.dailyFloor, 60); assert.equal(policy.noReplyPenalty, 10);
  assert.equal(f.call('adjust', { key, action: 'add', value: 21, now: T }).ok, false);
  f.incoming({ text: '你好，谢谢，真可爱', hasText: true });
  assert.equal(f.read().score, 60);
});

test('history persists model, daily and unanswered changes with actual before/after values', async t => {
  const f = await fixture(t);
  f.call('adjust', { key, action: 'dec', value: 20, reason: 'clear request for quiet', now: T });
  f.incoming({at:T+261*minute});
  f.sent({ sentAt: T + 262 * minute });
  f.call('settle', { now: T + 282 * minute });
  await f.restart();
  const history = f.call('history', { key, limit: 10 });
  assert.deepEqual(history.items.map(item => [item.source, item.before, item.after, item.delta]), [['unanswered', 60, 50, -10], ['daily-recovery', 40, 60, 20], ['model-adjustment', 60, 40, -20]]);
  assert.equal(history.items[2].reason, 'clear request for quiet');
  assert.equal(f.call('history', { key, limit: 1 }).items.length, 1);
  assert.deepEqual(f.call('history', { key: 'group:999', limit: 10 }).items, []);
});

test('group reply to one target does not consume waits addressed to other people', async t => {
  const f = await fixture(t);
  f.sent({ key: 'group:789', targetUserId: '123' });
  f.sent({ key: 'group:789', targetUserId: '456', deliveryId: 'd2', proactiveId: 'p2' });
  f.incoming({ key: 'group:789', userId: '123' });
  f.call('settle', { now: T + 20 * minute });
  assert.equal(f.read('group:789').score, 50);
  assert.equal(f.read('group:789').unansweredStreak, 1);
});

test('failed atomic persistence leaves penalty and daily receipt retryable together', async t => {
  const f = await fixture(t);
  f.sent();
  // The host has already loaded state. Make only its atomic replacement fail.
  fs.renameSync(f.stateFile, f.stateFile + '.saved');
  fs.mkdirSync(f.stateFile);
  assert.equal(f.host.callService('mood', 'incoming', { key, messageId: 'm1', userId: '123', hasImage: true, at: T + 285 * minute }), null);
  assert.equal(f.read().unansweredStreak, 0);
  fs.rmdirSync(f.stateFile);
  fs.renameSync(f.stateFile + '.saved', f.stateFile);
  const result = f.incoming({ at: T + 285 * minute, hasText: false, hasImage: true });
  assert.equal(result.settled, 1);
  assert.equal(result.floored, true);
  assert.equal(f.read().score, 60);
  assert.deepEqual(f.call('history', { key }).items.map(item => item.source), ['daily-recovery', 'unanswered']);
});

test('more than 200 pending turns and consumed IDs survive restart without arbitrary trimming', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 205; i++) f.sent({ proactiveId: `p${i}`, deliveryId: `d${i}` });
  await f.restart();
  f.call('settle', { now: T + 20 * minute });
  assert.equal(f.read().unansweredStreak, 205);
  await f.restart();
  f.sent({ proactiveId: 'p0', deliveryId: 'new-part', sentAt: T + 30 * minute });
  f.sent({ proactiveId: 'replacement', deliveryId: 'd0', sentAt: T + 30 * minute });
  f.call('settle', { now: T + 100 * minute });
  assert.equal(f.read().unansweredStreak, 205);
});

test('threshold 100 reserves normal mode and three replies for exactly 100', async t => {
  const f = await fixture(t, { modeThreshold: 100 });
  f.call('initialize', { conversations: [{ key, score: 99 }, { key: 'private:100', score: 100 }], now: T });
  assert.deepEqual([f.read().mode, f.read().replyCeiling], ['critical', 1]);
  assert.deepEqual([f.read('private:100').mode, f.read('private:100').replyCeiling], ['normal', 3]);
});

test('incoming before a delayed successful receipt still settles its valid reply', async t => {
  const f = await fixture(t);
  f.incoming({ at: T + minute });
  f.sent({ sentAt: T });
  f.call('settle', { now: T + 20 * minute });
  assert.equal(f.read().score, 60);
  assert.equal(f.read().unansweredStreak, 0);
});

test('only trusted reengagement creates a pending welcome; ordinary activity does not', async t => {
  const f = await fixture(t);
  assert.equal(f.call('policy').burstEnabled, true);
  assert.equal(f.call('policy').recoverMinutes, 20);
  f.incoming();
  assert.equal(f.read(key, T + minute).welcomeBurstActive, false);
  f.incoming({ messageId: 'not-trusted', at: T + minute, reengaged: 'true' });
  f.incoming({ messageId: 'self', at: T + minute, isSelf: true, reengaged: true });
  assert.equal(f.read(key, T + minute).welcomeBurstActive, false);
  f.incoming({ messageId: 'm2', at: T + 2 * minute, reengaged: true });
  const view = f.read(key, T + 2 * minute);
  assert.equal(view.welcomeBurstActive, true);
  assert.equal(Object.hasOwn(view, 'welcomeBurstUntil'), false);
  assert.equal(view.cooldownUntil, T + 22 * minute);
  assert.equal(view.score, 60);
});

test('welcome survives restart and cooldown passage without extending the cooldown', async t => {
  const f = await fixture(t);
  f.incoming({ reengaged: true });
  const first = f.read(key, T + minute);
  await f.restart();
  f.incoming({ messageId: 'm2', at: T + 2 * minute, reengaged: true });
  const second = f.read(key, T + 2 * minute);
  assert.deepEqual([second.cooldownUntil, second.welcomeBurstActive], [first.cooldownUntil, true]);
  assert.equal(f.read(key, first.cooldownUntil + 1).welcomeBurstActive, true);
  assert.equal(f.read(key, T + 20 * minute).score, 60);
});

test('successful normal reply consumes welcome once; failed unknown purpose and proactive sends cannot', async t => {
  const f = await fixture(t);
  f.incoming({ reengaged: true });
  for (const extra of [{ wakeReason: 'message', success: false }, { wakeReason: 'message', success: undefined }, { wakeReason: 'reminder' }, { wakeReason: 'worklog' }, { wakeReason: 'proactiveCheck' }]) {
    f.sent({ sentAt: T + 2 * minute, expectsReply: false, ...extra });
    assert.equal(f.read(key, T + 2 * minute).welcomeBurstActive, true);
  }
  const result = f.call('sent', { key, deliveryId: 'normal-reply', wakeReason: 'message', sentAt: T + 3 * minute, success: true, expectsReply: false });
  assert.equal(result.welcomeConsumed, true);
  assert.equal(result.created, false);
  assert.equal(f.read(key, T + 3 * minute).welcomeBurstActive, false);
  await f.restart();
  f.call('settle', { now: T + 30 * minute });
  assert.equal(f.read().score, 60, 'normal replies and purposes create no emotional wait');
});

test('zero cooldown really permits another welcome after consumption without automatic score gain', async t => {
  const f = await fixture(t, { recoverMinutes: 0 });
  assert.equal(f.call('policy').recoverMinutes, 0);
  f.incoming({ reengaged: true });
  const first = f.read(key, T + minute);
  assert.equal(first.cooldownUntil, T + minute);
  assert.equal(first.welcomeBurstActive, true);
  f.call('sent', { key, deliveryId: 'reply1', wakeReason: 'message', sentAt: T + minute, success: true });
  f.incoming({ messageId: 'm2', at: T + 2 * minute, reengaged: true });
  assert.equal(f.read(key, T + 2 * minute).welcomeBurstActive, true);
  assert.equal(f.read(key, T + 2 * minute).cooldownUntil, T + 2 * minute);
  f.call('sent', { key, deliveryId: 'reply1', wakeReason: 'message', sentAt: T + 2 * minute, success: true });
  assert.equal(f.read(key, T + 2 * minute).welcomeBurstActive, true, 'replayed delivery receipt cannot consume a new welcome');
  assert.equal(f.read(key, T + 2 * minute).score, 60);
});

test('critical mood and explicitly disabled welcome cannot activate a welcome burst', async t => {
  const f = await fixture(t, { modeThreshold: 80 });
  f.incoming({ reengaged: true });
  assert.equal(f.read(key, T + minute).mode, 'critical');
  assert.equal(f.read(key, T + minute).welcomeBurstActive, false);
  const disabled = await fixture(t, { burstEnabled: false });
  disabled.incoming({ reengaged: true });
  assert.equal(disabled.read(key, T + minute).welcomeBurstActive, false);
});

test('consumption preserves cooldown and a reply after cooldown still consumes its pending welcome', async t => {
  const f = await fixture(t);
  f.incoming({ reengaged: true });
  const first = f.read(key, T + minute);
  f.call('sent', { key, deliveryId: 'reply', wakeReason: 'message', sentAt: T + 2 * minute, success: true });
  f.incoming({ messageId: 'm2', at: T + 3 * minute, reengaged: true });
  assert.equal(f.read(key, T + 3 * minute).welcomeBurstActive, false);
  f.incoming({ messageId: 'm3', at: first.cooldownUntil, reengaged: true });
  const next = f.read(key, first.cooldownUntil);
  assert.equal(next.welcomeBurstActive, true);
  const late = f.call('sent', { key, deliveryId: 'late', wakeReason: 'message', sentAt: next.cooldownUntil + 1, success: true });
  assert.equal(late.welcomeConsumed, true);
  assert.equal(f.read(key, next.cooldownUntil + 1).welcomeBurstActive, false);
});

test('existing scheduler clears an unused welcome only after the conversation is confirmed idle', async () => {
  const {createPlugin}=await import('../plugins/qq-components/ctx-user-mood/index.js');
  let state={},facts={busy:true,conversationAwake:true};
  const plugin=createPlugin({config:{},state:{get:()=>structuredClone(state),set:patch=>{state={...state,...structuredClone(patch)};}},capabilities:{getProactiveFacts:()=>facts}});
  const mood=plugin.services.mood;
  mood.incoming({key,messageId:'welcome',userId:'123',at:T,hasText:true,reengaged:true});
  plugin.hooks.onTick({now:T+30*minute});
  assert.equal(mood.read({key,now:T+30*minute}).welcomeBurstActive,true,'cooldown must not expire an ongoing welcome');
  facts=undefined;plugin.hooks.onTick({now:T+30*minute});
  assert.equal(mood.read({key,now:T+30*minute}).welcomeBurstActive,true,'missing lifecycle evidence must not cancel a welcome');
  facts={busy:false,conversationAwake:false};plugin.hooks.onTick({now:T+31*minute});
  const result=mood.read({key,now:T+31*minute});
  assert.equal(result.welcomeBurstActive,false);assert.equal(result.cooldownUntil,T+20*minute);assert.equal(result.score,60);
  assert.equal(state.mood.conversations[key].welcomeConsumedAt,undefined,'cancellation is not a successful delivery');
  assert.equal(mood.sent({key,deliveryId:'after-idle',wakeReason:'message',sentAt:T+32*minute,success:true}).welcomeConsumed,false);
});

test('late response yields the same penalty with receipt-first or delayed confirmation across restart', async t => {
  const sendAt = T - 60 * minute; // Keep both responses on one Shanghai day.
  for (const delayed of [false, true]) {
    const f = await fixture(t);
    f.incoming({ messageId: 'before', at: sendAt - minute });
    if (!delayed) f.sent({ sentAt: sendAt });
    f.incoming({ messageId: 'late', at: sendAt + 25 * minute });
    await f.restart();
    if (delayed) f.sent({ sentAt: sendAt });
    f.call('settle', { now: sendAt + 30 * minute });
    assert.equal(f.read().score, 50, `receipt delayed=${delayed} must not accept a late response as timely`);
    assert.equal(f.read().unansweredStreak, 0, 'actual late return ends the unanswered episode without canceling its penalty');
    assert.equal(f.call('history', { key }).items.filter(item => item.source === 'unanswered').length, 1);
    await f.restart();
    f.call('settle', { now: sendAt + 40 * minute });
    assert.equal(f.read().score, 50);
  }
});

test('timely response followed by late response remains answered when receipt arrives last', async t => {
  const sendAt = T - 60 * minute;
  for (const delayed of [false, true]) {
    const f = await fixture(t);
    f.incoming({ messageId: 'before', at: sendAt - minute });
    if (!delayed) f.sent({ sentAt: sendAt });
    f.incoming({ messageId: 'timely', at: sendAt + 5 * minute });
    f.incoming({ messageId: 'late', at: sendAt + 25 * minute });
    await f.restart();
    if (delayed) f.sent({ sentAt: sendAt });
    f.call('settle', { now: sendAt + 30 * minute });
    assert.equal(f.read().score, 60);
    const waits = Object.values(f.state().mood.waits);
    assert.equal(waits[0].answeredAt, sendAt + 5 * minute, 'earlier timely evidence must not be replaced by latest response');
  }
});

test('already answered old group target cannot clear a different target unanswered streak after restart', async t => {
  const group = 'group:789', sendAt = T - 60 * minute;
  const f = await fixture(t);
  f.sent({ key: group, sentAt: sendAt, targetUserId: '123' });
  f.incoming({ key: group, messageId: 'old-answer', userId: '123', at: sendAt + minute });
  f.sent({ key: group, sentAt: sendAt + 2 * minute, proactiveId: 'p2', deliveryId: 'd2', targetUserId: '456' });
  for (let i = 0; i < 3; i++) f.call('adjust', { key: group, action: 'dec', value: 20, now: sendAt + 3 * minute });
  f.call('settle', { now: sendAt + 22 * minute });
  await f.restart();
  assert.deepEqual([f.read(group).score, f.read(group).unansweredStreak, f.read(group).band], [0, 1, 'pleading']);
  const unrelated = f.incoming({ key: group, messageId: 'unrelated-old-target', userId: '123', at: sendAt + 23 * minute });
  assert.equal(unrelated.answered, 0);
  assert.deepEqual([f.read(group).score, f.read(group).unansweredStreak, f.read(group).band], [0, 1, 'pleading']);
  f.incoming({ key: group, messageId: 'actual-late-answer', userId: '456', at: sendAt + 24 * minute });
  assert.equal(f.read(group).unansweredStreak, 0, 'a genuine late answer to an unanswered round still counts');
});

test('delayed confirmation replays due penalty before next-day floor and later explicit adjustment', async t => {
  for (const delayed of [false, true]) {
    const f = await fixture(t);
    f.incoming({ messageId: 'before', at: T - minute });
    if (!delayed) f.sent();
    f.incoming({ messageId: 'next-day', at: T + 285 * minute });
    f.call('adjust', { key, action: 'dec', value: 5, reason: 'after daily floor', now: T + 286 * minute });
    await f.restart();
    if (delayed) f.sent();
    f.call('settle', { now: T + 290 * minute });
    assert.equal(f.read().score, 55, 'late evidence must not apply old penalty after already applied daily floor');
    const events = f.call('history', { key, limit: 10 }).items.reverse();
    assert.deepEqual(events.map(item => [item.source, item.before, item.after]), [['unanswered', 60, 50], ['daily-recovery', 50, 60], ['model-adjustment', 60, 55]]);
    assert.equal(events[0].effectiveAt, T + 20 * minute);
    assert.equal(typeof events[0].recordedAt, 'number');
    await f.restart(); f.sent({ deliveryId: 'duplicate-part' });
    f.call('settle', { now: T + 300 * minute });
    assert.equal(f.call('history', { key }).items.length, 3);
    assert.equal(f.read().score, 55);
  }
});

test('explicit adjustment settles due waits first when a late tick would change clamped result', async t => {
  const f = await fixture(t, { initial: 99 });
  f.call('initialize', { conversations: [{ key, score: 0 }], now: T });
  f.sent();
  const result = f.call('adjust', { key, action: 'add', value: 10, now: T + 21 * minute });
  assert.deepEqual([result.before, result.score], [0, 10]);
  f.call('settle', { now: T + 22 * minute });
  assert.equal(f.read().score, 10, 'due penalty at zero cannot erase a later explicit positive adjustment');
});

test('a response exactly at the deadline is late regardless of confirmation order', async t => {
  const sendAt = T - 60 * minute;
  for (const delayed of [false, true]) {
    const f = await fixture(t);
    f.incoming({ messageId: 'before', at: sendAt - minute });
    if (!delayed) f.sent({ sentAt: sendAt });
    f.incoming({ messageId: 'at-deadline', at: sendAt + 20 * minute });
    await f.restart();
    if (delayed) f.sent({ sentAt: sendAt });
    f.call('settle', { now: sendAt + 21 * minute });
    assert.equal(f.read().score, 50);
    assert.equal(f.read().unansweredStreak, 0);
  }
});

test('delayed group receipts use persisted direct-or-target qualification and retain earliest timely evidence', async t => {
  const group = 'group:789', sendAt = T - 60 * minute;
  for (const [userId, directedAtBot, expected] of [['123', false, 60], ['456', true, 60], ['456', false, 50]]) {
    const f = await fixture(t);
    f.incoming({ key: group, messageId: 'before', at: sendAt - minute });
    f.incoming({ key: group, messageId: 'timely', userId, directedAtBot, at: sendAt + 5 * minute });
    f.incoming({ key: group, messageId: 'late', userId: '123', at: sendAt + 25 * minute });
    await f.restart();
    f.sent({ key: group, sentAt: sendAt, targetUserId: '123' });
    f.call('settle', { now: sendAt + 30 * minute });
    assert.equal(f.read(group).score, expected);
    const wait = Object.values(f.state().mood.waits)[0];
    assert.equal(wait.answeredAt, sendAt + (expected === 60 ? 5 : 25) * minute);
  }
});

test('owned zero with no score history remains the replay baseline when current default differs', async t => {
  const f = await fixture(t, { initial: 99 }, { mood: { conversations: { [key]: { score: 0, unansweredStreak: 0, updatedAt: T, lastRecoveryDay:"2026-10-28" } } } });
  f.sent();
  f.call('adjust', { key, action: 'add', value: 10, now: T + 21 * minute });
  await f.restart();
  assert.equal(f.read().score, 10);
  assert.equal(f.state().mood.conversations[key].baseScore, 0);
});

test('older late-confirmed round cannot resurrect pleading after a newer round was answered across restart', async t => {
  const sendAt = T - 120 * minute;
  for (const k of [key, 'group:789']) for (const delayed of [false, true]) {
    const f = await fixture(t);
    f.incoming({ key: k, messageId: 'before', at: sendAt - minute });
    for (let i = 0; i < 3; i++) f.call('adjust', { key: k, action: 'dec', value: 20, now: sendAt - minute });
    if (!delayed) f.sent({ key: k, sentAt: sendAt, targetUserId: '123' });
    f.incoming({ key: k, messageId: 'p1-reply', userId: '123', at: sendAt + 25 * minute });
    f.sent({ key: k, proactiveId: 'p2', deliveryId: 'd2', targetUserId: '456', sentAt: sendAt + 30 * minute });
    f.incoming({ key: k, messageId: 'p2-reply', userId: '456', at: sendAt + 55 * minute });
    await f.restart();
    if (delayed) f.sent({ key: k, sentAt: sendAt, targetUserId: '123' });
    const view = f.read(k);
    assert.deepEqual([view.score, view.unansweredStreak, view.band, view.replyCeiling], [0, 0, 'reflective', 1], `${k}, delayed=${delayed}`);
    const events = f.call('history', { key: k }).items;
    assert.equal(events.filter(item => item.source === 'unanswered').length, 2);
    const waits = Object.values(f.state().mood.waits);
    assert.equal(waits.find(wait => wait.proactiveId === 'p1').firstReplyAt, sendAt + 25 * minute);
    assert.equal(waits.find(wait => wait.proactiveId === 'p2').firstReplyAt, sendAt + 55 * minute);
    await f.restart();
    assert.equal(f.read(k).unansweredStreak, 0);
  }
});

test('older first reply cannot erase a newer unanswered target or advance when that former target speaks again', async t => {
  const group = 'group:789', sendAt = T - 120 * minute;
  const f = await fixture(t);
  f.incoming({ key: group, messageId: 'before', at: sendAt - minute });
  for (let i = 0; i < 3; i++) f.call('adjust', { key: group, action: 'dec', value: 20, now: sendAt - minute });
  f.incoming({ key: group, messageId: 'p1-reply', userId: '123', at: sendAt + 25 * minute });
  f.sent({ key: group, proactiveId: 'p2', deliveryId: 'd2', targetUserId: '456', sentAt: sendAt + 30 * minute });
  f.call('settle', { now: sendAt + 50 * minute });
  await f.restart();
  f.sent({ key: group, sentAt: sendAt, targetUserId: '123' });
  assert.equal(f.read(group).unansweredStreak, 1);
  f.incoming({ key: group, messageId: 'p1-again', userId: '123', at: sendAt + 60 * minute });
  assert.deepEqual([f.read(group).unansweredStreak, f.read(group).band], [1, 'pleading']);
  const first = Object.values(f.state().mood.waits).find(wait => wait.proactiveId === 'p1');
  assert.equal(first.answeredAt, sendAt + 25 * minute);
  assert.equal(first.firstReplyAt, sendAt + 25 * minute);
});


test('first explicit multipart target starts at that part, persists, never changes to another person',async t=>{
 const f=await fixture(t),group='group:456';f.sent({key:group});
 f.incoming({key:group,userId:'123',messageId:'before-target',at:T+100});
 f.sent({key:group,deliveryId:'d2',targetUserId:'123',sentAt:T+200});
 await f.restart();let wait=Object.values(f.state().mood.waits)[0];
 assert.equal(wait.targetUserId,'123');assert.equal(wait.targetFromAt,T+200);assert.equal(wait.answeredAt,null);
 f.sent({key:group,deliveryId:'d3',targetUserId:'456',sentAt:T+300});
 assert.equal(f.incoming({key:group,userId:'456',messageId:'wrong-person',at:T+400}).answered,0);
 assert.equal(f.incoming({key:group,userId:'123',messageId:'right-person',at:T+500}).answered,1);
 const first=Object.values(f.state().mood.waits)[0].firstReplyAt;
 f.sent({key:group,deliveryId:'d4',targetUserId:'456',sentAt:T+600});
 assert.equal(Object.values(f.state().mood.waits)[0].firstReplyAt,first);
});
test('duplicate delivery cannot add a target; delayed first explicit target recognizes only subsequent facts',async t=>{
 const f=await fixture(t),group='group:456';f.sent({key:group});
 f.sent({key:group,targetUserId:'123',sentAt:T+10});
 assert.equal(Object.values(f.state().mood.waits)[0].targetUserId,null);
 f.incoming({key:group,userId:'123',messageId:'early',at:T+100});
 f.incoming({key:group,userId:'123',messageId:'after',at:T+300});
 f.sent({key:group,deliveryId:'d2',targetUserId:'123',sentAt:T+200});
 assert.equal(Object.values(f.state().mood.waits)[0].answeredAt,T+300);
});


test('late first-target receipt voids a mistaken penalty through chronology and daily floor, preserving evidence across restart',async t=>{
 const f=await fixture(t),group='group:456',sendAt=T-40*minute;
 f.call('initialize',{conversations:[{key:group,score:65}],now:sendAt});
 f.incoming({key:group,userId:'999',messageId:'day-before',at:sendAt-1});
 f.sent({key:group,sentAt:sendAt});
 f.incoming({key:group,userId:'123',messageId:'timely-target',at:sendAt+10*minute});
 f.call('settle',{now:sendAt+21*minute});
 const penalty=f.call('history',{key:group}).items.find(x=>x.source==='unanswered');
 assert.equal(f.read(group).score,55);
 f.incoming({key:group,userId:'999',messageId:'next-day-floor',at:T+281*minute});
 f.call('adjust',{key:group,action:'dec',value:20,reason:'fixture',now:T+282*minute});
 assert.equal(f.read(group).score,40);
 await f.restart();
 f.sent({key:group,deliveryId:'target-part',targetUserId:'123',sentAt:sendAt+5*minute});
 assert.equal(f.read(group).score,45,'replay removes prior penalty before the floor, not a flat +10 refund');
 const wait=Object.values(f.state().mood.waits)[0];
 assert.equal(wait.penalty,0);assert.equal(wait.originalPenalty,10);assert.equal(wait.answeredAt,sendAt+10*minute);
 const corrected=f.call('history',{key:group}).items.find(x=>x.source==='unanswered');
 assert.equal(corrected.voided,true);assert.equal(corrected.recordedAt,penalty.recordedAt);assert.equal(corrected.originalPenalty,10);assert.equal(corrected.originalScoreEffect.delta,penalty.delta);assert.equal(corrected.delta,0);
 await f.restart();assert.equal(f.read(group).score,45);assert.equal(f.read(group).unansweredStreak,0);
 f.sent({key:group,deliveryId:'target-part',targetUserId:'123',sentAt:sendAt+5*minute});assert.equal(f.read(group).score,45);
});

test('late first-target receipt keeps a real penalty when the target replied at or after its deadline',async t=>{
 const f=await fixture(t),group='group:456';f.incoming({key:group,userId:'999',messageId:'start',at:T-1});f.sent({key:group});
 f.incoming({key:group,userId:'123',messageId:'late-target',at:T+21*minute});
 const before=f.read(group).score;await f.restart();
 f.sent({key:group,deliveryId:'target-part',targetUserId:'123',sentAt:T+5*minute});
 const wait=Object.values(f.state().mood.waits)[0];assert.equal(wait.penalty,10);assert.equal(wait.originalPenalty,undefined);assert.equal(wait.answeredAt,T+21*minute);
 assert.equal(f.read(group).score,before);assert.equal(f.call('history',{key:group}).items.find(x=>x.source==='unanswered').voided,undefined);
});
