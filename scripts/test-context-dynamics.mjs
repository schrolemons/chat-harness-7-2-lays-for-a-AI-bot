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
const high = build({ moodState: { value: 85, config: moodCfg, unmuteBurst: false, recovering: false } });
const low = build({ moodState: { value: 30, config: moodCfg, unmuteBurst: true, recovering: true } });
check('心情好：标签+建议', high.includes('【小鲸鱼的心情】不错（85/100）') && high.includes('可以活跃点'));
check('心情低：低落+被叫回来+恢复期', low.includes('有点低（30/100）') && low.includes('刚被叫回来') && low.includes('恢复期'));
check('心情低不引导傲娇', !low.includes('傲娇一点'));
check('心情关闭：不注入', !build({ moodState: { value: 80, config: { ...moodCfg, enabled: false } } }).includes('小鲸鱼的心情'));

const stickerCfg = { enabled: true, includeInPrompt: true, sendProbability: 0.6, recentCooldownMinutes: 30, promptMaxStickers: 8 };
const entries = [{ id: 's1', desc: '大肥鱼吃瓜', localNote: '', tags: [] }];
const st = { recentStickers: [{ id: 's1', at: Date.now() - 60_000 }] };
const noSticker = build({ st, stickerEntries: entries, stickerConfig: stickerCfg, stickerRoll: false });
const withSticker = build({ st, stickerEntries: entries, stickerConfig: stickerCfg, stickerRoll: true });
check('表情：本轮不带', noSticker.includes('【本轮不带表情包】'));
check('表情：最近发过的提示', withSticker.includes('【最近发过的表情') && withSticker.includes('大肥鱼吃瓜'));
check('表情：策略文案', withSticker.includes('表情') && withSticker.length > 20);
check('表情关闭：不注入', !build({ stickerConfig: { ...stickerCfg, enabled: false }, stickerRoll: true }).includes('表情'));

const disabled = build({ moodState: { value: 85, config: moodCfg }, st, stickerEntries: entries, stickerConfig: stickerCfg, stickerRoll: true }, { disabledBlocks: ['mood', 'sticker'] });
check('disabledBlocks 生效', disabled === '');

const host = createPluginHost({ root: process.cwd(), capabilities: {} });
const summary = await host.loadAll();
check('插件宿主加载（至少 27 个）', summary.count >= 27, 'count=' + summary.count);
check('宿主加载无警告', summary.warnings.length === 0, JSON.stringify(summary.warnings));
const hostText = host.collectPromptBlocks({ st, stickerEntries: entries, stickerConfig: stickerCfg, stickerRoll: true, moodState: { value: 85, config: moodCfg } }).join('\n');
check('宿主注入心情+表情', hostText.includes('小鲸鱼的心情') && hostText.includes('最近发过的表情'));

const bridge = fs.readFileSync('src/bridge.js', 'utf8');
const fn = bridge.indexOf('function buildWakePromptV2');
const nextFn = bridge.indexOf('function buildWakeReminderPromptV2', fn);
const seg = bridge.slice(fn, nextFn > fn ? nextFn : fn + 12000);
for (const marker of ['let moodLine', 'const stickerTurnLine', 'const stickerLine =', 'buildStickerStrategyHint()']) {
  check('bridge 主唤醒组装已移除 ' + marker, !seg.includes(marker));
}
check('bridge payload 带 dynamics 事实', ['moodState:', 'stickerConfig:', 'stickerRoll'].every((k) => seg.includes(k)));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n心情/表情策略组件测试通过');
