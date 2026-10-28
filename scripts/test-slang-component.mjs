// 黑话学习与注入组件回归测试：node scripts/test-slang-component.mjs
import fs from 'node:fs';
import { createPlugin } from '../plugins/qq-components/ctx-chat-slang/index.js';
import { createPluginHost } from '../src/plugin-host.js';

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('✅ ' + name); return; }
  failed += 1;
  console.error('❌ ' + name + (detail ? ' — ' + detail : ''));
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// ── 1) 组件逻辑（假能力驱动）────────────────────────────────────────────
let store = [];
const adminTools = new Map();
const learnerCalls = [];
const extractReply = JSON.stringify([{ content: '典', source_id: 1 }]);
const researchReply = JSON.stringify([{ content: '典', confirmed: true, meaning: '很典型、名场面', usage: '吐槽时用', example: '这波太典了', sources: ['https://example.com'] }]);
const cfg = {
  enabled: true,
  extractMinMessages: 3,
  extractCooldownMs: 0,
  inferenceThresholds: [1],
  autoResearch: true,
  injectMax: 8
};
const ctx = {
  config: {},
  registerTool: (name,spec) => adminTools.set(name,spec.handler),
  log: () => {},
  warn: (m) => console.error('warn:', m),
  state: { get: () => ({}), set: () => {} },
  capabilities: {
    slangConfig: () => cfg,
    slangList: () => JSON.parse(JSON.stringify(store)),
    slangSave: (entries) => { store = JSON.parse(JSON.stringify(entries)); return true; },
    slangLearnerPrompt: async (prompt) => {
      learnerCalls.push(prompt);
      return String(prompt).includes('研究员') ? researchReply : extractReply;
    }
  }
};
const plugin = createPlugin(ctx);

plugin.hooks.onIncoming({ key: 'group:1', sender: '小明', text: '这波操作太典了' });
plugin.hooks.onIncoming({ key: 'group:1', sender: '小红', text: '典中典' });
plugin.hooks.onIncoming({ key: 'group:1', sender: '小明', text: '真的典' });
plugin.hooks.onTick({ now: Date.now() });
await tick(40);
check('抽词：调用学习会话', learnerCalls.length >= 1, JSON.stringify(learnerCalls.map((c) => c.slice(0, 20))));
check('抽词：候选写入 store', store.length === 1 && store[0].content === '典', JSON.stringify(store));

// 候选 count=1 命中 thresholds [1] → 自动研究；研究返回 confirmed 解释
check('研究：调用了研究 prompt', learnerCalls.length >= 2, 'calls=' + learnerCalls.length);
const entry = store.find((e) => e.content === '典');
check('研究：写回解释', entry && entry.meaning === '很典型、名场面', JSON.stringify(entry));
// 管理端只研究明确选中的候选；未确定的结果也要有可见的已研究标记。
store.push({id:'selected-1',content:'选中词',status:'candidate',count:1,lastInferenceCount:0,evidence:[],meaning:'',sources:[]});
store.push({id:'unselected-1',content:'未选词',status:'candidate',count:1,lastInferenceCount:0,evidence:[],meaning:'',sources:[]});
ctx.capabilities.slangLearnerPrompt=async prompt=>{
  learnerCalls.push(prompt);
  return JSON.stringify([{content:'选中词',confirmed:false,meaning:'不确定'}]);
};
check('管理端研究工具已注册',typeof adminTools.get('slang_research_batch')==='function');
const selectedResult=await adminTools.get('slang_research_batch')({ids:['selected-1']});
check('管理端仅研究所选',selectedResult?.ok===true&&learnerCalls.at(-1).includes('选中词')&&!learnerCalls.at(-1).includes('未选词'),JSON.stringify(selectedResult));
check('不确定结果标记已研究',store.find(x=>x.id==='selected-1').lastInferenceCount===1&&store.find(x=>x.id==='unselected-1').lastInferenceCount===0,JSON.stringify(store.slice(-2)));
store.push({id:'misclassified-1',content:'普通词',status:'candidate',count:1,lastInferenceCount:0,evidence:[],meaning:'',sources:[]});
ctx.capabilities.slangLearnerPrompt=async()=>JSON.stringify([{content:'普通词',confirmed:true,meaning:'不确定。群内语境不足，无法判断含义。',usage:'猜测用法'}]);
const ambiguousResult=await adminTools.get('slang_research_batch')({ids:['misclassified-1']});
const ambiguousEntry=store.find(x=>x.id==='misclassified-1');
check('含义不确定时不写入词义',ambiguousResult?.uncertain===1&&ambiguousEntry?.meaning===''&&ambiguousEntry?.usage===undefined&&ambiguousEntry?.lastInferenceCount===1,JSON.stringify(ambiguousEntry));
const oversized=await adminTools.get('slang_research_batch')({ids:['a','b','c','d','e','f']});
check('管理端研究单批至多五条',oversized?.ok===false&&/5/.test(oversized.error),JSON.stringify(oversized));

// 注入：contextBlock 包含时间行；确认后才进黑话表
plugin.services.slang.contextBlock(); // 触发 buildSlangContext（候选不注入）
store[0].status = 'confirmed';
const block = plugin.services.slang.contextBlock();
check('注入：contextBlock 带当前时间', block.includes('【当前时间】'), block.slice(0, 40));
check('注入：确认的黑话进入表', block.includes('典') && block.includes('很典型'), block.slice(0, 160));

// 控制台服务：extract/research/reset/forget/stats
check('服务：stats 有窗口', JSON.parse(JSON.stringify(plugin.services.slang.stats())).windows.length >= 1);
check('服务：extract 可触发', plugin.services.slang.extract({ key: 'group:1' }) === true);
plugin.services.slang.reset();
check('服务：reset 清空窗口', plugin.services.slang.stats().keys.length === 0);

// ── 2) 宿主集成：真实加载全部插件 + callService ──────────────────────────
const host = createPluginHost({ root: process.cwd(), capabilities: {} });
const summary = await host.loadAll();
check('插件宿主加载（至少 27 个）', summary.count >= 27, 'count=' + summary.count);
check('宿主加载无警告', summary.warnings.length === 0, JSON.stringify(summary.warnings));
check('宿主暴露 slang 服务', host.hasService('slang', 'contextBlock') === true);
const hostBlock = host.callService('slang', 'contextBlock');
check('宿主 callService 返回字符串', typeof hostBlock === 'string' && hostBlock.includes('【当前时间】'), typeof hostBlock);

// ── 3) 桥接回归：学习循环已搬走，只剩数据面/能力 ────────────────────────
const bridge = fs.readFileSync('src/bridge.js', 'utf8');
for (const marker of ['slangWindows', 'slangExtractionCooldowns', 'slangResearchingIds', 'queueSlangTask', 'feedSlangWindow', 'maybeQueueSlangExtraction', 'runSlangExtraction', 'runSlangResearch']) {
  check('bridge 已移除 ' + marker, !bridge.includes(marker));
}
check('bridge 通过服务注入黑话表', bridge.includes("callService('slang', 'contextBlock')"));
check('bridge 暴露 slangList/slangSave 能力', bridge.includes('taskCaps.slangList') && bridge.includes('taskCaps.slangSave'));
check('bridge 保留学习会话往返能力', bridge.includes('taskCaps.slangLearnerPrompt'));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n黑话组件测试通过');
