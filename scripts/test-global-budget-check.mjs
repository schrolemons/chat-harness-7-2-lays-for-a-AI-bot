import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertGlobalBudgetAllowsModel } from '../plugins/qq-components/life-campus-watch/summarizer.mjs';

test('independent web summarizer refuses LLM when global cap is reached or unknown', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-summary-'));
  fs.mkdirSync(path.join(root, 'state'));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ consolePort: 3100, consoleToken: 'fixture-console-token' }));
  const checked = [];
  const fetchImpl = async (url, options) => {
    checked.push({ url: String(url), token: options.headers['x-console-token'] });
    return { ok: true, json: async () => ({ ok: true, global: { limit: 30, cost: 29, reached: false } }) };
  };
  try {
    await assertGlobalBudgetAllowsModel(root, { fetchImpl });
    assert.equal(checked.length, 1);
    assert.equal(checked[0].token, 'fixture-console-token');
    await assert.rejects(assertGlobalBudgetAllowsModel(root, { fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, global: { limit: 30, cost: 30, reached: true } }) }) }), /额度/);
    await assert.rejects(assertGlobalBudgetAllowsModel(root, { fetchImpl: async () => { throw Error('offline'); } }), /额度/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
