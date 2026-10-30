import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../index.js';

function setup() {
  let tool;
  createPlugin({ registerTool(name, spec) { tool = { name, ...spec }; } }, {readUserEnvironment:()=>''});
  return tool;
}

test('deepseek_balance queries the official endpoint using DEEP_SEEK_KEY and returns balance fields', async () => {
  const previous = process.env.DEEP_SEEK_KEY;
  process.env.DEEP_SEEK_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.00', granted_balance: '2.00', topped_up_balance: '10.00' }] }), { status: 200 });
  };
  try {
    const tool = setup();
    assert.equal(tool.name, 'deepseek_balance');
    const result=await tool.handler({});
    const {wallet,...account}=result;
    assert.equal(wallet.state,'funded');
    assert.deepEqual(account, {
      ok: true,
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '12.00', granted_balance: '2.00', topped_up_balance: '10.00' }]
    });
    assert.equal(request.url, 'https://api.deepseek.com/user/balance');
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    assert.equal(request.options.headers.Accept, 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.DEEP_SEEK_KEY;
    else process.env.DEEP_SEEK_KEY = previous;
  }
});

test('deepseek_balance reports a missing key without making a request', async () => {
  const previousA = process.env.DEEP_SEEK_KEY;
  const previousB = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEP_SEEK_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('unexpected request'); };
  try {
    assert.deepEqual(await setup().handler({}), { ok: false, error: 'DEEP_SEEK_KEY 或 DEEPSEEK_API_KEY 环境变量未设置。' });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousA !== undefined) process.env.DEEP_SEEK_KEY = previousA;
    if (previousB !== undefined) process.env.DEEPSEEK_API_KEY = previousB;
  }
});

test('deepseek_balance reports upstream HTTP errors without exposing credentials', async () => {
  const previous = process.env.DEEP_SEEK_KEY;
  process.env.DEEP_SEEK_KEY = 'never-echo-this';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"error":"invalid key"}', { status: 401 });
  try {
    const result = await setup().handler({});
    assert.deepEqual(result, { ok: false, error: 'DeepSeek 余额接口返回 HTTP 401。' });
    assert.equal(JSON.stringify(result).includes('never-echo-this'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.DEEP_SEEK_KEY;
    else process.env.DEEP_SEEK_KEY = previous;
  }
});
