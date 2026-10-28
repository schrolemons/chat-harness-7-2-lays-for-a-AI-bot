import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDshProcessIds, parseNetstatPorts, probeDsh, discoverDsh } from './start-da-feiyu.mjs';
const ok = value => ({ result: { ok: true, value } });

test('只优先选择 DSH 进程拥有的监听端口，兼容本地化和 IPv6', () => {
  const pids = parseDshProcessIds('"DeepSeek Harness.exe","123","Console","1","1 K"\n"node.exe","456","Console","1","1 K"');
  assert.deepEqual([...pids], [123]);
  const rows = ' TCP 127.0.0.1:5000 0.0.0.0:0 LISTENING 123\n TCP [::1]:5001 [::]:0 侦听 123\n TCP 127.0.0.1:6000 0.0.0.0:0 LISTENING 456\n TCP 127.0.0.1:3199 0.0.0.0:0 LISTENING 123';
  assert.deepEqual(parseNetstatPorts(rows, pids), [5000, 5001]);
  assert.deepEqual(parseNetstatPorts(rows), [5000, 5001, 6000]);
});

test('无关或未鉴权端口只探测一次预设接口，不逐个查询历史会话', async () => {
  const calls = [];
  const result = await probeDsh('http://127.0.0.1:5000', ['a', 'b', 'c', 'd'], () => ({
    callUnary: async method => { calls.push(method); throw Error('unauthorized'); }
  }));
  assert.equal(result.score, 0);
  assert.deepEqual(calls, ['agentPresets.list']);
});

test('普通 JSON 服务不能冒充有效的 DSH 预设接口', async () => {
  const result = await probeDsh('http://127.0.0.1:5000', [], () => ({ callUnary: async () => ok({}) }));
  assert.equal(result.score, 0);
});

test('先验证预设，再保留已知会话归属证据', async () => {
  const calls = [];
  const result = await probeDsh('http://127.0.0.1:5000', ['a', 'b', 'c'], () => ({
    callUnary: async method => {
      calls.push(method);
      return ok(method === 'agentPresets.list' ? { presets: [{ id: 'qq-chat' }] } : { values: { title: 'known' } });
    }
  }));
  assert.equal(result.score, 2); assert.equal(result.sessions, 2); assert.equal(result.presets, 1);
  assert.deepEqual(calls, ['agentPresets.list', 'session/projections', 'session/projections']);
});

test('可用 DSH 的历史会话已删除时仍保留通用候选', async () => {
  const result = await probeDsh('http://127.0.0.1:5000', ['deleted'], () => ({
    callUnary: async method => {
      if (method === 'agentPresets.list') return ok({ presets: [] });
      throw Error('not found');
    }
  }));
  assert.equal(result.score, 1); assert.equal(result.sessions, 0);
});

test('配置端口过期时直接命中 DSH 进程新端口，不枚举无关服务', async () => {
  const calls = [], remembered = [];
  const result = await discoverDsh({ dsh: { baseUrl: 'http://127.0.0.1:4999' } }, {
    sessionIds: ['known'], preferredPorts: () => [5000],
    probe: async url => { calls.push(url); return { baseUrl: url, score: url.endsWith(':5000') ? 2 : 0, sessions: 2 }; },
    allPorts: () => { throw Error('unrelated listeners must not be scanned'); },
    remember: url => remembered.push(url)
  });
  assert.equal(result.baseUrl, 'http://127.0.0.1:5000');
  assert.deepEqual(calls, ['http://127.0.0.1:4999', 'http://127.0.0.1:5000']);
  assert.deepEqual(remembered, ['http://127.0.0.1:5000']);
});

test('无法识别 DSH 进程时仍回退扫描，并优先选择持有会话的实例', async () => {
  const result = await discoverDsh({ dsh: {} }, {
    sessionIds: ['known'], preferredPorts: () => [], allPorts: () => [5001],
    loadCache: () => ['http://127.0.0.1:5000'], remember: () => {},
    probe: async url => ({ baseUrl: url, score: url.endsWith(':5001') ? 2 : 1, sessions: url.endsWith(':5001') ? 2 : 0 })
  });
  assert.equal(result.baseUrl, 'http://127.0.0.1:5001');
});
