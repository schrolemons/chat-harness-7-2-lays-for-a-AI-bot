import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/obs-cost-policy/index.js';

test('economy mode keeps complex tasks on Flash until Pro is explicitly requested', () => {
  const p = createPlugin({ config: { autoUpgradeComplexTasks: false } });
  const select = p.services['cost-policy'].select;
  assert.equal(select({ task: '重构代码并修复并发死锁，补回归测试' }).model, 'deepseek-flash');
  assert.equal(select({ task: '请用 Pro 严格证明这个结论' }).model, 'deepseek-v4-pro');
  assert.equal(select({ reason: 'memoryWrite', task: '请用 Pro' }).model, 'deepseek-flash');
});

test('economy mode also governs a complex request cached by the incoming hook', () => {
  const p = createPlugin({ config: { autoUpgradeComplexTasks: false } });
  p.hooks.onIncoming({ key: 'private:1', text: '请重构代码并修复并发死锁' });
  assert.equal(p.services['cost-policy'].select({ key: 'private:1' }).model, 'deepseek-flash');
});
