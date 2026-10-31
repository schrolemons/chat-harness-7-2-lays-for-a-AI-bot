import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startConsoleFixture } from './console-ui-fixture.mjs';

const fixture = await startConsoleFixture();
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.url + '/#setting-c-0');
  await page.waitForTimeout(600);
  assert.deepEqual(errors, [], 'Console startup must reach the data-loading and routing stages');
  await page.waitForFunction(() => document.getElementById('wlGroups').value.includes('123456789'));
  assert.equal(await page.locator('#mainNav [data-view="v2-c"]').count(), 0);
  assert.equal(await page.locator('#mainNav [data-view="setting-c-0"]').count(), 1);
  assert.equal(await page.locator('[data-page="setting-c-0"]:visible').count() > 0, true);
  await page.locator('#mainNav [data-view="setting-c-1"]').click();
  await page.locator('[data-page="setting-c-1"]:visible').first().waitFor();
  console.log('PASS startup, real fixture data, canonical C navigation');
} finally {
  await browser.close();
  await fixture.close();
}
