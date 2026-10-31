import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer-core';
import { handoffToHeadless, classifySnapshot } from './campus-browser-session.mjs';

test('isolated Edge profile preserves a synthetic session and localStorage across headed to headless handoff', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-handoff-'));
  const server = http.createServer((request, response) => {
    if (request.url === '/grant') {
      response.setHeader('set-cookie', 'session=synthetic-session; HttpOnly; SameSite=Lax; Path=/');
      response.end('<script>localStorage.setItem("synthetic", "same-profile")</script><main>已登录，合成课程</main>');
    } else if ((request.headers.cookie || '').includes('session=synthetic-session')) {
      response.end('<main>合成课程资源</main>');
    } else { response.statusCode = 401; response.end('<main>请登录</main>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const executablePath = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(file => fs.existsSync(file));
  assert.ok(executablePath, 'Edge executable must exist for this Windows regression');
  let browser;
  t.after(async () => {
    await browser?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  });
  const launch = headless => puppeteer.launch({ executablePath, userDataDir: path.join(root, 'profile'), headless,
    args: ['--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--window-position=-32000,-32000', '--window-size=600,400'] });
  browser = await launch(false);
  assert.doesNotMatch(await browser.userAgent(), /Headless/);
  const processHandle = browser.process();
  const page = await browser.newPage();
  await page.goto(origin + '/grant');
  const jar = path.join(root, 'cookies.json');
  const result = await handoffToHeadless({ browser, owned: true, jar,
    waitStopped: async () => { if (processHandle.exitCode === null) await new Promise(resolve => processHandle.once('exit', resolve)); },
    launch: () => launch(true),
    verify: async background => {
      browser = background;
      const target = await background.newPage();
      try {
        const response = await target.goto(origin + '/private');
        assert.equal(response.status(), 200);
        assert.equal(await target.evaluate(() => localStorage.getItem('synthetic')), 'same-profile');
        const snapshot = await target.evaluate(() => ({ url: location.href, text: document.body.innerText }));
        return classifySnapshot(snapshot, origin + '/private') === 'ready';
      } finally { await target.close(); }
    }
  });
  browser = result.browser;
  assert.match(await browser.userAgent(), /Headless/);
  assert.equal(result.transitioned, true);
  const cookies = JSON.parse(fs.readFileSync(jar, 'utf8'));
  assert.equal(cookies.find(cookie => cookie.name === 'session').session, true);
});
