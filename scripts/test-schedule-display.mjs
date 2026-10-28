// Pure component tests: synthetic in-memory records, no live bridge or QQ calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlugin } from '../plugins/qq-components/life-schedule-reminder/index.js';

const NOW = Date.parse('2030-01-08T12:00:00Z');
const DAY = 86400000;
const record = (id, offset, extra = {}) => ({
  id, key: 'group:1', title: id, dueAt: NOW + offset, repeat: 'none', createdAt: NOW - DAY, ...extra
});

function fixture(items) {
  let stored = structuredClone({ items });
  const blocks = [];
  const plugin = createPlugin({
    config: { enabled: true },
    state: { get: () => structuredClone(stored), set: (patch) => { stored = { ...stored, ...patch }; } },
    addPromptBlock: (block) => blocks.push(block),
    capabilities: { requestReminderWake: () => { throw Error('display must not wake'); } }
  });
  return { plugin, service: plugin.services.schedules, blocks, stored: () => structuredClone(stored) };
}

function atNow(run) {
  const original = Date.now;
  Date.now = () => NOW;
  try { run(); } finally { Date.now = original; }
}

test('default lists omit occurred, cancelled and completed schedules before any tick', () => atNow(() => {
  const f = fixture([
    record('past-unprocessed', -1), record('at-boundary', 0), record('future', DAY),
    record('cancelled', DAY, { cancelledAt: NOW - 1 }),
    record('completed', DAY, { completedAt: NOW - 1 }),
    record('expired', DAY, { expired: true }), record('status-done', DAY, { status: 'completed' }),
    record('other-conversation', DAY, { key: 'private:2' })
  ]);
  assert.deepEqual(f.service.list({ key: 'group:1' }).items.map((x) => x.id), ['future']);
  assert.deepEqual(f.service.listAll().conversations.map((c) => [c.key, c.items.map((x) => x.id)]), [
    ['group:1', ['future']], ['private:2', ['other-conversation']]
  ]);
}));

test('an advance reminder does not hide a future event', () => atNow(() => {
  const f = fixture([record('already-reminded', 600000, { firedAt: NOW - 1000 })]);
  assert.equal(f.service.list({ key: 'group:1' }).count, 1);
  f.plugin.hooks.beforePrompt({ key: 'group:1', reason: 'message' });
  assert.match(f.blocks.join('\n'), /already-reminded/);
}));

test('an overdue first reminder is shown as due now instead of repeating the past start time', () => atNow(() => {
  const f = fixture([record('missed-first-reminder', 0, { leadMinutes: 30, intervalMinutes: 30 })]);
  const item = f.service.list({ key: 'group:1' }).items[0];
  assert.equal(item.remindAt, NOW - 30 * 60000);
  assert.equal(item.nextReminderAt, NOW);
}));

test('recurring lists project the next occurrence without rewriting persistent records', () => atNow(() => {
  const f = fixture([
    record('daily', -2 * DAY, { repeat: 'daily' }),
    record('weekly', -8 * DAY, { repeat: 'weekly' })
  ]);
  const before = f.stored();
  const items = f.service.list({ key: 'group:1' }).items;
  assert.deepEqual(items.map((x) => [x.id, x.dueAt]), [['daily', NOW + DAY], ['weekly', NOW + 6 * DAY]]);
  assert.deepEqual(f.service.listAll().conversations[0].items, items);
  assert.deepEqual(f.stored(), before);
}));

test('explicit history returns original records and display never deletes them', () => atNow(() => {
  const f = fixture([record('past', -DAY), record('reminded', -1000, { firedAt: NOW - DAY }),
    record('recurring', -DAY, { repeat: 'daily' })]);
  const before = f.stored();
  assert.deepEqual(f.service.list({ key: 'group:1', includePast: true }).items.map((x) => [x.id, x.dueAt]), [
    ['past', NOW - DAY], ['recurring', NOW - DAY], ['reminded', NOW - 1000]
  ]);
  assert.equal(f.service.listAll({ includePast: true }).conversations[0].items.length, 3);
  assert.deepEqual(f.stored(), before);
}));

test('prompt uses upcoming projection and excludes occurred or terminal entries', () => atNow(() => {
  const f = fixture([record('old-entry', -1000), record('finished-entry', DAY, { completedAt: NOW }),
    record('next-entry', DAY), record('recurrence-entry', -DAY, { repeat: 'daily' }),
    record('outside-horizon', 20 * DAY)]);
  f.plugin.hooks.beforePrompt({ key: 'group:1', reason: 'message' });
  const prompt = f.blocks.join('\n');
  assert.match(prompt, /next-entry/);
  assert.match(prompt, /recurrence-entry/);
  assert.doesNotMatch(prompt, /old-entry|finished-entry|outside-horizon/);
}));
