// 唤醒原因尾巴组件回归测试：node scripts/test-wake-reasons.mjs
import fs from 'node:fs';
import { createPlugin } from '../plugins/qq-components/life-wake-reasons/index.js';
import { createPluginHost } from '../src/plugin-host.js';

const store = {};
const mkCtx = (config = {}) => ({
  config,
  root: process.cwd(),
  state: { get: () => store, set: (p) => Object.assign(store, p) },
  log: () => {},
  warn: (m) => console.error('warn:', m),
  capabilities: {}
});

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('✅ ' + name); return; }
  failed += 1;
  console.error('❌ ' + name + (detail ? ' — ' + detail : ''));
};

const plugin = createPlugin(mkCtx());
const base = { key: 'private:60004', preSleepMs: 300000, triggeredLine: '' };
const tail = (reason, extra = {}) => plugin.hooks.wakeTail({ ...base, reason, ...extra }) || '';

check('bootstrap', tail('bootstrap').includes('引导唤醒'));
check('timeout', tail('timeout').includes('有限潜水时间已到'));
check('replyCheck', tail('replyCheck').includes('回复检查') && tail('replyCheck').includes('timeoutMs=300000'));
check('careCheck', tail('careCheck').includes('主动关心'));
const biliShareTail = tail('newsShare', {
  maxItems: 2,
  biliShareKeywords: ['海洋纪录片', '鲸鱼'],
  biliPreferredUploader: '示例海洋记录员',
  biliShareItems: [{
    bvid: 'BV1ab411c7mD',
    title: '鲸鱼纪录片',
    uploader: '海洋频道',
    description: '记录鲸群迁徙。'
  }]
});
check('newsShare 仅分享已核实候选', biliShareTail.includes('只分享下面这些') && biliShareTail.includes('不要另找视频'));
check('newsShare 含可核实视频字段', biliShareTail.includes('鲸鱼纪录片') && biliShareTail.includes('海洋频道') && biliShareTail.includes('https://www.bilibili.com/video/BV1ab411c7mD'));
check('newsShare 保留标题UP链接与简介边界', ['标题：','UP 主：','链接：','简介能支持'].every(x=>biliShareTail.includes(x)));
check('newsShare 不由模型重新选择UP', biliShareTail.includes('不要另找视频'));
check('newsShare 没有候选安静收尾', tail('newsShare', {maxItems:2}).includes('不要发送推荐或替补内容'));
check('newsShare 拒绝缺少核实信息的候选', tail('newsShare', {biliShareItems:[{bvid:'BV1ab411c7mD'}]}).includes('不要发送推荐'));
const scheduledBiliTail = tail('newsShare', {
  maxItems: 3,
  biliShareKeywords: ['鲸鱼'],
  biliPreferredUploader: ''
});
check('定时推荐无候选不临时搜索', scheduledBiliTail.includes('不要发送推荐或替补内容'));
check('idleRescue', tail('idleRescue').includes('空闲兜底'));
const opt = tail('selfOptimize', { history: '【最新优化记录】\n历史记录内容\n\n' });
check('selfOptimize 带历史', opt.includes('历史记录内容') && opt.includes('自我迭代'));
check('selfReview', tail('selfReview').includes('功能与代码自查'));
check('memoryWrite', tail('memoryWrite').includes('记忆更新'));
check('newFriend 带 peer', tail('newFriend', { peer: '60002' }).includes('QQ 60002'));
check('新好友使用正太小鲸鱼身份', tail('newFriend', { peer: '60002' }).includes('正太小肥鱼') && !/鲸鱼娘|爱吃白饭|吃 token/.test(tail('newFriend', { peer: '60002' })));
check('主动唤醒遵循新卡', ['newsShare', 'reminder', 'poke'].every((reason) => !/大肥鱼的口吻|大肥鱼味|傲娇装烦/.test(tail(reason))));
check('timeBubble', tail('timeBubble').includes('时间冒泡'));
check('startupGreeting', tail('startupGreeting').includes('开机起床'));
const done = tail('taskDone', { taskReport: { title: '测试任务', taskId: 't-abc' } });
check('taskDone 带任务信息', done.includes('测试任务') && done.includes('t-abc') && done.includes('qq_task_result'));
const rem = tail('reminder', { reminderItems: [{ text: '日程｜2026-10-25 23:00｜开会' }] });
check('reminder 带条目', rem.includes('日程｜2026-10-25 23:00｜开会'));
check('proactiveCheck', tail('proactiveCheck').includes('主动机会'));
check('poke', tail('poke').includes('拍一拍'));
const plain = tail('private', { triggeredLine: '（触发这条是 1 分钟前发的）' });
check('普通唤醒走默认尾巴', plain.includes('【唤醒】private:60004') && plain.includes('原因：private') && plain.includes('1 分钟前'));
check('未知 reason 也走默认尾巴', tail('someNewReason').includes('原因：someNewReason'));

// 配置禁用某个 reason：返回空，让桥接走兜底
const disabledPlugin = createPlugin(mkCtx({ disabledReasons: ['poke'] }));
check('disabledReasons 生效', disabledPlugin.hooks.wakeTail({ ...base, reason: 'poke' }) === '');

// 插件宿主分发：真实加载全部插件后，collectWakeTails 应该命中本组件
const host = createPluginHost({ root: process.cwd(), capabilities: {} });
const summary = await host.loadAll();
check('插件宿主加载（至少 27 个）', summary.count >= 27, 'count=' + summary.count);
check('宿主加载无警告', summary.warnings.length === 0, JSON.stringify(summary.warnings));
const hostTail = host.collectWakeTails({ ...base, reason: 'replyCheck' });
check('宿主 collectWakeTails 命中', hostTail.includes('回复检查') && hostTail.includes('timeoutMs=300000'));

// 回归：bridge.js 里不应再出现这些内联 reason 分支
const bridge = fs.readFileSync('src/bridge.js', 'utf8');
for (const reason of ['careCheck', 'idleRescue', 'newFriend', 'proactiveCheck', 'poke']) {
  const marker = `if (reason === '${reason}')`;
  check('bridge 已移除内联分支 ' + reason, !bridge.includes(marker));
}
// 回归：所有 17 段尾巴文案都应已搬走（用特征句而不是变量名判断）
const tailMarkers = [
  '【引导唤醒】', '【回复检查】', '原因：你设置的有限潜水时间已到',
  '【主动关心】', '【每日 B 站视频推荐】', '【空闲兜底】',
  '【自我迭代｜按建议直接动手】', '【自我迭代｜功能与代码自查】',
  '【记忆更新】按上面插件给出的格式', '【新好友】老板刚通过',
  '【时间冒泡】按上面插件给出的要求', '【开机起床】按上面插件给出的口径',
  '【任务回执】你之前委派的任务', '【定时提醒｜现在就去群里说】',
  '【主动机会】', '【拍一拍要积极响应'
];
for (const marker of tailMarkers) {
  check('bridge 已移除尾巴文案 ' + marker.slice(0, 12), !bridge.includes(marker));
}
// 回归：桥接必须真的调用组件钩子，并保留兜底
check('bridge 调用 collectWakeTails', bridge.includes('pluginHost.collectWakeTails('));
check('B站推荐唤醒禁止退回普通新闻', bridge.includes('禁止调用 web_search / web_fetch，禁止发送普通新闻或热点'));
check('bridge 保留唤醒兜底尾巴', bridge.includes('先看消息，判断是否要接话；决定潜水前按上面的【沉睡前强制等待】完成观察。'));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n唤醒原因尾巴组件测试通过');
