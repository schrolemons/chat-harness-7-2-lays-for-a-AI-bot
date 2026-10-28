// 参与度/时间感组件回归测试：node scripts/test-context-runtime.mjs
import fs from 'node:fs';
import { createPlugin } from '../plugins/qq-components/ctx-context-runtime/index.js';
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

const now = Date.now();
const st = {
  recentMessages: [
    { isSelf: true, text: '在', time: now - 30 * 1000 },
    { isSelf: true, text: '咋了', time: now - 60 * 1000 },
    { isSelf: true, text: '说吧', time: now - 90 * 1000 },
    { isSelf: false, sender: '管理员', text: '问你个事', time: now - 4 * 60 * 1000 }
  ],
  unread: [{ text: '在吗', plain: '在吗，DeepSeek 在不在', sender: '管理员', time: now - 60 * 1000 }],
  lastAiReplyAt: now - 2 * 60 * 1000
};
const text = build({ st, directUnread: 1, wakeConfig: { staleChatMinutes: 10, staleSilentMinutes: 120 } });
check('参与度：次数统计', text.includes('【参与度参考】你最近 1 小时说了 3 次') && text.includes('群友发了 1 条'));
check('参与度：有人直接找你提示', text.includes('有人直接找你'));
check('时间感：分钟档', text.includes('【时间感】') && text.includes('10 分钟内') && text.includes('120 分钟'));

const old = build({
  st: { unread: [{ text: '早', sender: '十六', time: now - 3 * 60 * 60 * 1000 }], recentMessages: [], lastAiReplyAt: 0 },
  directUnread: 0,
  wakeConfig: { staleChatMinutes: 10, staleSilentMinutes: 120 }
});
check('时间感：过期提醒', old.includes('缓存过期提醒'));

check('无消息时不注入时间感', !build({ st: {}, directUnread: 0, wakeConfig: {} }).includes('【时间感】'));

const host = createPluginHost({ root: process.cwd(), capabilities: {} });
const summary = await host.loadAll();
check('插件宿主加载（至少 27 个）', summary.count >= 27, 'count=' + summary.count);
check('宿主加载无警告', summary.warnings.length === 0, JSON.stringify(summary.warnings));
const hostText = host.collectPromptBlocks({ st, directUnread: 1, wakeConfig: {} }).join('\n');
check('宿主注入参与度/时间感', hostText.includes('【参与度参考】') && hostText.includes('【时间感】'));

const bridge = fs.readFileSync('src/bridge.js', 'utf8');
const fn = bridge.indexOf('function buildWakePromptV2');
const nextFn = bridge.indexOf('function buildWakeReminderPromptV2', fn);
const seg = bridge.slice(fn, nextFn > fn ? nextFn : fn + 12000);
check('bridge 主唤醒组装已移除 participationLine/timeSenseLine', !seg.includes('participationLine') && !seg.includes('timeSenseLine'));
check('bridge payload 带 directUnread/wakeConfig', seg.includes('directUnread: directUnreadNow') && seg.includes('wakeConfig: cfg.socialV2?.wake'));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n参与度/时间感组件测试通过');
