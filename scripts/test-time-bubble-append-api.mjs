import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

async function open(t) {
  const h = await bridgeHarness();
  h.setMode('reserved2');
  h.getSocialV2State('private:123');
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await h.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/socialV2/time-bubbles?token=fixture-console-token`;
  return {
    h,
    async post(body) {
      const response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'private:123', ...body }) });
      return { status: response.status, ...(await response.json()) };
    },
    async get() { return (await fetch(base + '&key=private%3A123')).json(); }
  };
}
const slot = (id, hour, extras = {}) => ({ id, hour, minute: 0, label: id, enabled: true, locked: false, ...extras });

test('atomic append keeps latest slots and locked edits, skips existing IDs/times, and rejects cap overflow', async t => {
  const f = await open(t);
  await f.post({ slots: [slot('custom', 8, { locked: true, hint: 'Keep this edit' })] });
  const added = await f.post({ appendSlots: [slot('new', 12), slot('custom', 9), slot('same-clock', 8)] });
  assert.equal(added.status, 200);
  assert.equal(added.added, 1);
  assert.deepEqual(added.addedSlots.map(x => x.id), ['new']);
  assert.deepEqual(added.all.map(x => x.id), ['custom', 'new']);
  assert.equal(added.all[0].locked, true);
  assert.equal(added.all[0].hint, 'Keep this edit');
  assert.equal(added.all[0].hour, 8);
  assert.equal((await f.post({ appendSlots: [slot('third', 20)] })).added, 1);
  const overflow = await f.post({ appendSlots: [slot('fourth', 21)] });
  assert.equal(overflow.status, 409);
  assert.equal(overflow.error, 'TIME_BUBBLE_CAPACITY');
  assert.deepEqual((await f.get()).all.map(x => x.id), ['custom', 'new', 'third']);
  assert.equal((await f.post({ appendSlots: [slot('new', 15)] })).added, 0);
  assert.equal((await f.get()).all[1].hour, 12);
  assert.equal(f.h.calls.sent.length, 0);
});

test('concurrent append requests serialize against current state without dropping either addition', async t => {
  const f = await open(t);
  const outcomes = await Promise.all([f.post({ appendSlots: [slot('a', 9)] }), f.post({ appendSlots: [slot('b', 12)] })]);
  assert.ok(outcomes.every(x => x.ok && x.added === 1));
  assert.deepEqual((await f.get()).all.map(x => x.id).sort(), ['a', 'b']);
});

test('append never unlocks a column and invalid/mixed append payloads cannot erase existing rows', async t => {
  const f = await open(t);
  await f.post({ slots: [slot('keep', 8)], allLocked: true });
  const locked = await f.post({ appendSlots: [slot('new', 9)], allLocked: false });
  assert.equal(locked.status, 409);
  assert.equal(locked.error, 'LOCKED_SCHEDULE');
  assert.equal((await f.get()).allLocked, true);
  await f.post({ slots: [slot('keep', 8)], allLocked: false });
  for (const body of [{ appendSlots: null }, { appendSlots: [], reset: true }, { appendSlots: [slot('x', 9)], slots: [] }, { appendSlots: [{ id: 'bad', hour: 25, minute: 0 }] }]) {
    assert.equal((await f.post(body)).status, 400);
    assert.deepEqual((await f.get()).all.map(x => x.id), ['keep']);
  }
});
