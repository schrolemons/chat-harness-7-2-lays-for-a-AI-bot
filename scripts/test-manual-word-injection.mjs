import assert from 'node:assert/strict';
import { createPlugin as createAlias } from '../plugins/qq-components/ctx-member-alias/index.js';
import { createPlugin as createSlang } from '../plugins/qq-components/ctx-chat-slang/index.js';

const aliasState = {};
const aliasTools = new Map();
const alias = createAlias({
  config: { autoExtract: false },
  state: { get: () => aliasState, set: patch => Object.assign(aliasState, patch) },
  registerTool: (name, tool) => aliasTools.set(name, tool),
  log: () => {}
});
alias.hooks.onIncoming({ userId: '123456789', sender: '自动候选' });
assert.deepEqual(aliasState.entries || [], [], '关闭自动提取后不生成候选');
assert.equal(aliasTools.get('alias_add').handler({ alias: '手动绰号', qq: '123456789' }).ok, true);
assert.match(alias.hooks.beforePrompt(), /手动绰号 = 123456789/, '手动确认的绰号仍注入');

const slang = createSlang({
  capabilities: {
    slangConfig: () => ({ enabled: false, injectMax: 8 }),
    slangList: () => [{ id: 'manual', content: '手动黑话', meaning: '手动解释', status: 'confirmed', count: 1 }]
  },
  isActive: () => true,
  log: () => {}, warn: () => {}
});
slang.hooks.onIncoming({ key: 'group:1', sender: '甲', text: '不应提取' });
assert.match(slang.services.slang.contextBlock(), /手动黑话/, '关闭自动学习后已确认词条仍注入');
