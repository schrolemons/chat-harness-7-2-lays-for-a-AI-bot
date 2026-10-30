import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startConsoleFixture } from './console-ui-fixture.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const executablePath = [path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe')].find(fs.existsSync);
const fixture = await startConsoleFixture(), browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.url ? route.continue() : route.abort());
  await page.goto(fixture.url + '/#setting-l-2');
  const root = page.locator('[data-component-id="ctx-chat-topic-drive"]');
  await root.locator('.comp-save').waitFor({ state: 'attached' });
  await root.locator('xpath=ancestor::details').locator(':scope > summary').click();
  for (const group of await root.locator('details').all()) if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
  const values = { minIntervalMinutes: '240', dailyLimit: '2', followUpCooldownMinutes: '12', newTopicCooldownMinutes: '50', newTopicMaxPerHour: '3', followupWeight: '0.4', newTopicWeight: '0.3' };
  for (const [key, value] of Object.entries(values)) {
    const field = root.locator('[data-config-key="' + key + '"] input');
    assert.equal(await field.isEditable(), true, key);
    await field.fill(value);
  }
  await root.locator('.comp-save').click();
  await page.waitForFunction(() => document.querySelector('[data-component-id="ctx-chat-topic-drive"] .comp-msg')?.textContent.includes('已重新读取'));
  for (const [key, value] of Object.entries(values)) {
    assert.equal(fixture.componentFixtures.get('ctx-chat-topic-drive').config[key], Number(value), key);
    assert.equal(await root.locator('[data-config-key="' + key + '"] input').inputValue(), value, key + ' readback');
  }
  fs.mkdirSync('state/audits/topic-actions-20261030', { recursive: true });
  await root.screenshot({ path: 'state/audits/topic-actions-20261030/topic-settings.png' });
  for (const width of [768, 390]) { await page.setViewportSize({ width, height: 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); }
  assert.deepEqual(errors, []);
  console.log('PASS all seven topic parameters editable, changed values saved and reread, mobile layout');
} finally { await browser.close(); await fixture.close(); }
