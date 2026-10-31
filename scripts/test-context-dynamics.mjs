// 心情/表情策略组件回归测试：node scripts/test-context-dynamics.mjs
import fs from 'node:fs';
import { createPlugin } from '../plugins/qq-components/ctx-context-dynamics/index.js';
import { createPluginHost } from '../src/plugin-host.js';

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('✅ ' + name); return; }
  failed += 1;
  console.error('❌ ' + name + (detail ? ' — ' + detail : ''));
};

function build(payload, config = {}) {
  const blocks = [];
  const ctx = { config, promptBlocks: blocks, addPromptBlock: (t) => blocks.push(String(t)) };
  createPlugin(ctx).hooks.beforePrompt(payload);
  return blocks.join('\n\n');
}

const moodCfg = {
  enabled: true,
  highThreshold: 70,
  lowThreshold: 45
};
const high = build({ moodState: { score: 85, enabled: true, modeName: '明亮', styleInstruction: '可以活跃点' } });
const low = build({ moodState: { score: 30, enabled: true, modeName: '沉静', styleInstruction: '克制沉思' } });
check('心情好：形态与动态分数分开', high.includes('【当前形态】明亮。') && high.includes('【心情数值】85/100') && high.includes('可以活跃点'));
check('心情低：形态与动态分数分开', low.includes('【当前形态】沉静。') && low.includes('【心情数值】30/100') && low.includes('克制沉思') && !low.includes('2~3'));
check('心情低不引导生硬', !low.includes('生硬一点'));
check('心情关闭：不注入', !build({ moodState: { value: 80, config: { ...moodCfg, enabled: false } } }).includes('AI助手的心情'));

const stickerCfg = { enabled: true, includeInPrompt: true, sendProbability: 0.6, recentCooldownMinutes: 30, promptMaxStickers: 8 };
const entries = [{ id: 's1', desc: '通用助手吃瓜', localNote: '', tags: [] }];
const st = { recentStickers: [{ id: 's1', at: Date.now() - 60_000 }] };
const noSticker = build({ st, stickerEntries: entries, stickerConfig: stickerCfg, stickerRoll: false });
const withSticker = build({ st, stickerEntries: entries, stickerConfig: stickerCfg, stickerRoll: true });
check('表情：旧随机值不禁止自主选择', !noSticker.includes('【本轮不带表情包】') && noSticker.includes('表情'));
check('表情：最近发过的提示', withSticker.includes('【最近发过的表情') && withSticker.includes('通用助手吃瓜'));
check('表情：策略文案', withSticker.includes('表情') && withSticker.length > 20);
check('表情关闭：不注入', !build({ stickerConfig: { ...stickerCfg, enabled: false }, stickerRoll: true }).includes('表情'));

const disabled = build({ moodState: { score: 85, enabled: true, modeName: '明亮', styleInstruction: '可以活跃点' }, st, stickerEntries: entries, stickerConfig: stickerCfg, stickerRoll: true }, { disabledBlocks: ['mood', 'sticker'] });
check('disabledBlocks 生效', disabled === '');

const host = createPluginHost({ root: process.cwd(), capabilities: {} });
const summary = await host.loadAll();
check('插件宿主加载（至少 27 个）', summary.count >= 27, 'count=' + summary.count);
check('宿主加载无警告', summary.warnings.length === 0, JSON.stringify(summary.warnings));
const hostText = host.collectPromptBlocks({ st, stickerEntries: entries, stickerConfig: stickerCfg, stickerRoll: true, moodState: { score: 85, enabled: true, modeName: '明亮', styleInstruction: '可以活跃点' } }).join('\n');
check('宿主注入心情+表情', hostText.includes('当前形态') && hostText.includes('最近发过的表情'));

const bridge = fs.readFileSync('src/bridge.js', 'utf8');
const fn = bridge.indexOf('function buildWakePromptV2');
const nextFn = bridge.indexOf('function buildWakeReminderPromptV2', fn);
const seg = bridge.slice(fn, nextFn > fn ? nextFn : fn + 12000);
for (const marker of ['let moodLine', 'const stickerTurnLine', 'const stickerLine =', 'buildStickerStrategyHint()']) {
  check('bridge 主唤醒组装已移除 ' + marker, !seg.includes(marker));
}
check('bridge payload 带 dynamics 事实', ['moodState:', 'stickerConfig:'].every((k) => seg.includes(k)));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n心情/表情策略组件测试通过');
