import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlugin, periodStart } from '../plugins/qq-components/life-token-budget/index.js';
import { createTokenLedger } from '../src/token-ledger.js';

const clock = (time) => Date.parse(`2026-10-28T${time}:00+08:00`);
assert.equal(periodStart(clock('21:59')), Date.parse('2026-10-27T22:00:00+08:00'));
assert.equal(periodStart(clock('22:00')), clock('22:00'));
assert.equal(periodStart(clock('22:01')), clock('22:00'));

let state = {};
const plugin = createPlugin({
  config: { globalHardLimitYuan: 3, sessions: { 'private:1': { coldLimitYuan: 1, hardLimitYuan: 2, weakMinIntervalMin: 30 } } },
  state: { get: () => state, set: (patch) => { state = { ...state, ...patch }; } }
});
const budget = plugin.services.tokenBudget;
assert.equal(budget.assess({ key: 'private:1', cost: 0.99, globalCost: 0.99 }).stage, 'normal');
assert.equal(budget.assess({ key: 'private:1', cost: 1, globalCost: 1 }).stage, 'weak');
assert.equal(budget.assess({ key: 'private:1', cost: 2, globalCost: 2 }).stage, 'silent');
assert.equal(budget.assess({ key: 'group:2', cost: 0, globalCost: 3 }).stage, 'silent');
assert.equal(budget.assess({ key: 'private:1', cost: 1.25, globalCost: 2.5 }).remainingYuan, 0.75);
assert.equal(budget.assess({ key: 'private:1', cost: 1.25, globalCost: 2.5 }).globalRemainingYuan, 0.5);
assert.equal(budget.canDispatch({ key: 'private:1', stage: 'weak', now: clock('22:00') }), true);
budget.noteDispatch({ key: 'private:1', stage: 'weak', now: clock('22:00') });
assert.equal(budget.canDispatch({ key: 'private:1', stage: 'weak', now: clock('22:29') }), false);
assert.equal(budget.canDispatch({ key: 'private:1', stage: 'weak', now: clock('22:30') }), true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-token-budget-'));
const file = path.join(dir, 'usage.jsonl');
try {
  const ledger = createTokenLedger({ file, resolveKey: (sid) => sid === 'a' ? 'private:1' : 'group:2' });
  const add = (sid, seq, at, turn = seq, step = 1) => ledger.ingestEvent({ sessionId: sid, at, model: 'deepseek-flash', event: {
    type: 'assistant/message', seq, data: { turn, step, usage: { inputTokens: 1_000_000, outputTokens: 100 } }
  } });
  add('a', 1, clock('21:59'));
  add('a', 2, clock('22:00'), 1, 2);
  add('b', 1, clock('22:01'));
  const privateUsage = ledger.periodUsage({ key: 'private:1', since: clock('22:00'), until: clock('22:02') });
  const allUsage = ledger.periodUsage({ since: clock('22:00'), until: clock('22:02') });
  assert.equal(privateUsage.turns, 1);
  assert.equal(privateUsage.steps, 2);
  assert.equal(allUsage.turns, 2);
  assert.equal(allUsage.steps, 3);
  assert.ok(allUsage.cost > privateUsage.cost);
} finally {
  fs.unlinkSync(file);
  fs.rmdirSync(dir);
}
console.log('token budget: period, tiers, global cap, weak interval and ledger scope passed');
