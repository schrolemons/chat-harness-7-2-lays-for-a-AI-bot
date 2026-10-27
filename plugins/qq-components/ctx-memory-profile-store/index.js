// 全局用户画像插件：把 user-profile.js 的存储与注入从桥接主程序搬进插件目录。
//
// 桥接只做两件事：收消息时 emitIncoming（插件自己记身份），拼提示词时 collectPromptBlocks。
// 其它模块（比如记忆落库）通过插件工具调用写入，避免第二份内存缓存互相覆盖。

import path from 'node:path';
import { createUserProfileStore } from '../../../src/user-profile.js';

const BAD_NAMES = new Set(['私聊', '群聊', '我']);

const NON_CHAT_REASONS = /^(selfReview|selfOptimize|memoryWrite|timeBubble|startupGreeting|reminder|newFriend|newsShare|careCheck|idleRescue|proactiveCheck|replyCheck)/;
const ACTIVE_GROUP_TTL_MS = 24 * 60 * 60 * 1000;

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const store = createUserProfileStore({ file: path.join(ctx.root, 'state', 'user-profiles.json'), logger: ctx.log });
  const recentGroupActivity = new Map();

  function isWarmTarget({ key, target } = {}) {
    const convKey = String(key || '').trim();
    const wanted = String(target || '').trim().toLocaleLowerCase();
    if (!convKey.startsWith('group:') || !wanted) return false;
    const snapshot = store.snapshot();
    return Object.values(snapshot.users).some((user) => Number(user.warmConnectionAt) > 0
      && Array.isArray(user.keys) && user.keys.includes(convKey)
      && [...(user.names || []), ...(user.fields?.aliases || [])]
        .some((name) => String(name).trim().toLocaleLowerCase() === wanted));
  }

  function cleanName(name) {
    const n = String(name || '').trim();
    return BAD_NAMES.has(n) ? '' : n;
  }

  ctx.registerTool('profile_record_note', {
    description: '给某个用户记一条画像备注（自动脱敏决定能不能跨会话分享）',
    handler: ({ userId, name, trait, key, at } = {}) => {
      const shareable = store.recordNote({ userId, name: cleanName(name), trait, key, at });
      return { ok: true, shareable };
    }
  });
  ctx.registerTool('profile_record_facts', {
    description: '写入结构化画像字段：{ aliases, likes, dislikes, recents, quotes }',
    handler: ({ userId, name, key, at, facts } = {}) => {
      const changed = store.recordFacts({ userId, name: cleanName(name), key, at, facts });
      return { ok: true, changed };
    }
  });
  ctx.registerTool('profile_promote_impression', {
    description: '将已核实且获得小鲸鱼明确正向好感的群友临时印象迁入其人物档案。只接受近24小时在该群实际发言的 QQ 号；仅在返回 saved=true 后，才可用 qq_memory_remove 删除原 memberImpression。',
    schema: {
      type: 'object',
      required: ['userId', 'name', 'key', 'target', 'traits'],
      properties: {
        userId: { type: 'string', description: '当前群聊实际发言者的 QQ 号，必须来自消息元数据' },
        name: { type: 'string', description: '当前群聊消息元数据中的实际昵称' },
        key: { type: 'string', description: '当前群会话 key，如 group:10001' },
        target: { type: 'string', description: '轻量记忆里原印象使用的目标名字，必须是该用户已知昵称' },
        traits: { type: 'array', items: { type: 'string' }, description: '要迁入档案的原印象条目，最多10条' }
      }
    },
    handler: ({ userId, name, key, target, traits } = {}) => {
      const id = String(userId || '').trim();
      const convKey = String(key || '').trim();
      const requestedName = cleanName(name).toLocaleLowerCase();
      const impressionTarget = cleanName(target);
      const activity = recentGroupActivity.get(convKey + '\0' + id);
      const at = Date.now();
      if (!/^\d{1,20}$/.test(id) || !convKey.startsWith('group:') || !impressionTarget
        || !activity || at - activity.at < 0 || at - activity.at > ACTIVE_GROUP_TTL_MS
        || requestedName !== activity.name.toLocaleLowerCase()) return { ok: false, saved: false };
      const saved = store.recordPromotedImpression({
        userId: id,
        name: activity.name,
        key: convKey,
        target: impressionTarget,
        traits,
        at
      });
      return saved ? { ok: true, saved: true, target: impressionTarget, warmConnectionAt: at }
        : { ok: false, saved: false, target: impressionTarget };
    }
  });
  ctx.registerTool('profile_snapshot', {
    description: '查看完整用户画像（管理端用）',
    handler: () => store.snapshot()
  });

  ctx.registerTool('profile_sync_impressions', {
    description: '旧版兼容入口：轻量印象不再复制到全局人物档案。',
    schema: { type: 'object', properties: {} },
    handler: () => ({ ok: true, synced: 0, skipped: 'deprecated' })
  });

  return {
    services: { profileStore: { isWarmTarget } },
    hooks: {
      onIncoming(payload) {
        const text = String(payload?.text ?? '');
        if (!text) return;
        const key = String(payload?.key || '');
        const userId = String(payload?.userId || '').trim();
        if (key.startsWith('group:') && /^\d{1,20}$/.test(userId)) {
          const at = Number(payload?.at) || Date.now();
          recentGroupActivity.set(key + '\0' + userId, { at, name: cleanName(payload?.sender) });
          for (const [contactKey, contact] of recentGroupActivity) {
            if (at - contact.at > ACTIVE_GROUP_TTL_MS || at < contact.at - 60000) recentGroupActivity.delete(contactKey);
          }
          while (recentGroupActivity.size > 2000) recentGroupActivity.delete(recentGroupActivity.keys().next().value);
        }
        try {
          store.recordContact({
            userId,
            name: cleanName(payload?.sender),
            key: payload?.key,
            at: payload?.at,
            isOwner: !!payload?.isOwner
          });
        } catch (error) { ctx.warn('recordContact 失败: ' + (error?.message ?? error)); }
      },
      beforePrompt(payload) {
        if (payload?.reason && NON_CHAT_REASONS.test(String(payload.reason))) return '';
        const st = payload?.st;
        const participants = [];
        const key = String(payload?.key || '');
        for (const messages of [st?.unread, st?.recentMessages]) {
          if (!Array.isArray(messages)) continue;
          for (const message of messages) {
            if (!message || message.isSelf) continue;
            if (message.userId) participants.push(message.userId);
            if (message.user_id) participants.push(message.user_id);
            if (message.sender) participants.push(message.sender);
          }
        }
        if (key.startsWith('private:')) participants.push(key.slice(8));
        const excludeTexts = Object.values(st?.memberImpressions || {}).flatMap((im) => Array.isArray(im?.traits) ? im.traits : []);
        const block = store.blockFor({ participants, includeParticipants: false, excludeTexts, maxShare: Number(cfg.maxShare) || 3, includeOthers: cfg.shareAcrossConversations !== false });
        return block && block.text ? block.text : '';
      }
    }
  };
}
