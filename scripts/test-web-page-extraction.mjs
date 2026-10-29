import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { restoreCookies, classifySnapshot } from './campus-browser-session.mjs';
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

test('cookie restore uses browser context without initializing restored stale tabs', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-context-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const jar = path.join(root, 'cookies.json'); fs.writeFileSync(jar, JSON.stringify([{ name: 'test', value: 'example', domain: 'example.test' }]));
  const calls = [];
  await restoreCookies({ pages: async () => { throw Error('restored stale target'); }, newPage: async () => { throw Error('must not create a tab'); }, defaultBrowserContext: () => ({ setCookie: async (...cookies) => calls.push(...cookies) }) }, jar);
  assert.deepEqual(calls.map(cookie => cookie.name), ['test']);
});

test('actual extractor classifies same-URL password and SSO prompts without treating course prose as login', async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => request.respond({ status: 200, contentType: 'text/html', body: '<main>course</main>' }));
    await page.goto('https://synthetic.example/course');
    await page.setContent('<main><h1>Account</h1><h2>Sign in</h2><form><label>Username<input autocomplete="username"></label><label>Password<input type="password"></label><button>Sign in</button></form></main>');
    const password = await page.evaluate(extractPageSnapshot);
    assert.equal(password.url, 'https://synthetic.example/course');
    assert.equal(classifySnapshot(password, password.url), 'login');
    await page.setContent('<main><h1>Sign in</h1><p>Continue using your university account</p><a role="button" href="/sso">Continue with university</a></main>');
    const sso = await page.evaluate(extractPageSnapshot);
    assert.equal(classifySnapshot(sso, sso.url), 'login');
    await page.setContent('<header><a href="/sso">Sign in</a></header><main><h1>Course resources</h1><p>The lecture explains the sign-in protocol and username/password security.</p><a href="/notes">Download notes</a></main>');
    const course = await page.evaluate(extractPageSnapshot);
    assert.equal(classifySnapshot(course, course.url), 'ready');
    await page.setContent('<main><h1>Sign-in protocol</h1><p>Course notes cover account authentication.</p><form><input type="search"><button>Search</button></form><input type="password" hidden></main>');
    const notes = await page.evaluate(extractPageSnapshot);
    assert.equal(classifySnapshot(notes, notes.url), 'ready');
  } finally { await browser.close(); }
});
