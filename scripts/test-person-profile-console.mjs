// Browser regression against synthetic, intercepted profile data; never touches the live bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startConsoleFixture } from './console-ui-fixture.mjs';

test('switching a profile cannot save stale fields into another person or accept an old read response', { timeout: 20000 }, async () => {
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe')].find(file => file && fs.existsSync(file));
  assert.ok(executablePath, 'Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to a Chromium browser');
  const fixture = await startConsoleFixture();
  let browser, releaseB, sawB;
  const pendingB = new Promise(resolve => { sawB = resolve; });
  const writes = [];
  const profiles = { '10001': { hobbies: '甲的字段', routine_food: '', relationships: '', catchphrases: '' },
    '10002': { hobbies: '乙的字段', routine_food: '', relationships: '', catchphrases: '' } };
  try {
    browser = await puppeteer.launch({ headless: true, executablePath });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (new URL(request.url()).origin !== fixture.url) return void request.abort();
      const url = new URL(request.url());
      const plugin = { id: 'ctx-memory-profile-store', name: '按 QQ 号 JSON 人物档案', layer: 'C', enabled: true, config: {}, tools: [] };
      if (url.pathname === '/api/plugins') return void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, plugins: [plugin] }) });
      if (url.pathname === '/api/plugins/detail' && url.searchParams.get('id') === plugin.id) return void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, plugin }) });
      let body;
      try { body = JSON.parse(request.postData() || '{}'); } catch {}
      if (new URL(request.url()).pathname !== '/api/plugins/call' || !body?.tool?.startsWith('profile_')) return void request.continue();
      const reply = result => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result }) });
      const id = body.input?.userId;
      if (body.tool === 'profile_snapshot') {
        const result = { ok: true, profiles: id ? { [id]: profiles[id] || {} } : profiles, people: {} };
        if (id === '10002' && !releaseB) { releaseB = () => reply(result); sawB(); return; }
        return void reply(result);
      }
      if (body.tool === 'profile_update') { writes.push(body.input); return void reply({ ok: true, profile: body.input.profile }); }
      return void reply({ ok: true });
    });
    await page.goto(fixture.url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.__renderComponentsByIds === 'function');
    await page.evaluate(async () => {
      const root = document.createElement('section'); root.id = 'profile-editor-test';
      document.getElementById('mainContent').prepend(root);
      await window.__renderComponentsByIds(['ctx-memory-profile-store'], root);
    });
    const scope = '#profile-editor-test ';
    await page.waitForSelector(scope + '.member-key option[value="10001"]');
    await page.select(scope + '.member-key', '10001');
    await page.waitForFunction(() => document.querySelector('#profile-editor-test textarea[data-profile-key="hobbies"]')?.value === '甲的字段');
    await page.select(scope + '.member-key', '10002'); await pendingB;
    assert.equal(await page.$eval(scope + '.profile-save', element => element.disabled), true, 'saving must be blocked while another person is loading');
    await page.select(scope + '.member-key', '10001');
    await page.waitForFunction(() => document.querySelector('#profile-editor-test textarea[data-profile-key="hobbies"]')?.value === '甲的字段');
    await releaseB(); await page.waitForNetworkIdle({ idleTime: 100, timeout: 5000 });
    assert.equal(await page.$eval(scope + '.profile-qq', element => element.value), '10001');
    assert.equal(await page.$eval(scope + 'textarea[data-profile-key="hobbies"]', element => element.value), '甲的字段');
    await page.click(scope + '.profile-save');
    await page.waitForFunction(() => document.querySelector('#profile-editor-test .profile-status')?.textContent.includes('已保存'));
    assert.equal(writes.length, 1); assert.equal(writes[0].userId, '10001'); assert.equal(writes[0].profile.hobbies, '甲的字段');
  } finally { if (releaseB) await releaseB().catch(() => {}); await browser?.close(); await fixture.close(); }
});
