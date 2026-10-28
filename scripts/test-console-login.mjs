import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const loginHtml = fs.readFileSync(new URL('../public/console-login.html', import.meta.url), 'utf8');
const consoleHtml = fs.readFileSync(new URL('../public/console.html', import.meta.url), 'utf8');
const loginScript = loginHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
const rememberScript = consoleHtml.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*async function api/)[1];

function run(code, href, storage, answer = null) {
  const result = { redirects: [], prompts: [], replaced: [] };
  const parsed = new URL(href);
  vm.runInNewContext(code, {
    URL, URLSearchParams,
    location: { href, search: parsed.search, pathname: parsed.pathname, hash: parsed.hash,
      replace: value => result.redirects.push(value) },
    localStorage: storage,
    history: { replaceState: (_state, _title, url) => result.replaced.push(url) },
    prompt: message => { result.prompts.push(message); return answer; }
  });
  return result;
}
function storage(initial) {
  const values = new Map(initial ? [['consoleToken', initial]] : []);
  return { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('刷新入口自动复用保存的令牌，保留页面 hash，不弹框', () => {
  const result = run(loginScript, 'http://127.0.0.1:3100/#usage', storage('saved-token'));
  assert.deepEqual(result.redirects, ['/?token=saved-token#usage']);
  assert.equal(result.prompts.length, 0);
});

test('失效的保存令牌仅自动尝试一次，拒绝后清理并允许重新输入', () => {
  const saved = storage('expired');
  const first = run(loginScript, 'http://127.0.0.1:3100/', saved);
  const second = run(loginScript, 'http://127.0.0.1:3100' + first.redirects[0], saved, '  replacement  ');
  assert.equal(second.prompts.length, 1);
  assert.equal(saved.getItem('consoleToken'), null);
  assert.deepEqual(second.redirects, ['/?token=replacement']);
  assert.deepEqual(second.replaced, ['/']);
});

test('旧链接中的失效令牌不会覆盖另一个标签页保存的新令牌', () => {
  const result = run(loginScript, 'http://127.0.0.1:3100/?token=old', storage('new'));
  assert.deepEqual(result.redirects, ['/?token=new']);
  assert.equal(result.prompts.length, 0);
});

test('首次输入和取消不会产生自动重定向循环', () => {
  const empty = storage();
  assert.deepEqual(run(loginScript, 'http://127.0.0.1:3100/', empty).redirects, []);
  const result = run(loginScript, 'http://127.0.0.1:3100/', empty, ' first-token ');
  assert.deepEqual(result.redirects, ['/?token=first-token']);
  assert.equal(empty.getItem('consoleToken'), null, 'wait for server acceptance before persisting');
});

test('浏览器禁用存储时入口仍可询问令牌', () => {
  const denied = { getItem() { throw new Error('denied'); } };
  assert.equal(run(loginScript, 'http://127.0.0.1:3100/', denied).prompts.length, 1);
});

test('真实 HTTP 首页连续刷新复用凭据，API 仍拒绝空令牌和错误令牌', async () => {
  const h = await bridgeHarness({ files: {
    'public/console-login.html': loginHtml,
    'public/console.html': consoleHtml
  } });
  const server = h.startConsoleServer();
  try {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const saved = storage('fixture-console-token');
    for (let i = 0; i < 3; i++) {
      const entry = await fetch(origin + '/#usage');
      assert.equal(entry.status, 401);
      const html = await entry.text();
      const result = run(html.match(/<script>([\s\S]*?)<\/script>/)[1], origin + '/#usage', saved);
      assert.equal(result.prompts.length, 0);
      const page = await fetch(origin + result.redirects[0]);
      assert.equal(page.status, 200);
      const remembered = run(rememberScript, origin + result.redirects[0], saved);
      assert.deepEqual(remembered.replaced, ['/#usage']);
      assert.equal(saved.getItem('consoleToken'), 'fixture-console-token');
      await page.text();
    }
    assert.equal((await fetch(origin + '/api/status')).status, 401);
    assert.equal((await fetch(origin + '/api/status', { headers: { 'x-console-token': 'invalid' } })).status, 401);
    assert.equal((await fetch(origin + '/api/status', { headers: { 'x-console-token': 'fixture-console-token' } })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await h.close();
  }
});
