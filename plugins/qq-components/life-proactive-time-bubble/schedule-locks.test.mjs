import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeTimeBubbleSlots } from './schedule-locks.mjs';
import { createPlugin } from './index.js';

const old = [{ id: 'lunch', hour: 12, minute: 0, label: '午饭', hint: '原提示', enabled: true, locked: true },
  { id: 'sleep', hour: 22, minute: 0, label: '睡觉', hint: '', enabled: true }];

test('agent updates preserve locked rows and may update unlocked rows', () => {
  const out = mergeTimeBubbleSlots(old, [
    { id: 'lunch', hour: 13, minute: 0, label: '改动', enabled: false },
    { id: 'sleep', hour: 23, minute: 0, label: '夜间', enabled: true }
  ], { actor: 'agent' });
  assert.equal(out.rejected, false);
  assert.deepEqual(out.slots[0], old[0]);
  assert.equal(out.slots[1].hour, 23);
  assert.deepEqual(out.conflicts, ['lunch']);
});

test('agent cannot modify a fully locked schedule', () => {
  const out = mergeTimeBubbleSlots(old, [], { actor: 'agent', allLocked: true });
  assert.equal(out.rejected, true);
  assert.deepEqual(out.slots, old);
});

test('agent deletion by omission preserves a locked item and deletes an unlocked item', () => {
  const out = mergeTimeBubbleSlots(old, [], { actor: 'agent' });
  assert.deepEqual(out.slots, [old[0]]);
  assert.deepEqual(out.conflicts, ['lunch']);
});

test('agent can create, edit and delete unlocked time and copy fields', () => {
  const created = mergeTimeBubbleSlots([], [
    { id: 'report', hour: 14, minute: 30, label: '报告', hint: '准备汇报', enabled: true }
  ], { actor: 'agent' });
  assert.equal(created.slots[0].label, '报告');
  assert.equal(created.slots[0].hint, '准备汇报');
  const edited = mergeTimeBubbleSlots(created.slots, [
    { ...created.slots[0], hour: 15, minute: 0, label: '报告修改', hint: '带上讲义' }
  ], { actor: 'agent' });
  assert.deepEqual([edited.slots[0].hour, edited.slots[0].minute, edited.slots[0].label, edited.slots[0].hint], [15, 0, '报告修改', '带上讲义']);
  const deleted = mergeTimeBubbleSlots(edited.slots, [], { actor: 'agent' });
  assert.deepEqual(deleted.slots, []);
});

test('registered time_bubble_manage tool supports session-scoped get/set CRUD', () => {
  let slots = [{ id: 'fixed', hour: 8, minute: 0, label: '起床', hint: '原文案', enabled: true, locked: true }];
  let allLocked = false;
  let tool;
  const runtime = {};
  const plugin = createPlugin({
    config: { enabled: true, maxBubblesPerDay: 3 }, runtime,
    registerTool: (name, definition) => { if (name === 'time_bubble_manage') tool = definition; },
    capabilities: {
      getTimeBubbles: ({ key }) => ({ ok: true, key, slots: structuredClone(slots), allLocked }),
      updateTimeBubbles: ({ key, slots: proposed }) => {
        const normalized = proposed.map((slot) => ({ ...slot, id: slot.id || (slot.hour + '-' + String(slot.minute).padStart(2, '0')) }));
        const merged = mergeTimeBubbleSlots(slots, normalized, { actor: 'agent', allLocked });
        if (merged.rejected) return { ok: false, error: 'schedule_locked', slots: merged.slots };
        slots = merged.slots;
        return { ok: true, key, slots: structuredClone(slots), conflicts: merged.conflicts };
      }
    }, state: { get: () => ({}), set: () => {} }
  });
  plugin.hooks.beforePrompt({ key: 'private:20001', reason: 'message' });
  assert.equal(tool.description.includes('保留无关时段'), true);
  assert.deepEqual(tool.handler({ action: 'get', key: 'private:20001' }).slots, slots);
  const added = tool.handler({ action: 'set', key: 'private:20001', slots: [
    { hour: 14, minute: 30, label: '报告准备', hint: '带上讲义', enabled: true }
  ] });
  assert.equal(added.ok, true);
  assert.equal(added.slots.some((slot) => slot.hour === 14 && slot.label === '报告准备' && slot.hint === '带上讲义'), true);
  assert.equal(added.slots.some((slot) => slot.id === 'fixed' && slot.hint === '原文案'), true);
  const current = added.slots.find((slot) => slot.label === '报告准备');
  const edited = tool.handler({ action: 'set', key: 'private:20001', slots: [
    { ...current, hour: 15, label: '报告', hint: '已修改文案' }
  ] });
  assert.equal(edited.slots.some((slot) => slot.hour === 15 && slot.label === '报告' && slot.hint === '已修改文案'), true);
  const deleted = tool.handler({ action: 'set', key: 'private:20001', slots: [] });
  assert.deepEqual(deleted.slots.map((slot) => slot.id), ['fixed']);
  assert.equal(tool.handler({ action: 'get', key: 'private:999' }).error, 'not_current_session');
});

test('console can unlock a whole schedule and replace it', () => {
  const out = mergeTimeBubbleSlots(old, [{ id: 'new', hour: 9, minute: 30, label: '早安' }], {
    actor: 'console', allLocked: true, proposedAllLocked: false
  });
  assert.equal(out.rejected, false);
  assert.equal(out.allLocked, false);
  assert.equal(out.slots[0].id, 'new');
});
