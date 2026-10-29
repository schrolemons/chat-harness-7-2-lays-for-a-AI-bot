import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from './index.js';
function fixture() {
  let state = {};
  const ctx = { config: {}, state: { get: () => state, set: p => { state = { ...state, ...p }; } }, capabilities: { getTimeBubbleContext: key => key === 'private:1' ? { displayName: '小林', confirmedRoutine: '午饭后散步', mood: { modeName: '小猫', styleInstruction: '安静温柔' } } : {} }, registerTool() {} };
  return { plugin: createPlugin(ctx), state: () => state };
}
test('direct bubbles personalize from structured confirmed facts without hint echo or model calls', () => {
  const f = fixture();
  const one = f.plugin.services.timeBubble.prepareDirect({ key: 'private:1', label: '午饭点', hint: 'DO_NOT_ECHO' });
  assert.match(one, /小林/); assert.match(one, /午饭后散步/); assert.match(one, /[?？]/); assert.ok(!one.includes('DO_NOT_ECHO'));
  const two = f.plugin.services.timeBubble.prepareDirect({ key: 'private:1', label: '午饭点' }); assert.notEqual(one, two);
  f.plugin.services.timeBubble.releaseDirect({ key: 'private:1' }); assert.equal(f.state().byKey['private:1'].count, 1);
  assert.ok(!f.plugin.services.timeBubble.prepareDirect({ key: 'group:1', label: '午饭点' }).includes('小林'));
});
test('model prompt treats hint as creative instructions and includes personalized style without canned milk examples', () => {
  const f = fixture();
  const text = f.plugin.hooks.beforePrompt({ key: 'private:1', reason: 'timeBubble', st: { pendingTimeBubble: { label: '午饭', hint: '聊聊午饭后散步' } } });
  assert.match(text, /不能照抄|不得照抄/); assert.match(text, /小林/); assert.match(text, /安静温柔/); assert.ok(!text.includes('该喝牛奶'));
});
