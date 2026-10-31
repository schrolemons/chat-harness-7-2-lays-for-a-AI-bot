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
    await page.waitForFunction(()=>document.getElementById('usageBudgetWindowSummary')?.textContent.includes('群聊普通5条 + @消息5条'));
    assert.match(await page.locator('[data-page="usage"] .parameter-scope').last().innerText(),/全局规则、按会话分别计数/);
    await page.waitForFunction(() => document.getElementById('usageMechanicalPrivate')?.value.includes('用户我好饿'));
    await privateBox.fill('私聊一\n私聊二');
    await groupBox.fill('群聊一\n群聊二');
    await page.locator('#usageMechanicalGapSec').fill('12');await page.locator('#usageMechanicalMinute').fill('3');await page.locator('#usageMechanicalHour').fill('18');
    await page.locator('#usageMechanicalSave').click();
    await page.waitForFunction(() => document.getElementById('usageMechanicalMsg')?.textContent.includes('已保存'));
    assert.deepEqual(fixture.state.mechanicalLimits,{minIntervalMs:12000,maxPerMinute:3,maxPerHour:18});
    assert.deepEqual(fixture.state.mechanicalReplies, {
      privateReplies: ['私聊一', '私聊二'], groupReplies: ['群聊一', '群聊二']
    });
  } finally { await browser.close(); await fixture.close(); }
});

test('context settings save and reload the three canonical budget windows', async () => {
  const fixture = await startConsoleFixture();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    await page.goto(fixture.url);
    await page.locator('[data-view="setting-c-1"]').first().click();
    await page.locator('[data-page="setting-c-1"] details').filter({has:page.locator('#usageRecoveryPrivate')}).locator('summary').click();
    for(const [id,value] of Object.entries({usageRecoveryPrivate:7,usageRecoveryGroup:8,usageRecoveryGroupAt:9}))await page.locator('#'+id).fill(String(value));
    await page.locator('#usageRecoverySave').click();
    await page.waitForFunction(() => document.getElementById('contextBudgetWindowsMsg')?.textContent.includes('已保存'));
    assert.deepEqual(fixture.state.recoveryWindows,{privateMessages:7,groupMessages:8,groupAtMessages:9});
    await page.reload();await page.locator('[data-view="setting-c-1"]').first().click();
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
test('private cold trigger saves independently, survives reload, and keeps form controls aligned',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(fixture.url);await page.locator('[data-view="usage"]').first().click();
 await page.route('**/api/tokens/budgets',async route=>{const response=await route.fetch(),body=await response.json();for(const row of body.rows||[])delete row.privateWakeEveryMessages;await route.fulfill({response,json:body});});
 const count=page.locator('#usagePrivateWakeEvery');await count.waitFor();await count.fill('3');await page.locator('#usagePrivateWakeSave').click();await page.waitForFunction(()=>document.getElementById('usagePrivateWakeMsg')?.textContent.includes('已保存'));
 await page.reload();await page.locator('[data-view="usage"]').first().click();await page.waitForFunction(()=>document.getElementById('usagePrivateWakeEvery')?.value==='3');
 assert.match(await page.locator('[data-budget-key^="private:"]').first().innerText(),/全局：每3条来信 → 回复1条/);
 await page.locator('[data-budget-private-rule]').first().click();assert.equal(await count.evaluate(x=>x===document.activeElement),true);
 const dimensions=await page.locator('[data-budget-save]').evaluateAll(xs=>xs.map(x=>({height:x.getBoundingClientRect().height,width:x.getBoundingClientRect().width})));assert(dimensions.every(x=>x.height<60&&x.width>115),'table save buttons must fit on one line');
 const groupLine=await page.locator('.budget-interval').first().evaluate(x=>({height:x.getBoundingClientRect().height,inputHeight:x.querySelector('input').getBoundingClientRect().height}));assert(groupLine.height<=groupLine.inputHeight+2,'group interval stays inline');
 const tops=await page.locator('.usage-mechanical-limits input').evaluateAll(xs=>xs.map(x=>x.getBoundingClientRect().top));assert(Math.max(...tops)-Math.min(...tops)<2);
 const saves=await page.locator('.usage-rule-grid button').evaluateAll(xs=>xs.map(x=>({width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height})));assert(saves.every(x=>x.width>120&&x.height<65),'save labels must remain horizontal and readable');
 await count.fill('0');await page.locator('#usagePrivateWakeSave').click();assert.match(await page.locator('#usagePrivateWakeMsg').innerText(),/1–100/);
 await page.setViewportSize({width:390,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }finally{await browser.close();await fixture.close();}
});
