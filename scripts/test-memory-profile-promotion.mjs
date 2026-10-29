import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/ctx-memory-profile-facts/index.js';

test('profile candidates use the current JSON interface and keep other-session material out of the prompt', () => {
  let state = {};
  const plugin = createPlugin({ config: { cooldownMs: 0 },
    state: { get: () => state, set: patch => { state = { ...state, ...patch }; } } });
  plugin.hooks.onIncoming({ key: 'group:9001', userId: '10001', sender: '甲', text: '当前群本人说的爱好' });
  plugin.hooks.onIncoming({ key: 'private:10002', userId: '10002', sender: '乙', text: '其他会话私密素材' });
  const prompt = plugin.hooks.beforePrompt({ key: 'group:9001', reason: 'message', st: {} });
  assert.match(prompt, /当前群本人说的爱好/); assert.doesNotMatch(prompt, /其他会话私密素材/);
  for (const tool of ['profile_get', 'profile_update', 'profile_delete']) assert.ok(prompt.includes(tool));
  assert.match(prompt, /临时 memberImpression 不会自动晋升/);
  assert.doesNotMatch(prompt, /profile_record_facts|profile_promote_impression/);
});
