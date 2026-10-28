// 人物印象晋升提示词回归：node scripts/test-memory-profile-promotion.mjs
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/ctx-memory-profile-facts/index.js';

let state = {};
const plugin = createPlugin({
  config: { cooldownMs: 0 },
  state: { get: () => state, set: (patch) => { state = { ...state, ...patch }; } }
});

plugin.hooks.onIncoming({ key: 'group:9001', userId: '20002', sender: '群友乙', text: '我喜欢海豚' });
const prompt = plugin.hooks.beforePrompt({ key: 'group:9001', reason: 'message', st: {} });

assert.match(prompt, /不活跃|未在当前群聊发言/);
assert.match(prompt, /正向|好感/);
assert.match(prompt, /profile_promote_impression/);
assert.match(prompt, /qq_memory_query/);
assert.match(prompt, /QQ 号|userId/);
assert.match(prompt, /qq_memory_remove/);
assert.match(prompt, /写入成功|saved/);
assert.match(prompt, /warmConnectionAt/);
assert.match(prompt, /偏好|回避|习惯|未做/);
assert.match(prompt, /profile_record_facts/);

console.log('人物印象晋升提示词测试通过');
