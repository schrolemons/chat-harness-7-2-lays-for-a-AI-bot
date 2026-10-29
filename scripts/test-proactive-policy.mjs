import test from 'node:test';
import assert from 'node:assert/strict';
const policyModule = await import('../plugins/qq-components/life-wake-reasons/proactive-policy.mjs').catch(() => ({}));
const serviceModule = await import('../plugins/qq-components/life-wake-reasons/proactive.mjs').catch(() => ({}));
import { createPlugin as createWakePlugin } from '../plugins/qq-components/life-wake-reasons/index.js';
const minute = 60000;
const noon = Date.parse('2026-10-29T12:00:00+08:00');
function fixture(config = {}, saved = {}) {
  let state = structuredClone(saved), requests = 0;
  const jobs = new Map();
  let facts = { allowed: true, paused: false, busy: false, pendingPurpose: false, quiet: false, budgetAllowed: true, mood: { frequencyFactor: 1 } };
  const ctx = { config: { curfewEnabled: false, ...config }, state: { get: () => state, set: patch => { state = { ...state, ...patch }; } }, scheduler: { schedule: spec => { jobs.set(spec.id, spec); return spec.id; }, cancel: id => jobs.delete(id) }, capabilities: { getProactiveFacts: () => facts, requestProactiveWake: () => { requests++; return { accepted: true }; } } };
  assert.equal(typeof serviceModule.createProactive, 'function', 'persisted proactive service exists');
  const service = serviceModule.createProactive(ctx);
  return { service, jobs, ctx, state: () => state, requests: () => requests, facts: value => { facts = { ...facts, ...value }; } };
}
test('canonical policy has validated cross-field boundaries and no legacy aliases', () => {
  assert.equal(typeof policyModule.normalizeProactivePolicy, 'function', 'canonical policy exists');
  const p = policyModule.normalizeProactivePolicy({ careEnabled: false });
  assert.equal(p.initialProbability, .15); assert.equal(p.checkMinMinutes, 15); assert.equal(p.proactiveEnabled, true);
  assert.equal(policyModule.validateProactivePolicy({ checkMinMinutes: 40, checkMaxMinutes: 20 }).ok, false);
  assert.equal(policyModule.validateProactivePolicy({ initialProbability: .9, probabilityMax: .2 }).ok, false);
});
test('stage math combines mood and willingness, signed intervals and positive floor', () => {
  assert.equal(typeof policyModule.effectiveProactiveStage, 'function', 'stage math exists');
  const p = policyModule.normalizeProactivePolicy({});
  const v = policyModule.effectiveProactiveStage(p, 2, 0, { frequencyFactor: .2 });
  assert.ok(Math.abs(v.effectiveProbability - .014) < 1e-10);
  assert.deepEqual(v.effectiveInterval, { minMinutes: 25.48, maxMinutes: 54.879999999999995 });
  const high = policyModule.effectiveProactiveStage(p, 100, 100, { frequencyFactor: 1 });
  assert.equal(high.effectiveProbability, .85); assert.equal(high.effectiveInterval.minMinutes, 1);
});
test('refresh creates one durable plan without rerolling; reload reconstructs same due', () => {
  const f = fixture(); f.service.observe({ key: 'private:1', at: noon, kind: 'incoming', hasText: true, eventId: 'a' });
  f.service.refresh({ key: 'private:1', now: noon, random: () => .5 });
  const nextAt = f.service.preview({ key: 'private:1', now: noon }).nextAt;
  f.service.refresh({ key: 'private:1', now: noon + minute, random: () => .99 });
  assert.equal(f.jobs.size, 1); assert.equal(f.service.preview({ key: 'private:1' }).nextAt, nextAt);
  const reloaded = fixture({}, f.state()); reloaded.service.refresh({ key: 'private:1', now: noon + minute });
  assert.equal(reloaded.jobs.size, 1); assert.equal(reloaded.service.preview({ key: 'private:1' }).nextAt, nextAt);
});
test('only eligible due random failure advances stage and preserves no mood send fiction', async () => {
  const f = fixture(); const key = 'private:1';
  const p = f.service.plan({ key, now: noon, facts: { allowed: true, budgetAllowed: true }, random: () => .5 });
  const due = p.nextAt;
  f.service.refresh({ key, now: due - 1, random: () => .99 }); assert.equal(f.service.preview({ key }).stage, 0);
  f.service.refresh({ key, now: due, random: () => .99 });
  await f.jobs.values().next().value.run({ now: due });
  assert.equal(f.service.preview({ key }).stage, 1); assert.equal(f.requests(), 0);
  assert.equal(f.service.preview({ key }).lastActivityAt, undefined);
});
test('all public gates beat maximum silence; blocked checks do not advance stage', () => {
  for (const [field, value] of [['allowed', false], ['paused', true], ['busy', true], ['pendingPurpose', true], ['quiet', true], ['budgetAllowed', false]]) {
    const f = fixture({ maxSilenceMinutes: 20 }); const key = 'group:2';
    f.service.observe({ key, at: noon, kind: 'incoming', hasImage: true });
    const facts = { allowed: true, budgetAllowed: true, [field]: value };
    const plan = f.service.plan({ key, now: noon + 100 * minute, facts });
    assert.equal(plan.allowed, false, field); assert.ok(plan.reason, field); assert.equal(f.service.preview({ key }).stage, 0);
  }
});
test('disabled, missing capabilities and curfew fail closed without busy retry', () => {
  const f = fixture({ proactiveEnabled: false }); f.service.refresh({ key: 'private:1', now: noon }); assert.equal(f.jobs.size, 0);
  const g = fixture({ curfewEnabled: true }); assert.equal(g.service.isCurfew({ now: Date.parse('2026-10-29T23:00:00+08:00') }), true);
  assert.equal(g.service.isCurfew({ now: Date.parse('2026-10-30T08:00:00+08:00') }), false);
  const h = fixture(); delete h.ctx.capabilities.getProactiveFacts; h.service.refresh({ key: 'private:1', now: noon }); assert.equal(h.jobs.size, 0);
});
test('actual activity dedups events, multipart deltas once, and returns old reengagement', () => {
  const f = fixture(); const key = 'private:1'; f.service.plan({ key, now: noon, facts: { allowed: true, budgetAllowed: true } });
  const p = { key, at: noon + 60 * minute, kind: 'incoming', hasImage: true, eventId: 'a' };
  assert.equal(f.service.observe(p).reengaged, true); assert.equal(f.service.preview({ key }).willingness, 70);
  f.service.observe(p); assert.equal(f.service.preview({ key }).willingness, 70);
  f.service.observe({ key, kind: 'sent', reason: 'reminder', hasText: true, at: p.at + minute, episodeId: 'purpose', eventId: 'p1' });
  f.service.observe({ key, kind: 'sent', reason: 'reminder', hasText: true, at: p.at + 2 * minute, episodeId: 'purpose', eventId: 'p2' });
  assert.equal(f.service.preview({ key }).willingness, 60); assert.equal(f.state().proactiveByKey[key].lastActivityAt, p.at + 2 * minute);
  f.service.observe({ key, kind: 'sent', reason: 'thinking', hasText: true, at: p.at + 3 * minute });
  assert.equal(f.state().proactiveByKey[key].lastActivityAt, p.at + 2 * minute);
});
test('AI willingness is explicit, strict, independent, and no-send release is not activity', async () => {
  const f = fixture({ initialProbability: 1, probabilityMax: 1 }); const key = 'private:1';
  assert.equal(f.service.preview({ key }).source, 'default');
  assert.equal(f.service.setWillingness({ key, value: 101 }).ok, false);
  f.service.setWillingness({ key, value: 100, reason: '明确等到明天', now: noon });
  const p = f.service.refresh({ key, now: noon, random: () => 0 });
  await f.jobs.values().next().value.run({ now: p.nextAt });
  assert.equal(f.requests(), 1); assert.equal(f.service.preview({ key }).phase, 'accepted');
  assert.equal(f.state().proactiveByKey[key].lastActivityAt, undefined);
  f.service.finished({ key, now: p.nextAt + minute });
  assert.notEqual(f.service.preview({ key }).phase, 'accepted'); assert.equal(f.service.preview({ key }).source, 'ai');
  assert.equal(f.service.preview({ key }).lastAI.reason, '明确等到明天');
});
test('actual ordinary replies preserve willingness; private and group states are separate', () => {
  const f = fixture(); f.service.setWillingness({ key: 'private:1', value: 24, reason: '等回复', now: noon });
  f.service.observe({ key: 'private:1', kind: 'sent', reason: 'message', hasText: true, at: noon });
  assert.equal(f.service.preview({ key: 'private:1' }).willingness, 24); assert.equal(f.service.preview({ key: 'group:1' }).willingness, 60);
});
test('no-send release retains true silence origin and schedules a finite fresh interval', async () => {
  const f = fixture({ maxSilenceMinutes: 30, initialProbability: 0 }); const key = 'private:3';
  f.service.observe({ key, at: noon, kind: 'incoming', hasText: true });
  const due = f.service.refresh({ key, now: noon, random: () => .5 }).nextAt;
  await f.jobs.values().next().value.run({ now: due });
  f.service.finished({ key, now: due + minute });
  assert.equal(f.state().proactiveByKey[key].startAt, noon);
  const next = f.service.refresh({ key, now: due + minute, random: () => 0 });
  assert.ok(next.nextAt > due + minute); assert.equal(f.service.preview({ key }).stage, 0);
});
test('maximum silence forces only at boundary; min active gap remains a hard boundary', async () => {
  const f = fixture({ maxSilenceMinutes: 30, initialProbability: 0 }); const key = 'private:4';
  f.service.observe({ key, at: noon, kind: 'sent', reason: 'proactiveCheck', hasText: true, eventId: 'out' });
  const due = f.service.refresh({ key, now: noon, random: () => .99 }).nextAt;
  assert.equal(due, noon + 30 * minute);
  await f.jobs.values().next().value.run({ now: due - 1 }); assert.equal(f.requests(), 0);
  await f.jobs.values().next().value.run({ now: due }); assert.equal(f.requests(), 1);
});
test('due job rechecks gates; blocked due job never creates repeated immediate jobs', async () => {
  const f = fixture({ maxSilenceMinutes: 30 }); const key = 'group:4';
  const due = f.service.refresh({ key, now: noon }).nextAt;
  f.facts({ pendingPurpose: true }); const job = f.jobs.values().next().value;
  // Real central scheduler removes one-shot job before invoking it.
  f.jobs.delete(job.id); await job.run({ now: due });
  assert.equal(f.requests(), 0); assert.equal(f.jobs.size, 0); assert.equal(f.service.preview({ key }).stage, 0);
  f.facts({ pendingPurpose: false }); assert.equal(f.service.refresh({ key, now: due }).nextAt, due);
});
test('preview never mutates persisted state or random plans and disabled mood uses factor one', () => {
  const f = fixture(); const key = 'private:9'; f.facts({ mood: { enabled: false, score: 0 } });
  f.service.plan({ key, now: noon, facts: { allowed: true, budgetAllowed: true, mood: { enabled: false, score: 0 } }, random: () => .5 });
  const before = structuredClone(f.state());
  assert.ok(Math.abs(f.service.preview({ key, now: noon }).effectiveProbability - .102) < 1e-10);
  f.service.preview({ key, now: noon + 100 * minute }); assert.deepEqual(f.state(), before);
});
test('late activity cannot reset a newer episode or spend willingness twice across reload', () => {
  const f = fixture(); const key = 'group:7';
  f.service.observe({ key, kind: 'incoming', at: noon, hasText: true, eventId: 'new' });
  f.service.refresh({ key, now: noon }); const due = f.service.preview({ key }).nextAt;
  f.service.observe({ key, kind: 'incoming', at: noon - minute, hasText: true, eventId: 'late' });
  assert.equal(f.service.preview({ key }).nextAt, due);
  const reloaded = fixture({}, f.state()); reloaded.service.observe({ key, kind: 'incoming', at: noon, hasText: true, eventId: 'new' });
  assert.equal(reloaded.service.preview({ key }).willingness, 70);
});
test('proactive tail uses current private/group and configured persona with no unsolicited search', () => {
  const plugin = createWakePlugin({ config: {}, state: { get: () => ({}) }, capabilities: {} });
  const text = plugin.hooks.wakeTail({ key: 'private:4', reason: 'proactiveCheck', doubleStampEnabled: false, mood: { modeName: '小猫', styleInstruction: '安静温柔' } });
  assert.match(text, /小猫/); assert.match(text, /安静温柔/); assert.ok(!text.includes('web_search')); assert.ok(!text.includes('群里已经'));
});
test('recreated service releases a confirmed orphan once without fabricating sent activity', () => {
  const key = 'private:5', saved = { proactiveByKey: { [key]: { stage: 2, willingness: 60, source: 'default', phase: 'accepted', startAt: noon, acceptedAt: noon + 40 * minute } } };
  const f = fixture({}, saved); f.service.refresh({ key, now: noon + 41 * minute });
  assert.notEqual(f.service.preview({ key }).phase, 'accepted');
  assert.equal(f.state().proactiveByKey[key].startAt, noon); assert.equal(f.state().proactiveByKey[key].lastActivityAt, undefined);
  assert.equal(f.state().proactiveByKey[key].lifecycleHistory[0].reason, 'recovered-orphan');
  f.service.refresh({ key, now: noon + 42 * minute }); assert.equal(f.state().proactiveByKey[key].lifecycleHistory.length, 1);
});
test('recreated service preserves accepted opportunity if host still has a real/pending turn', () => {
  const key = 'group:5', saved = { proactiveByKey: { [key]: { stage: 1, willingness: 60, source: 'default', phase: 'accepted', startAt: noon, acceptedAt: noon + 40 * minute } } };
  const f = fixture({}, saved); f.facts({ busy: true }); f.service.refresh({ key, now: noon + 41 * minute });
  assert.equal(f.service.preview({ key }).phase, 'accepted'); assert.equal(f.jobs.size, 0);
  f.facts({ busy: false, pendingPurpose: true }); f.service.refresh({ key, now: noon + 42 * minute }); assert.equal(f.service.preview({ key }).phase, 'accepted');
});
test('interval stages also support positive growth while probability caps independently', () => {
  const p = policyModule.normalizeProactivePolicy({ intervalStepMinutes: 2, initialProbability: .2, probabilityStep: .3, probabilityMax: .7 });
  const v = policyModule.effectiveProactiveStage(p, 3, 100, { frequencyFactor: 1 });
  assert.equal(v.effectiveProbability, .7); assert.deepEqual(v.effectiveInterval, { minMinutes: 21, maxMinutes: 36 });
});
test('actual self/empty/failure facts cannot reset silence or consume willingness', () => {
  const f = fixture(); const key = 'private:8'; f.service.refresh({ key, now: noon }); const before = structuredClone(f.state());
  for (const fact of [{ kind: 'incoming', isSelf: true, hasText: true }, { kind: 'incoming' }, { kind: 'sent', hasText: true, success: false }]) f.service.observe({ key, at: noon + minute, ...fact });
  assert.deepEqual(f.state(), before);
});
test('plugin exposes synchronous cross-field validation for host save rejection', () => {
  const plugin = createWakePlugin({ config: {}, state: { get: () => ({}) }, capabilities: {} });
  assert.equal(typeof plugin.validateConfig, 'function');
  assert.equal(plugin.validateConfig({ checkMinMinutes: 50, checkMaxMinutes: 20 }).ok, false);
});
test('activity-adjusted willingness keeps last AI evidence separate from current source', () => {
  const f = fixture(), key = 'private:8';
  f.service.setWillingness({ key, value: 45, reason: '先等一等', now: noon });
  f.service.observe({ key, kind: 'incoming', at: noon + minute, hasText: true, eventId: 'back' });
  const preview = f.service.preview({ key }); assert.equal(preview.willingness, 55); assert.equal(preview.source, 'activity'); assert.equal(preview.lastAI.value, 45);
});


test('transport extensions count actual non-text deliveries, cancel only own job and enforce reason gates',()=>{
 const f=fixture({curfewEnabled:true,curfewStartHour:23,curfewEndHour:8}),key='group:1';
 for(const [i,kind]of ['voice','poke','file'].entries())assert.equal(f.service.observe({key,kind:'sent',eventId:kind,at:noon+i,success:true,reason:'proactiveCheck',episodeId:'one'}).ok,true);
 assert.equal(f.service.preview({key,now:noon}).willingness,50);
 f.service.refresh({key,now:noon});assert.ok(f.jobs.size);f.service.cancel({key});assert.equal(f.jobs.size,0);
 assert.equal(f.service.allowsReason({reason:'timeout',now:noon}).allowed,false);
 assert.equal(f.service.allowsReason({reason:'replyCheck',now:noon,hasPendingHuman:true}).allowed,true);
 const night=Date.parse('2026-10-29T23:30:00+08:00');assert.equal(f.service.allowsReason({reason:'timeBubble',now:night}).allowed,false);assert.equal(f.service.allowsReason({reason:'reminder',now:night}).allowed,true);
});
