// 会话事实/身份组件回归测试：node scripts/test-context-session.mjs
import fs from 'node:fs';
import { createPlugin } from '../plugins/qq-components/ctx-context-session/index.js';
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
  unread: [{ text: '在吗' }, { text: '问你个事' }],
  recentMessages: [
    { isSelf: false, sender: '小林', text: '问你个事，明天有空吗，我跟你讲', tail: '我跟你讲', time: now - 5 * 60 * 1000 },
    { isSelf: true, text: '在', time: now - 6 * 60 * 1000 }
  ],
  lastAiReplyAt: now - 10 * 60 * 1000
};
const payload = {
  st,
  roleName: '通用助手',
  selfName: 'DeepSeek通用助手',
  selfId: '2799274749',
  agentToken: 'token-abc',
  initialPromptText: '【本群氛围】大家都是朋友'
};
const text = build(payload);

check('角色名', text.includes('【当前角色】通用助手'));
check('身份（昵称+QQ）', text.includes('DeepSeek通用助手') && text.includes('2799274749') && text.includes('不要当成别人'));
check('会话令牌', text.includes('【会话令牌】token-abc'));
check('状态：未读', text.includes('未读 2 条'));
check('状态：最近来信', text.includes('小林') && !text.includes('问你个事'));
check('状态：没说完', text.includes('对方可能没说完'));
check('状态：上次发言', text.includes('你上次发言 10 分钟前'));
check('初始提示词', text.includes('本群氛围'));

const noSt = build({ st: {}, roleName: '', selfName: '', selfId: '', agentToken: '', initialPromptText: '' });
check('无事实时只留状态', noSt.includes('未读 0 条') && !noSt.includes('会话令牌') && !noSt.includes('当前角色'));

const disabled = build(payload, { disabledBlocks: ['token', 'initialPrompt'] });
check('disabledBlocks 生效', !disabled.includes('会话令牌') && !disabled.includes('本群氛围') && disabled.includes('当前角色'));

const host = createPluginHost({ root: process.cwd(), capabilities: {} });
const summary = await host.loadAll();
check('插件宿主加载（至少 27 个）', summary.count >= 27, 'count=' + summary.count);
check('宿主加载无警告', summary.warnings.length === 0, JSON.stringify(summary.warnings));
const hostText = host.collectPromptBlocks(payload).join('\n');
check('宿主注入身份/状态', hostText.includes('DeepSeek通用助手') && hostText.includes('未读 2 条'));

const bridge = fs.readFileSync('src/bridge.js', 'utf8');
const fn = bridge.indexOf('function buildWakePromptV2');
const nextFn = bridge.indexOf('function buildWakeReminderPromptV2', fn);
const seg = bridge.slice(fn, nextFn > fn ? nextFn : fn + 12000);
check('bridge 主唤醒组装不再有 roleLine/identityLine/tokenLine/statusLine/initialPromptLine',
  !/const (roleLine|identityLine|tokenLine|statusLine|initialPromptLine) =/.test(seg));
check('bridge payload 带身份事实', ['roleName:', 'selfName:', 'selfId:', 'agentToken:', 'initialPromptText:'].every((k) => bridge.includes(k)));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n会话事实组件测试通过');
