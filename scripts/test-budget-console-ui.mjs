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

test('O layer saves and reloads all three recovery windows', async () => {
  const fixture = await startConsoleFixture();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    await page.goto(fixture.url);
    await page.locator('[data-view="usage"]').first().click();
    for(const [id,value] of Object.entries({usageRecoveryPrivate:7,usageRecoveryGroup:8,usageRecoveryGroupAt:9}))await page.locator('#'+id).fill(String(value));
    await page.locator('#usageRecoverySave').click();
    await page.waitForFunction(() => document.getElementById('usageBudgetMsg')?.textContent.includes('全局恢复窗口已保存'));
    assert.deepEqual(fixture.state.recoveryWindows,{privateMessages:7,groupMessages:8,groupAtMessages:9});
    await page.reload();await page.locator('[data-view="usage"]').first().click();
    await page.waitForFunction(()=>document.getElementById('usageRecoveryPrivate')?.value==='7');
    assert.equal(await page.locator('#usageRecoveryGroup').inputValue(),'8');
    assert.equal(await page.locator('#usageRecoveryGroupAt').inputValue(),'9');
  } finally { await browser.close(); await fixture.close(); }
});

test('O layer saves conversation caps and a weak-reply interval in minutes', async () => {
  const fixture=await startConsoleFixture();
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try {
    const page=await browser.newPage();await page.goto(fixture.url);await page.locator('[data-view="usage"]').first().click();
    const row=page.locator('[data-budget-key]').first();await row.waitFor();const key=await row.getAttribute('data-budget-key');
    await row.locator('input').nth(0).fill('0');await row.locator('input').nth(1).fill('1.25');await row.locator('input').nth(2).fill('7');
    await row.locator('[data-budget-save]').click();await page.waitForFunction(()=>document.getElementById('usageBudgetMsg')?.textContent==='已保存');
    assert.deepEqual(fixture.state.budgetConfigs[key],{key,coldLimitYuan:0,hardLimitYuan:1.25,weakMinIntervalMin:7});
    await page.reload();await page.locator('[data-view="usage"]').first().click();
    await page.waitForFunction(key=>document.querySelector('[data-budget-key="'+key+'"] input')?.value==='0',key);
    assert.equal(await page.locator('[data-budget-key="'+key+'"] input').nth(2).inputValue(),'7');
  }finally{await browser.close();await fixture.close();}
});
