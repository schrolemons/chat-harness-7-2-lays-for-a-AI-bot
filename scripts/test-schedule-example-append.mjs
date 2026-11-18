import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/life-schedule-reminder/index.js';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const key = 'private:123';
const dueAt = Date.now() + 7 * 86400000;
const item = (n, extra = {}) => ({ id: 'real-' + n, key, title: 'Real item ' + n, dueAt: dueAt + n * 60000, ...extra });
const payload = { key, exampleId: 'weekly-review:v1', title: 'Example review', dueAt, leadMinutes: 10, intervalMinutes: 30, repeat: 'weekly' };
function fixture(items, maxItems = 200) {
  let state = { items: structuredClone(items) };
  const plugin = createPlugin({ config: { maxItems }, state: { get: () => state, set: patch => { state = { ...state, ...patch }; } }, capabilities: {} });
  return { service: plugin.services.schedules, read: () => state.items };
}

test('example append refuses full capacity without evicting or changing any real item', () => {
  const original = Array.from({ length: 10 }, (_, n) => item(n));
  const f = fixture(original, 10);
  assert.equal(typeof f.service.appendIfAbsent, 'function', 'missing safe example append');
  const result = f.service.appendIfAbsent(payload);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'SCHEDULE_CAPACITY');
  assert.deepEqual(f.read(), original);
});

test('stable example identity scans all items and keeps customized item 101 despite changed title/date/detail', () => {
  const customized = item(100, { exampleId: 'weekly-review:v1', title: 'Customized review', dueAt: dueAt + 99999999, detail: 'My edited note', leadMinutes: 47 });
  const original = [...Array.from({ length: 100 }, (_, n) => item(n)), customized];
  const f = fixture(original, 101);
  assert.equal(typeof f.service.appendIfAbsent, 'function');
  const result = f.service.appendIfAbsent(payload);
  assert.equal(result.added, 0, 'existing identity wins even at full capacity');
  assert.equal(result.item.title, 'Customized review');
  assert.deepEqual(f.read(), original);
});

test('same-tick example appends are idempotent and store identity independently of editable content', () => {
  const f = fixture([]);
  assert.equal(typeof f.service.appendIfAbsent, 'function');
  const first = f.service.appendIfAbsent(payload);
  const second = f.service.appendIfAbsent({ ...payload, title: 'Changed request', dueAt: dueAt + 86400000 });
  assert.equal(first.added, 1);
  assert.equal(second.added, 0);
  assert.equal(f.read().length, 1);
  assert.equal(f.read()[0].exampleId, 'weekly-review:v1');
  assert.equal(f.read()[0].title, 'Example review');
});

test('legacy example marker remains idempotent without changing existing content', () => {
  const original = [item(1, { detail: 'Edited note [example:weekly-review:v1]' })];
  const f = fixture(original);
  assert.equal(typeof f.service.appendIfAbsent, 'function');
  assert.equal(f.service.appendIfAbsent(payload).added, 0);
  assert.deepEqual(f.read(), original);
});

test('real appendIfAbsent HTTP action rejects concurrent overflow and keeps all preexisting records', async t => {
  const original = Array.from({ length: 9 }, (_, n) => item(n));
  const h = await bridgeHarness({ files: { 'state/plugins/config/life-schedule-reminder.json': { maxItems: 10 }, 'state/plugins/life-schedule-reminder.json': { items: original } } });
  h.setMode('reserved2');
  h.getSocialV2State(key);
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await h.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/socialV2/schedules?token=fixture-console-token`;
  const post = async body => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, ...(await response.json()) };
  };
  const outcomes = await Promise.all(['weekly-review:v1', 'tomorrow-reminder:v1'].map(exampleId => post({ ...payload, exampleId, title: exampleId, action: 'appendIfAbsent' })));
  assert.deepEqual(outcomes.map(x => x.status).sort(), [200, 409]);
  assert.equal(outcomes.find(x => !x.ok).error, 'SCHEDULE_CAPACITY');
  const stored = h.pluginHost.get('life-schedule-reminder').state.items;
  assert.equal(stored.length, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.slice(0, 9))), original);
  const accepted = outcomes.find(x => x.ok);
  const retry = await post({ ...payload, exampleId: accepted.item.exampleId, action: 'appendIfAbsent' });
  assert.equal(retry.added, 0);
  assert.equal(h.calls.sent.length, 0);
});
