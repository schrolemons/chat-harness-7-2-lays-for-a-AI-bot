import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { startConsoleFixture, projectRoot } from './console-ui-fixture.mjs';

// Compile in memory so this test does not race another worker's generated assets.
const compiled = await build({ absWorkingDir: projectRoot, entryPoints: ['console/app.js'], outdir: 'public/console', bundle: true, format: 'iife', target: ['es2022'], write: false });
const fixture = await startConsoleFixture();
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const writes = [], errors = [], bubbleWrites = [];
const existingSchedule = { id: 'existing-draft', title: 'Existing schedule', dueAt: Date.now() + 86400000, leadMinutes: 10, intervalMinutes: 30, repeat: 'none' };
let savedSlots = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/console/app.js*', route => route.fulfill({ contentType: 'application/javascript', body: compiled.outputFiles[0].text }));
  await page.route('**/api/socialV2/states', route => route.fulfill({ json: { ok: true, conversations: [{ key: 'private:10001' }] } }));
  await page.route('**/api/socialV2/schedules', route => {
    const body = route.request().postDataJSON();
    if (body.action === 'add' || body.action === 'appendIfAbsent') writes.push(body);
    return route.fulfill({ json: { ok: true, added: 1, items: [], conversations: [{ key: 'private:10001', items: [existingSchedule] }] } });
  });
  await page.route('**/api/socialV2/time-bubbles*', route => {
    let addedSlots = [];
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      bubbleWrites.push(body);
      if (body.appendSlots) {
        addedSlots = body.appendSlots.filter(slot => !savedSlots.some(current => current.id === slot.id || (current.hour === slot.hour && current.minute === slot.minute)));
        savedSlots = [...savedSlots, ...addedSlots];
      } else savedSlots = body.slots;
    }
    return route.fulfill({ json: { ok: true, all: savedSlots, allLocked: false, added: addedSlots.length, addedSlots } });
  });
  await page.goto(fixture.url);
  await page.locator('[data-view="setting-l-2"]').first().click();
  const catalog = page.locator('#v2ExampleTemplate');
  await catalog.waitFor();
  assert.equal(await catalog.locator('option').count(), 3, 'all shipped examples are discoverable immediately');
  assert.match(await page.locator('#v2ExamplePreview').innerText(), /09:00.*12:30.*20:30/s);
  const apply = page.locator('#v2ExampleApply');
  assert.equal(await apply.isDisabled(), true);
  assert.equal(await page.locator('#v2ExampleKey').inputValue(), '', 'no implicit first-recipient selection');
  assert.deepEqual(writes, [], 'opening the page never installs schedules');
  await page.locator('#v2ExampleKey').selectOption('private:10001');
  await page.locator('#v2ExampleConsent').check();
  await catalog.selectOption('tomorrow-reminder');
  assert.equal(await page.locator('#v2ExampleConsent').isChecked(), false, 'changing template clears consent');
  assert.equal(await apply.isDisabled(), true);
  assert.match(await page.locator('#v2ExamplePreview').innerText(), /10.*30/s);
  await page.locator('input[data-lead-id="existing-draft"]').fill('17');
  await page.locator('input[data-interval-id="existing-draft"]').fill('47');
  await page.locator('summary').filter({ hasText: '话题发起与跟进' }).click();
  await page.locator('#v2TbFollowupInterval').fill('999');
  await page.locator('#v2TbFollowupDaily').fill('2');
  await page.locator('#v2ExampleConsent').check();
  await apply.click();
  await page.waitForFunction(() => document.querySelector('#v2ExampleMsg').textContent.includes('已添加'));
  await page.waitForFunction(() => !document.querySelector('#v2ExampleKey').disabled);
  assert.equal(await page.locator('input[data-lead-id="existing-draft"]').inputValue(), '17', 'example application preserves unsaved schedule lead draft');
  assert.equal(await page.locator('input[data-interval-id="existing-draft"]').inputValue(), '47', 'example application preserves unsaved schedule interval draft');
  assert.equal(await page.locator('#v2TbFollowupInterval').inputValue(), '999', 'example application preserves unsaved followup interval');
  assert.equal(await page.locator('#v2TbFollowupDaily').inputValue(), '2', 'example application preserves unsaved followup daily limit');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].action, 'appendIfAbsent');
  assert.equal(writes[0].exampleId, 'tomorrow-reminder:v1');
  assert.equal(writes[0].key, 'private:10001');
  assert.ok(writes[0].dueAt > Date.now());
  assert.equal(writes[0].leadMinutes, 10);
  assert.equal(writes[0].intervalMinutes, 30);
  await page.locator('#v2TbLoad').click();
  await page.waitForFunction(() => !document.querySelector('#v2TimeBubbleAdd').disabled);
  await page.locator('#v2TimeBubbleAdd').click();
  await page.locator('[data-tb="hour"]').fill('9');
  await page.locator('[data-tb="minute"]').fill('0');
  await page.locator('[data-tb="label"]').fill('My unsaved draft');
  await catalog.selectOption('daily-bubbles');
  await page.locator('#v2ExampleConsent').check();
  await apply.click();
  await page.waitForFunction(() => document.querySelector('#v2ExampleMsg').textContent.includes('已添加 3'));
  assert.equal(await page.locator('#v2TimeBubbleRows [data-tb-row]').count(), 3, 'loaded editor includes new slots before it can save');
  assert.equal(await page.locator('[data-tb="label"]').first().inputValue(), 'My unsaved draft', 'local draft is preserved');
  await page.waitForFunction(() => !document.querySelector('#v2ExampleKey').disabled);
  assert.equal(await page.locator('input[data-lead-id="existing-draft"]').inputValue(), '17');
  assert.equal(await page.locator('#v2TbFollowupInterval').inputValue(), '999');
  await page.locator('#v2TbSave').click();
  await page.waitForFunction(() => document.querySelector('#v2TbMsg').textContent.includes('共 3 个时段'));
  assert.equal(bubbleWrites.length, 2);
  assert.equal(bubbleWrites[1].slots.length, 3, 'saving old editor cannot delete newly applied examples');
  assert.equal(bubbleWrites[1].slots[0].label, 'My unsaved draft');
  assert.deepEqual(errors, []);
  console.log('PASS discoverable previews, no implicit recipient/startup writes, fresh consent, selected-session API application');
} finally {
  await browser.close();
  await fixture.close();
}
