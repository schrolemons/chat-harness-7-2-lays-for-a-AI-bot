// 风格/规则组件回归测试：node scripts/test-chat-style.mjs
import fs from 'node:fs';
import { createPlugin } from '../plugins/qq-components/ctx-chat-style/index.js';
import { createPluginHost } from '../src/plugin-host.js';

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('✅ ' + name); return; }
  failed += 1;
  console.error('❌ ' + name + (detail ? ' — ' + detail : ''));
};

function build(config = {}, payload = {}) {
  const blocks = [];
  const ctx = { config, promptBlocks: blocks, addPromptBlock: (t) => blocks.push(String(t)) };
  const plugin = createPlugin(ctx);
  plugin.hooks.beforePrompt(payload);
  return blocks.join('\n\n');
}

const group = build({}, { isPrivate: false, isOwnerKey: false });
const priv = build({}, { isPrivate: true, isOwnerKey: false });
const owner = build({}, { isPrivate: true, isOwnerKey: true });

for(const [scene,payload] of Object.entries({ordinary:{},serious:{reason:'private',inputText:'请认真解释这个技术问题'},critical:{moodState:{mode:'critical'}}})){
  const prompt=build({},payload);
  check(scene+'：明确人设卡与示范职责，包括严肃任务',prompt.includes('【人设卡与对话示范】')&&prompt.includes('严肃的任务型回复')&&prompt.includes('不照抄示范台词'));
}

check('群聊：有反 AI 味/风格/积极性', group.includes('反AI味') && group.includes('回复条数与风格') && group.includes('积极性'));
check('群聊：有轻量记忆规则', group.includes('轻量记忆'));
check('群聊：没有私聊必回/传话', !group.includes('私聊必回') && !group.includes('传话靠桥接'));
check('私聊：有私聊必回 + 传话提示', priv.includes('私聊必回') && priv.includes('传话靠桥接'));
check('owner：有记忆体系说明', owner.includes('记忆体系'));
check('非 owner：没有记忆体系说明', !priv.includes('记忆体系'));
check('分段压入（不是一整段）', build({}, { isPrivate: true, isOwnerKey: true }).split('\n\n').length >= 4);

const disabled = build({ disabledBlocks: ['style', 'antiAi'] }, { isPrivate: false, isOwnerKey: false });
check('disabledBlocks 生效', !disabled.includes('回复条数与风格') && !disabled.includes('反AI味') && disabled.includes('积极性'));

const host = createPluginHost({ root: process.cwd(), capabilities: {} });
const summary = await host.loadAll();
check('插件宿主加载（至少 27 个）', summary.count >= 27, 'count=' + summary.count);
check('宿主加载无警告', summary.warnings.length === 0, JSON.stringify(summary.warnings));
const blocks = host.collectPromptBlocks({ key: 'private:1', isPrivate: true, isOwnerKey: true });
check('宿主拼接包含风格块', blocks.join('\n').includes('私聊必回'));

const bridge = fs.readFileSync('src/bridge.js', 'utf8');
for (const name of ['memoryRuleLine', 'memoryTaxonomyLine', 'quoteLine', 'styleLine', 'antiAiLine', 'proactiveLine', 'privateReplyLine', 'relayLine']) {
  check('bridge 已移除内联 ' + name, !bridge.includes(name));
}
check('bridge payload 带 isPrivate/isOwnerKey', bridge.includes('isPrivate: String(key).startsWith') && bridge.includes('isOwnerKey: isAdminDevKey(key)'));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n风格组件测试通过');
