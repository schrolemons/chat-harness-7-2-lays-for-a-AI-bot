import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUserProfileStore } from '../src/user-profile.js';
import { createPlugin as createProfilePlugin } from '../plugins/qq-components/ctx-memory-profile-store/index.js';
import { createPlugin as createMemberCardPlugin } from '../plugins/qq-components/ctx-member-card/index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-profile-sharing-'));
try {
  const store = createUserProfileStore({ file: path.join(dir, 'profiles.json') });
  store.recordContact({ userId: '10001', name: '甲', key: 'private:10001' });
  store.recordContact({ userId: '10002', name: '乙', key: 'private:10002' });
  store.recordNote({ userId: '10002', name: '乙', key: 'private:10002', trait: '特别喜欢猫' });
  const localOnly = store.blockFor({ participants: ['10001'], includeOthers: false });
  assert.equal(localOnly.shared.length, 0, '关闭跨对话分享后不注入其他人的可分享印象');
  assert.doesNotMatch(localOnly.text, /乙|特别喜欢猫/);
  const enabled = store.blockFor({ participants: ['10001'], includeOthers: true });
  assert.ok(enabled.shared.length > 0, '启用后仍可使用原有脱敏分享能力');

  const groupRoot = path.join(dir, 'group-only');
  const tools = new Map();
  const ctx = {
    root: groupRoot,
    config: {},
    registerTool: (name, spec) => tools.set(name, spec),
    log() {},
    warn() {}
  };
  const profilePlugin = createProfilePlugin(ctx);
  assert.equal(profilePlugin.services.profileStore.isWarmTarget({ key: 'group:9001', target: '群友乙' }), false);
  profilePlugin.hooks.onIncoming({ key: 'group:9001', userId: '20002', sender: '群友乙', text: '我喜欢海豚' });
  const groupSnapshot = tools.get('profile_snapshot').handler();
  assert.deepEqual(groupSnapshot.users['u:20002'].keys, ['group:9001'], '只有群聊记录的用户也进入画像库');
  assert.equal(groupSnapshot.users['u:20002'].messageCount, 1);

  const card = createMemberCardPlugin({
    root: groupRoot,
    config: { includeGroups: true },
    registerTool() {}
  }).hooks.beforePrompt({
    key: 'group:9001',
    st: { recentMessages: [{ userId: '20002', sender: '群友乙', isSelf: false }] }
  });
  assert.match(card, /群友乙/, '未私聊的群成员也能生成并注入人物卡');

  const notActive = tools.get('profile_promote_impression');
  assert.ok(notActive, '注册轻量印象晋升工具');
  assert.deepEqual(notActive.handler({ userId: '20002', name: '群友乙', key: 'group:9999', target: '群友乙', traits: ['喜欢海豚'] }),
    { ok: false, saved: false }, '不是近期活跃的群会话时拒绝晋升');

  profilePlugin.hooks.onIncoming({ key: 'group:9001', userId: '20002', sender: '群友乙', text: '我还喜欢看海' });
  assert.deepEqual(notActive.handler({ userId: '20003', name: '群友乙', key: 'group:9001', target: '群友乙', traits: ['喜欢海豚'] }),
    { ok: false, saved: false }, '不得把名字印象写给另一个用户 ID');
  const promoted = notActive.handler({ userId: '20002', name: '群友乙', key: 'group:9001', target: '群友乙', traits: ['喜欢海豚'] });
  assert.equal(promoted.ok, true, '已核实的群成员印象可耐久写入人物档案');
  assert.equal(promoted.saved, true);
  assert.ok(promoted.warmConnectionAt > 0);
  const persisted = JSON.parse(fs.readFileSync(path.join(groupRoot, 'state', 'user-profiles.json'), 'utf8'));
  assert.ok(persisted.users['u:20002'].notes.some((n) => n.text === '喜欢海豚'));
  assert.ok(persisted.users['u:20002'].warmConnectionAt > 0, '晋升时写入非数值好感标记');
  assert.equal(persisted.users['u:20002'].messageCount, 2, '晋升不伪造额外聊天互动次数');
  assert.equal(profilePlugin.services.profileStore.isWarmTarget({ key: 'group:9001', target: '群友乙' }), true);
  assert.equal(profilePlugin.services.profileStore.isWarmTarget({ key: 'group:9002', target: '群友乙' }), false,
    '亲近标记不可跨群触发轻量记忆拦截');
  const warmCard = createMemberCardPlugin({ root: groupRoot, config: { includeGroups: true }, registerTool() {} })
    .hooks.beforePrompt({ key: 'group:9001', st: { recentMessages: [{ userId: '20002', sender: '群友乙', isSelf: false }] } });
  assert.match(warmCard, /亲近感/, '群聊人物卡展示已晋升的亲近关系');

  const failedRoot = path.join(dir, 'failed-write');
  fs.mkdirSync(path.join(failedRoot, 'state', 'user-profiles.json'), { recursive: true });
  const failedTools = new Map();
  const failedPlugin = createProfilePlugin({
    root: failedRoot, config: {}, registerTool: (name, spec) => failedTools.set(name, spec), log() {}, warn() {}
  });
  failedPlugin.hooks.onIncoming({ key: 'group:9002', userId: '30003', sender: '群友丙', text: '你好' });
  const failed = failedTools.get('profile_promote_impression').handler({
    userId: '30003', name: '群友丙', key: 'group:9002', target: '群友丙', traits: ['喜欢海豚']
  });
  assert.equal(failed.ok, false, '磁盘写入失败时不得确认晋升');
  assert.equal(failed.saved, false);
  const bridgeSource = fs.readFileSync(path.join(process.cwd(), 'src', 'bridge.js'), 'utf8');
  assert.match(bridgeSource, /profileStore', 'isWarmTarget'/, '轻量记忆入口委托画像组件检查已晋升对象');
  assert.match(bridgeSource, /该群友已进入人物档案/);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
