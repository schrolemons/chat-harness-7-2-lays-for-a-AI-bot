import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin, resolveApiKey } from '../index.js';
test('process keys take precedence; current-user keys are a fallback and never become result data', () => {
  assert.equal(resolveApiKey({ DEEP_SEEK_KEY: 'first' }, () => { throw Error('must not read registry'); }), 'first');
  assert.equal(resolveApiKey({ DEEPSEEK_API_KEY: 'second' }, () => { throw Error('must not read registry'); }), 'second');
  const calls=[];
  assert.equal(resolveApiKey({}, name => {calls.push(name);return name==='DEEPSEEK_API_KEY'?'local-user-key':'';}), 'local-user-key');
  assert.deepEqual(calls,['DEEP_SEEK_KEY','DEEPSEEK_API_KEY']);
});
async function fixture(data, run) {
  const previousFetch=globalThis.fetch, previousA=process.env.DEEP_SEEK_KEY, previousB=process.env.DEEPSEEK_API_KEY;
  process.env.DEEP_SEEK_KEY='synthetic-wallet-key';delete process.env.DEEPSEEK_API_KEY;
  const fetchImpl=async()=>new Response(JSON.stringify(data),{status:200});
  globalThis.fetch=fetchImpl;
  try {
    let spec;
    createPlugin({ registerTool: (_, value) => spec = value }, { env: { DEEP_SEEK_KEY: 'synthetic-wallet-key' }, readUserEnvironment: () => '', fetchImpl });
    return await run(spec);
  } finally {
    globalThis.fetch=previousFetch;
    if(previousA===undefined)delete process.env.DEEP_SEEK_KEY;else process.env.DEEP_SEEK_KEY=previousA;
    if(previousB===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previousB;
  }
}
const balance = (total, currency = 'CNY') => ({ currency, total_balance: total, granted_balance: '0.00', topped_up_balance: total });
test('funded account is explicitly the bots own wallet, with cheerful and confident expression', async () => {
  await fixture({ is_available: true, balance_infos: [balance('12.00')] },async tool=>{
  const result = await tool.handler();
  assert.match(tool.description, /自己的钱包/);
  assert.equal(result.wallet.state, 'funded'); assert.equal(result.wallet.perspective, '自己的钱包');
  assert.match(result.wallet.responseGuidance, /高兴/); assert.match(result.wallet.responseGuidance, /硬气/);
  assert.equal(result.balance_infos[0].total_balance, '12.00');
  assert.equal(JSON.stringify(result).includes('synthetic-wallet-key'), false);
  });
});
test('confirmed empty wallet invites an aggrieved, tearful reaction without inventing a balance', async () => {
  const result = await fixture({ is_available: false, balance_infos: [balance('0.00')] },tool=>tool.handler());
  assert.equal(result.wallet.state, 'empty');
  assert.match(result.wallet.responseGuidance, /委屈/); assert.match(result.wallet.responseGuidance, /哭/);
  assert.match(result.wallet.responseGuidance, /我的钱包/);
  assert.equal(result.balance_infos[0].total_balance, '0.00');
});
test('unavailable provider with a positive balance is still funded, with unavailability reported separately', async () => {
  const result = await fixture({ is_available: false, balance_infos: [balance('8.50')] },tool=>tool.handler());
  assert.equal(result.wallet.state, 'funded'); assert.equal(result.is_available, false);
  assert.match(result.wallet.responseGuidance, /当前.*不可用/);
});
test('missing or malformed balance is unknown, never a fabricated empty wallet', async () => {
  for (const balance_infos of [[], [{ currency: 'CNY' }], [balance('not-a-number')], [balance('0.00'), balance('?', 'USD')]]) {
    const result = await fixture({ is_available: false, balance_infos },tool=>tool.handler());
    assert.equal(result.wallet.state, 'unknown'); assert.match(result.wallet.responseGuidance, /无法确认/);
  }
});
test('currencies are kept separate and any exact positive decimal counts, without float underflow', async () => {
  const rows = [balance('-100.00'), balance('0.' + '0'.repeat(400) + '1', 'USD')];
  const result = await fixture({ is_available: true, balance_infos: rows },tool=>tool.handler());
  assert.equal(result.wallet.state, 'funded'); assert.deepEqual(result.balance_infos, rows);
});
test('failed queries have no invented wallet state or emotion', async () => {
  await fixture({},async()=>{
    let spec;delete process.env.DEEP_SEEK_KEY;delete process.env.DEEPSEEK_API_KEY;
    const fetchImpl=()=>{throw Error('must not request');};globalThis.fetch=fetchImpl;
    createPlugin({ registerTool: (_, value) => spec = value }, { env: {}, readUserEnvironment: () => '', fetchImpl });
    const result = await spec.handler(); assert.equal(result.ok, false); assert.equal(result.wallet, undefined);
  });
});
