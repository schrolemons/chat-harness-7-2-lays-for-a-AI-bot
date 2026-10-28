import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import vm from 'node:vm';
import { extractPageSnapshot } from '../plugins/qq-components/life-campus-watch/web-changes.mjs';
import { apply as restrictSummaryTools } from '../plugins/qq-agent-presets/summary-tool-restrict.mjs';

test('real rendered HTML: keep course content and URLs, excluding header/navigation/footer', async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<header>我的主页</header><nav>课程菜单</nav><main><h1>课程资源</h1><p>新增作业一</p><a href="https://example.test/slides.pdf">分布式算法课件一</a><footer>实验室宣传<a href="https://lab.test/">访问主页</a></footer></main>');
    const data = await page.evaluate(extractPageSnapshot);
    assert.ok(data.lines.includes('新增作业一'));
    assert.ok(data.lines.includes('分布式算法课件一'));
    assert.doesNotMatch(data.text, /我的主页|课程菜单|实验室宣传|访问主页/);
    assert.deepEqual(data.links, [{ t: '分布式算法课件一', h: 'https://example.test/slides.pdf' }]);
    await page.setContent('<div id="contentPanel"><nav>菜单管理选项</nav><div id="content_listContainer"><h2>作业二</h2><p>截止2026-11-01</p></div><p>编辑页面</p></div>');
    const blackboard = await page.evaluate(extractPageSnapshot);
    assert.deepEqual(blackboard.lines, ['作业二', '截止2026-11-01']);
  } finally { await browser.close(); }
});

test('summary preset exposes no tools and rejects every attempted tool execution', () => {
  let restriction, guard;
  restrictSummaryTools({ tools: { restrict: value => restriction = value, guard: value => guard = value } });
  assert.deepEqual(restriction, { allow: [] });
  assert.equal(typeof guard({ name: 'pwsh' }), 'string');
  assert.equal(typeof guard({ name: 'mcp__snowluma__qq_send_message' }), 'string');
});

test('cookie setup never initializes restored stale tabs and always closes its own temporary page', async () => {
  const source = fs.readFileSync(new URL('./campus-watch.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function injectCookies(browser)'), source.indexOf('\nasync function fetchPage('));
  const calls = [];
  const context = vm.createContext({ ROOT: '.', path: { join: () => 'cookie-jar' }, fs: { existsSync: () => true, readFileSync: () => JSON.stringify([{name: 'test', value: 'example', domain: 'example.test'}]) } });
  vm.runInContext(code, context);
  const page = { createCDPSession: async () => ({ send: async method => calls.push(method), detach: async () => {} }), close: async () => calls.push('close') };
  await context.injectCookies({ pages: async () => { throw Error('restored stale target'); }, newPage: async () => page });
  assert.ok(calls.includes('Network.setCookie'));
  assert.ok(calls.includes('close'));
});
