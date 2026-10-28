import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { startConsoleFixture } from './console-ui-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const executablePath = [
  join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe')
].find(existsSync);

test('O layer edits and saves both mechanical reply lists in a real browser', async () => {
  const fixture = await startConsoleFixture();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    await page.goto(fixture.url);
    await page.locator('[data-view="usage"]').first().click();
    const privateBox = page.locator('#usageMechanicalPrivate');
    const groupBox = page.locator('#usageMechanicalGroup');
    await privateBox.waitFor();
    await page.waitForFunction(() => document.getElementById('usageMechanicalPrivate')?.value.includes('哥哥我好饿'));
    await privateBox.fill('私聊一\n私聊二');
    await groupBox.fill('群聊一\n群聊二');
    await page.locator('#usageMechanicalSave').click();
    await page.waitForFunction(() => document.getElementById('usageMechanicalMsg')?.textContent.includes('已保存'));
    assert.deepEqual(fixture.state.mechanicalReplies, {
      privateReplies: ['私聊一', '私聊二'], groupReplies: ['群聊一', '群聊二']
    });
  } finally { await browser.close(); await fixture.close(); }
});

test('O layer saves a per-conversation recovery window', async () => {
  const fixture = await startConsoleFixture();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    await page.goto(fixture.url);
    await page.locator('[data-view="usage"]').first().click();
    const row = page.locator('[data-budget-key]').first();
    await row.waitFor();
    const key = await row.getAttribute('data-budget-key');
    await row.locator('input').nth(3).fill('7');
    await row.locator('[data-budget-save]').click();
    await page.waitForFunction(() => document.getElementById('usageBudgetMsg')?.textContent.includes('已保存'));
    assert.equal(fixture.state.budgetConfigs[key].recoveryWindowMessages, 7);
  } finally { await browser.close(); await fixture.close(); }
});
