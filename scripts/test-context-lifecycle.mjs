// 唤醒/节奏/收尾组件回归测试：node scripts/test-context-lifecycle.mjs
import fs from 'node:fs';
import { createPlugin } from '../plugins/qq-components/ctx-context-lifecycle/index.js';
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

const st = { wakeConfig: { mode: 'diving', infinite: true, triggers: { atMention: true, nameMention: true, probability: 0.05 } } };
const normal = build({ st, preSleepMs: 300000, replyTiming: { quietMs: 8000, remainingQuietMs: 3000 }, autonomousNow: false, hasUnreadNow: true });
const proactive = build({ st, preSleepMs: 300000, replyTiming: { quietMs: 8000, remainingQuietMs: 8000 }, autonomousNow: true, hasUnreadNow: false });
const extras = build({ st, preSleepMs: 180000, replyTiming: { quietMs: 10000, remainingQuietMs: 0 }, mutedJustClearedNow: true, pendingRemindersNow: [{ text: '日程｜2026-10-26 09:00｜开会' }] });

check('唤醒状态', normal.includes('【当前唤醒】不另设到时检查') && /私聊[^。]*(?:不抽签|100%)/.test(normal));
check('主动开口标记', proactive.includes('【这是你主动开口】') && !proactive.includes('【当前唤醒】'));
check('首回复节奏', normal.includes('【首回复节奏】') && normal.includes('quietMs=8000') && normal.includes('还差约 3 秒'));
check('主动开口节奏', proactive.includes('【主动开口·不是回复】'));
check('分离静默与无人回复收尾', normal.includes('qq_wait_for_quiet') && normal.includes('endRound') && !normal.includes('timeoutMs=300000'));
check('静音解除提示', extras.includes('【刚解除静音】'));
check('到点提醒', extras.includes('【到点提醒｜别忘了】') && extras.includes('09:00｜开会'));

const disabled = build({ st, preSleepMs: 300000, replyTiming: {}, mutedJustClearedNow: true }, { disabledBlocks: ['wake', 'preSleep', 'muted'] });
check('disabledBlocks 生效', !disabled.includes('【当前唤醒】') && !disabled.includes('沉睡前') && !disabled.includes('刚解除静音'));

const host = createPluginHost({ root: process.cwd(), capabilities: {} });
const summary = await host.loadAll();
check('插件宿主加载（至少 27 个）', summary.count >= 27, 'count=' + summary.count);
check('宿主加载无警告', summary.warnings.length === 0, JSON.stringify(summary.warnings));
const hostText = host.collectPromptBlocks({ st, preSleepMs: 300000, replyTiming: { quietMs: 8000, remainingQuietMs: 0 }, autonomousNow: false, hasUnreadNow: true }).join('\n');
check('宿主注入唤醒/节奏', hostText.includes('【当前唤醒】') && hostText.includes('【首回复节奏】'));
const reminder = host.callService('lifecycle', 'wakeReminder', { roleName: '大肥鱼', selfName: 'DeepSeek大肥鱼', selfId: '21001', agentToken: 'tok', preSleepMs: 300000 });
check('收尾提醒服务', typeof reminder === 'string' && reminder.includes('还没有完成回合收尾') && reminder.includes('endRound') && !reminder.includes('timeoutMs=300000'));
check('收尾提醒含身份/令牌', reminder.includes('21001') && reminder.includes('tok'));

const bridge = fs.readFileSync('src/bridge.js', 'utf8');
const fn = bridge.indexOf('function buildWakePromptV2');
const nextFn = bridge.indexOf('function buildWakeReminderPromptV2', fn);
const seg = bridge.slice(fn, nextFn > fn ? nextFn : fn + 12000);
for (const marker of ['let mutedClearLine', 'let pendingReminderLine', 'const replyLine =', 'const preSleepLine', 'const proactiveReplyLine', 'wakeLineNow']) {
  check('bridge 主唤醒组装已移除 ' + marker, !seg.includes(marker));
}
check('bridge payload 带 lifecycle 事实', ['preSleepMs,', 'replyTiming,', 'autonomousNow:', 'hasUnreadNow,', 'mutedJustClearedNow,', 'pendingRemindersNow,'].every((k) => seg.includes(k)));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n唤醒/节奏/收尾组件测试通过');
