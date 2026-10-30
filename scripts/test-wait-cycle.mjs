import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../plugins/qq-components/life-conversation-wait/index.js');
function fixture(createPlugin, config = {}) {
  let state = {};
  const ctx = { config, state: { get: () => state, set: patch => Object.assign(state, patch) } };
  return { ctx, service: createPlugin(ctx).services.waitCycle };
}
test('private and group empty waits progress 50/75/100 and terminal decisions are latched', async () => {
  const { createPlugin } = await load();
  for (const key of ['private:123', 'group:456']) {
    const f = fixture(createPlugin), args = { key, scope: key + ':turn:1', seq: 9 };
    assert.equal(f.service.read(args).endRound, false);
    for (const probability of [50, 75, 100]) {
      const verdict = f.service.timeout({ ...args, random: () => .999999 });
      assert.equal(verdict.probabilityPercent, probability);
      assert.equal(verdict.endRound, probability === 100);
    }
    assert.equal(f.service.timeout({ ...args, random: () => 0 }).emptyWaits, 3);
    assert.equal(createPlugin(f.ctx).services.waitCycle.read(args).endRound, true, 'reload cannot reset a closed chain');
  }
});
test('an early successful decision closes immediately; new inbound opens a fresh chain; new turn is independent', async () => {
  const { createPlugin } = await load();
  const f = fixture(createPlugin), args = { key: 'private:123', scope: 'session-a:turn:1', seq: 2 };
  assert.equal(f.service.timeout({ ...args, random: () => .1 }).endRound, true);
  assert.equal(f.service.read({ ...args, seq: 3 }).endRound, false);
  assert.equal(f.service.timeout({ ...args, seq: 3, random: () => .9 }).probabilityPercent, 50);
  assert.equal(f.service.read({ ...args, scope: 'session-a:turn:2', seq: 3 }).emptyWaits, 0);
});
test('new arrival at timeout boundary prevents a no-message verdict; quiet reads never count', async () => {
  const { createPlugin } = await load();
  const f = fixture(createPlugin), args = { key: 'group:456', scope: 'session:turn:1', seq: 5 };
  f.service.timeout({ ...args, random: () => .99 });
  assert.equal(f.service.timeout({ ...args, seq: 6, startSeq: 5, random: () => 0 }).endRound, false);
  for (let n = 0; n < 20; n++) assert.equal(f.service.read({ ...args, seq: 6 }).emptyWaits, 0);
});
test('q must grow, p/q boundaries validated; p=0 and p=100 both terminate finitely', async () => {
  const { createPlugin } = await load();
  for (const p of [0, 100]) {
    const f = fixture(createPlugin, { endProbabilityPercent: p, probabilityStepPercent: 25 });
    let verdict;
    for (let n = 0; n < 5; n++) verdict = f.service.timeout({ key: 'private:1', scope: 'x', seq: 0, random: () => .99999 });
    assert.equal(verdict.endRound, true);
  }
  for (const config of [{ probabilityStepPercent: 0 }, { endProbabilityPercent: -1 }, { probabilityStepPercent: NaN }]) {
    assert.equal(createPlugin(fixture(createPlugin).ctx).validateConfig(config).ok, false);
  }
});
