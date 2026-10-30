// 传话组件（life-relay-message）回归测试：node scripts/test-relay-component.mjs
//
// 用假的 capabilities 驱动插件，覆盖：直接带内容 / 只说人后补内容 / 角色称呼 /
// 弱意图不误拦 / 目标找不到补 QQ 号 / pending 过期。
import { createPlugin } from '../plugins/qq-components/life-relay-message/index.js';

const sent = [];
const notices = [];
const TARGETS = new Map([
  ['十二', 'private:20002'],
  ['管理员', 'private:20001'],
  ['老板', 'private:20001'],
  ['20002', 'private:20002'],
  ['20001', 'private:20001']
]);
let linkedTargets = new Map(TARGETS);
const CONTACTS = [
  { userId: '20003', nickname: '艾莉哥哥', remark: '' },
  { userId: '20002', nickname: '十二哥哥', remark: '' }
];

let store = {};
const ctx = {
  config: { pendingTtlMin: 10 },
  state: { get: () => store, set: (patch) => Object.assign(store, patch) },
  log: () => {},
  warn: (m) => console.error('warn:', m),
  capabilities: {
    resolveRelayTarget: (name) => linkedTargets.get(String(name)) || null,
    isRelayAliasLinked: (name) => linkedTargets.has(String(name)),
    searchRelayContacts: async ({ query }) => CONTACTS.filter((c) => [c.nickname, c.remark].some((n) => n && n.includes(String(query)))).map((c) => ({ ...c, targetKey: 'private:' + c.userId })),
    linkRelayAlias: async ({ alias, targetKey }) => { linkedTargets.set(alias, targetKey); return { ok: true }; },
    relaySend: async ({ fromKey, targetKey, name, body }) => {
      sent.push({ fromKey, targetKey, name, body });
      return { ok: true, target: targetKey };
    },
    sendSessionText: async (key, text) => { notices.push({ key, text }); return true; }
  }
};

const plugin = createPlugin(ctx);
const tick = () => new Promise((r) => setTimeout(r, 10));
const call = async (payload) => plugin.hooks.relayIncoming(payload);
const base = { allowed: true, key: 'private:20001', isOwner: true };

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('✅ ' + name); return; }
  failed += 1;
  console.error('❌ ' + name + (detail ? ' — ' + detail : ''));
};

// 1) 群聊/不允许的会话：不处理
check('非允许会话返回 null', await call({ ...base, allowed: false, plainContent: '给管理员带句话，晚安' }) === null);

// 2) 一句话带内容
let r = await call({ ...base, plainContent: '给管理员带句话，问问他吃了没' });
await tick();
check('带内容：handled', r && r.handled === true);
check('带内容：转达给十二', sent.length === 1 && sent[0].targetKey === 'private:20002' && sent[0].body === '问问他吃了没', JSON.stringify(sent));

let handledMessage = null;
r = await call({ ...base, messageId: 'source-171', plainContent: '问问十二醒没醒', onHandled: (result) => { handledMessage = result; } });
await tick();
check('被传话组件拦截的原消息立即通知桥接闭环', handledMessage?.action === 'relay' && handledMessage?.target === 'private:20002', JSON.stringify(handledMessage));

// 3) 只说人，下一条补内容
sent.length = 0; notices.length = 0;
r = await call({ ...base, plainContent: '给管理员带句话' });
check('只说人：handled', r && r.handled === true && r.action === 'await-content');
check('只说人：提示下一条发内容', notices.some((n) => n.text.includes('下一条消息直接发内容')), JSON.stringify(notices));
r = await call({ ...base, plainContent: '晚安，明天见' });
await tick();
check('补内容：handled', r && r.handled === true);
check('补内容：原样转达', sent.length === 1 && sent[0].body === '晚安，明天见', JSON.stringify(sent));

// 4) 角色称呼：十二（非 owner）问问你们管理员
sent.length = 0;
r = await call({ ...base, key: 'private:20002', isOwner: false, plainContent: '问问你们管理员，他吃了吗' });
await tick();
check('管理员角色：handled', r && r.handled === true);
check('管理员角色：转达给 owner', sent.length === 1 && sent[0].targetKey === 'private:20001' && sent[0].body === '他吃了吗', JSON.stringify(sent));

// 5) 弱意图解析不到人：不拦（交给 AI）
r = await call({ ...base, plainContent: '问问价格' });
check('弱意图不误拦：null', r === null);

// 6) 目标找不到 → 补 QQ 号
sent.length = 0; notices.length = 0;
r = await call({ ...base, plainContent: '给张三带句话，晚安' });
check('目标未知：handled', r && r.handled === true && r.action === 'await-target');
check('目标未知：提示补 QQ 号', notices.some((n) => n.text.includes('QQ 号')), JSON.stringify(notices));
r = await call({ ...base, plainContent: '20002' });
await tick();
check('补 QQ 号：先展示号码请求确认', r?.action === 'await-alias-confirmation' && notices.some((n) => n.text.includes('20002')), JSON.stringify({ r, notices }));
check('号码尚未确认时不发送', sent.length === 0, JSON.stringify(sent));
r = await call({ ...base, plainContent: '确认' });
await tick();
check('确认别名后再转达', r?.action === 'relay' && sent.length === 1 && sent[0].targetKey === 'private:20002' && sent[0].body === '晚安', JSON.stringify({ r, sent }));

// 7) pending 过期：不当作内容，且清空
store = { pending: { [base.key]: { target: 'private:20002', name: '十二', awaitingContent: true, at: Date.now() - 11 * 60 * 1000 } } };
sent.length = 0;
r = await call({ ...base, plainContent: '晚安' });
await tick();
check('pending 过期：不处理', r === null);
check('pending 过期：不误发', sent.length === 0);
check('pending 过期：已清空', !store.pending || !store.pending[base.key]);

// 8) 非管理员按发起会话限制两次传话的最短间隔；管理员免受限制。
store = {};
sent.length = 0; notices.length = 0;
const guest = { ...base, key: 'private:20002', isOwner: false };
await call({ ...guest, plainContent: '给管理员带句话，第一条' });
await call({ ...guest, plainContent: '给管理员带句话，第二条' });
await tick();
check('非管理员间隔内只发送一条', sent.length === 1, JSON.stringify(sent));
check('间隔限制给出提示', notices.some((n) => n.key === guest.key && n.text.includes('分钟')), JSON.stringify(notices));
sent.length = 0; notices.length = 0;
await call({ ...base, isOwner: true, plainContent: '给管理员带句话，第一条' });
await call({ ...base, isOwner: true, plainContent: '给管理员带句话，第二条' });
await tick();
check('管理员连续传话不受间隔限制', sent.length === 2, JSON.stringify(sent));

// 9) 同一条 QQ 入站消息重复投递时，传话只允许尝试一次。
store = {};
sent.length = 0;
const duplicateRelayPayload = {
  ...base,
  messageId: 'same-onebot-message-id',
  plainContent: '问问十二醒没醒'
};
await call(duplicateRelayPayload);
const duplicateResult = await call(duplicateRelayPayload);
await tick();
check('重复入站 messageId 被闭环拦截', duplicateResult?.action === 'duplicate-ignored', JSON.stringify(duplicateResult));
check('重复入站 messageId 只发送一次', sent.length === 1, JSON.stringify(sent));

// 10) 未解析目标的 pending 只接受明确的 QQ/会话号；新意图不能被旧传话吞掉。
store = { pending: { [base.key]: { name: '艾莉', content: '测试重复保护 842', at: Date.now() } } };
sent.length = 0; notices.length = 0;
r = await call({ ...base, messageId: 'electric-intent-after-pending', plainContent: '去群里电电艾莉' });
check('待补传话遇到新意图时交还 AI 处理', r === null, JSON.stringify(r));
check('新意图不会被误回成补目标提示', notices.length === 0, JSON.stringify(notices));
check('新意图会清除过期语境，避免后续串线', !store.pending?.[base.key], JSON.stringify(store.pending));
store = { pending: { [base.key]: { target: 'private:20002', name: '十二', awaitingContent: true, at: Date.now() } } };
sent.length = 0; notices.length = 0;
r = await call({ ...base, messageId: 'electric-action-after-await-content', plainContent: '去群里电电艾莉' });
check('等待传话内容时，明确的新动作不会被当作转发正文', r === null, JSON.stringify(r));
check('明确的新动作不会被转发给旧目标', sent.length === 0, JSON.stringify(sent));
check('明确的新动作会清除旧待补内容状态', !store.pending?.[base.key], JSON.stringify(store.pending));

// 11) 首次精确/相似昵称均要展示 QQ 并确认后才能建立别名链接。
store = {}; linkedTargets = new Map(TARGETS); sent.length = 0; notices.length = 0;
r = await call({ ...base, messageId: 'first-exact-contact', plainContent: '问问艾莉哥哥醒没醒' });
check('首次精确联系人先要求确认 QQ 别名', r?.action === 'await-alias-confirmation' && notices.some((n) => n.text.includes('20003')), JSON.stringify({ r, notices }));
check('精确昵称未确认前不发送', sent.length === 0);
r = await call({ ...base, plainContent: '确认' });
await tick();
check('确认精确昵称后发送原内容并保存链接', r?.action === 'relay' && linkedTargets.get('艾莉哥哥') === 'private:20003' && sent.at(-1)?.body === '醒没醒', JSON.stringify({ r, sent, links: [...linkedTargets] }));
notices.length = 0;
r = await call({ ...base, plainContent: '问问艾莉哥哥睡没睡' });
await tick();
check('已建立精确昵称链接后不再询问', r?.action === 'relay' && notices.length === 0 && sent.at(-1)?.body === '睡没睡', JSON.stringify({ r, notices, sent }));

store = {}; linkedTargets = new Map(TARGETS); sent.length = 0; notices.length = 0;
r = await call({ ...base, plainContent: '给艾带句话，醒了回我' });
check('相近昵称只展示候选并等待用户确认', r?.action === 'await-alias-confirmation' && notices.some((n) => n.text.includes('艾莉哥哥') && n.text.includes('20003')), JSON.stringify({ r, notices }));
check('相近昵称确认前不转达', sent.length === 0);

store = {}; linkedTargets = new Map(TARGETS); sent.length = 0; notices.length = 0;
r = await call({ ...base, plainContent: '给玩三角洲那个带句话，醒了回我' });
check('语义/未知昵称搜不到时先索要 QQ 号', r?.action === 'await-target' && notices.some((n) => n.text.includes('QQ 号')), JSON.stringify({ r, notices }));
check('未知昵称不擅自转达', sent.length === 0);

let failedStore = {}, attempts = 0;
const failureCtx = {
  ...ctx,
  state: { get: () => failedStore, set: (patch) => Object.assign(failedStore, patch) },
  capabilities: {
    ...ctx.capabilities,
    relaySend: async () => { attempts++; return { ok: attempts > 1 }; }
  }
};
const failurePlugin = createPlugin(failureCtx);
await failurePlugin.hooks.relayIncoming({ ...guest, plainContent: '给管理员带句话，首次失败' });
await tick();
await failurePlugin.hooks.relayIncoming({ ...guest, plainContent: '给管理员带句话，再试一次' });
await tick();
check('发送结果不确定仍保留间隔，避免重复转达', attempts === 1 && !!failedStore.lastRelayAt?.[guest.key], JSON.stringify({ attempts, failedStore }));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n传话组件测试通过');
