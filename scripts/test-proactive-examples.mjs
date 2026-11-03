import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTimeBubbleSlots } from '../plugins/qq-components/life-proactive-time-bubble/schedule-locks.mjs';
import { createPlugin } from '../plugins/qq-components/life-schedule-reminder/index.js';

const examples = await import('../console/layers/L/proactive-examples.js').catch(() => ({}));
const now = new Date(2031, 11, 31, 23, 55).getTime();
const key = 'private:10001'; // Synthetic fixture; shipped templates carry no recipient.
function fixture({ slots = [], allLocked = false, cap = 3, items = [] } = {}) {
  const writes = [];
  let scheduleState = { items: structuredClone(items) };
  const schedules = createPlugin({ config: {}, state: { get: () => scheduleState, set: patch => { scheduleState = { ...scheduleState, ...patch }; } }, capabilities: {} }).services.schedules;
  const api = async (url, method = 'GET', body) => {
    if (url === '/api/socialV2/states') return { ok: true, conversations: [{ key }] };
    if (url.startsWith('/api/socialV2/time-bubbles?')) return { ok: true, all: slots, allLocked };
    if (url.startsWith('/api/plugins/detail?')) return { ok: true, plugin: { config: { maxBubblesPerDay: cap } } };
    if (url === '/api/socialV2/schedules') {
      assert.equal(body.action, 'appendIfAbsent', 'examples must not deduplicate through a truncated list or use ordinary evicting add');
      const result = schedules.appendIfAbsent(body);
      if (result.added) writes.push({ url, method, body });
      return result;
    }
    if (url === '/api/socialV2/time-bubbles' && method === 'POST') {
      assert.ok(Array.isArray(body.appendSlots), 'examples must use atomic append API');
      if (allLocked) return { ok: false, error: 'LOCKED_SCHEDULE' };
      const addedSlots = body.appendSlots.filter(slot => !slots.some(existing => existing.id === slot.id || (existing.hour === slot.hour && existing.minute === slot.minute)));
      if (slots.length + addedSlots.length > cap) return { ok: false, error: 'TIME_BUBBLE_CAPACITY' };
      writes.push({ url, method, body });
      slots = [...slots, ...addedSlots];
      return { ok: true, added: addedSlots.length, addedSlots, all: slots };
    }
    writes.push({ url, method, body });
    return { ok: true };
  };
  return { api, writes, get slots() { return slots; } };
}

test('catalog previews future dates across year boundaries without recipients or writes', () => {
  assert.equal(typeof examples.createProactiveExamples, 'function', 'missing shipped examples catalog');
  const catalog = examples.createProactiveExamples(now);
  const tomorrow = catalog.find(x => x.id === 'tomorrow-reminder');
  assert.equal(new Date(tomorrow.item.dueAt).getFullYear(), 2032);
  assert.equal(new Date(tomorrow.item.dueAt).getMonth(), 0);
  assert.equal(new Date(tomorrow.item.dueAt).getDate(), 1);
  assert.equal(new Date(tomorrow.item.dueAt).getHours(), 9);
  assert.equal(tomorrow.item.leadMinutes, 10);
  assert.equal(tomorrow.item.intervalMinutes, 30);
  const weekly = catalog.find(x => x.id === 'weekly-review');
  assert.equal(weekly.item.repeat, 'weekly');
  assert.equal(new Date(weekly.item.dueAt).getDay(), 0);
  assert.ok(weekly.item.dueAt - 10 * 60000 > now);
  assert.doesNotMatch(JSON.stringify(catalog), /(?:private|group):\d/);
  assert.deepEqual(catalog[0].slots.map(x => [x.hour, x.minute]), [[9, 0], [12, 30], [20, 30]]);
});

test('weekly review starts next week if this week reminder window has begun', () => {
  assert.equal(typeof examples.createProactiveExamples, 'function');
  const sunday = new Date(2032, 0, 4, 20, 25).getTime();
  const review = examples.createProactiveExamples(sunday).find(x => x.id === 'weekly-review');
  assert.equal(new Date(review.item.dueAt).getDate(), 11);
});

test('application requires opt-in and a currently existing selected conversation', async () => {
  assert.equal(typeof examples.applyProactiveExample, 'function', 'missing opt-in example application');
  let calls = 0;
  const api = async () => { calls++; return { ok: true, conversations: [] }; };
  for (const options of [{ key, optIn: false }, { key: '', optIn: true }]) {
    await assert.rejects(examples.applyProactiveExample({ templateId: 'daily-bubbles', now, api, ...options }));
  }
  assert.equal(calls, 0, 'invalid consent/selection must not touch APIs');
  await assert.rejects(examples.applyProactiveExample({ templateId: 'daily-bubbles', key, optIn: true, now, api }), /会话/);
  assert.equal(calls, 1, 'unknown target must never be created');
});

test('bubble application appends missing slots and preserves edited and locked examples', async () => {
  assert.equal(typeof examples.applyProactiveExample, 'function');
  const edited = { id: 'example-daily-morning-v1', hour: 10, minute: 0, label: 'Edited', locked: true, enabled: false };
  const f = fixture({ slots: [edited] });
  const result = await examples.applyProactiveExample({ templateId: 'daily-bubbles', key, optIn: true, now, api: f.api });
  assert.equal(result.added, 2);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.slots[0], edited);
  assert.equal(f.slots.length, 3);
  assert.equal(f.writes[0].body.key, key);
  assert.equal(f.writes[0].body.slots, undefined, 'never replace a stale whole-list snapshot');
  const second = fixture({ slots: f.slots });
  assert.equal((await examples.applyProactiveExample({ templateId: 'daily-bubbles', key, optIn: true, now, api: second.api })).added, 0);
  assert.deepEqual(second.slots[0], edited, 'repeat apply must not reset user edits');
});

test('locked/full bubble lists are never overwritten or truncated', async () => {
  assert.equal(typeof examples.applyProactiveExample, 'function');
  for (const options of [{ allLocked: true }, { slots: [{ id: 'custom', hour: 8, minute: 0 }], cap: 3 }]) {
    const f = fixture(options);
    await assert.rejects(examples.applyProactiveExample({ templateId: 'daily-bubbles', key, optIn: true, now, api: f.api }));
    assert.deepEqual(f.writes, []);
  }
});

test('applying examples cannot explicitly unlock a column locked after the initial read', async () => {
  const f = fixture();
  const api = async (url, method, body) => {
    if (method === 'POST' && url === '/api/socialV2/time-bubbles') {
      const merged = mergeTimeBubbleSlots([], body.appendSlots, { allLocked: true, proposedAllLocked: body.allLocked });
      return { ok: !merged.rejected, error: 'LOCKED_SCHEDULE' };
    }
    return f.api(url, method, body);
  };
  await assert.rejects(examples.applyProactiveExample({ templateId: 'daily-bubbles', key, optIn: true, now, api }), /LOCKED_SCHEDULE/);
});

test('schedule application uses existing API with future absolute time and keeps edited examples', async () => {
  assert.equal(typeof examples.applyProactiveExample, 'function');
  const f = fixture();
  await examples.applyProactiveExample({ templateId: 'tomorrow-reminder', key, optIn: true, now, api: f.api });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].url, '/api/socialV2/schedules');
  const payload = f.writes[0].body;
  assert.equal(payload.action, 'appendIfAbsent');
  assert.equal(payload.exampleId, 'tomorrow-reminder:v1');
  assert.equal(payload.key, key);
  assert.ok(payload.dueAt > now);
  assert.equal(payload.leadMinutes, 10);
  assert.equal(payload.intervalMinutes, 30);
  const existing = fixture({ items: [{ ...payload, title: 'Renamed by developer', dueAt: now + 9999999 }] });
  assert.equal((await examples.applyProactiveExample({ templateId: 'tomorrow-reminder', key, optIn: true, now, api: existing.api })).added, 0);
  assert.deepEqual(existing.writes, []);
});
