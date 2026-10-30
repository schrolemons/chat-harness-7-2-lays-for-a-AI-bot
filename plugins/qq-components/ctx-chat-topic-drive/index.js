// 会话推进插件：把 conversation-drive.js 的判定从桥接主程序搬进插件目录。
// 插件只负责「这一轮要不要追问/起话题」，判定逻辑仍是仓库里的 conversation-drive 模块，
// 决定语义，真实发送后才消费组件自己的冷却；静默时机由 life-wake-reasons 统一授予。

import { createTurnPolicy } from '../personal-core/turn-policy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { PRIVATE_FOLLOWUP_POLICY } from '../../../src/qq-reply-policy.js';
const helperUrl = relative => { const url = new URL(relative, import.meta.url); url.search = new URL(import.meta.url).search; return url.href; };
const [{ planConversationDrive }, { effectiveFollowupLimits, isFollowupAllowed }, { createTopicActions }, { createPrivateFollowup }] = await Promise.all([
  import(helperUrl('../../../src/conversation-drive.js')), import(helperUrl('./followup-policy.mjs')), import(helperUrl('./topic-actions.mjs')), import(helperUrl('./private-followup.mjs'))
]);

const NON_CHAT_REASONS = /^(selfReview|selfOptimize|memoryWrite|timeBubble|startupGreeting|reminder|newFriend|newsShare|careCheck|idleRescue|replyCheck)/;

export function createPlugin(ctx) {
  const referencePolicy = createTurnPolicy(ctx);
  const cfg = ctx.config || {};
  const state = ctx.state;
  const topicActions = createTopicActions(ctx, cfg);
  const conversationDrive = { ...topicActions, sent({ key, success, eventId, episodeId, at = Date.now(), kind, text = '', topicId, topicLease, originReason } = {}) {
    if (success !== true || !/^(private|group):\d+$/.test(String(key || ''))) return { ok: false };
    const actual = topicActions.delivered({ key, success, topicLease, kind, text, episodeId, originReason });
    if (actual.independentPrivateFollowup) return { ok: true, recorded: false, isProactive: true, episodeId: actual.episodeId, kind: 'privateFollowup' };
    kind = actual.kind || kind; episodeId = actual.episodeId || episodeId; topicId = actual.topicId || topicId;
    const current = state.get(), drive = { ...(current.driveByKey?.[key] || {}), ...(topicId ? {currentTopicId:String(topicId)} : {}) }, receipts = drive.receipts || {}, episodes = drive.episodes || {};
    const id = String(eventId || episodeId || ''), episode = String(episodeId || eventId || '');
    if (!id || receipts[id]) return { ok: false, duplicate: !!receipts[id] };
    const actualQuestion = /[?？]/.test(String(text)) || kind === 'followup';
    if (!['followup', 'newTopic'].includes(kind) && !actualQuestion) return { ok: true, recorded: false };
    const seen = typeof episodes[episode] === 'object' ? episodes[episode] : {};
    const semantic = kind === 'newTopic' ? 'newTopic' : 'followup';
    const patch = { ...drive, receipts: { ...receipts, [id]: at }, episodes: { ...episodes, [episode]: { ...seen, [semantic]: true } }, driveCount: (drive.driveCount || 0) + (episodes[episode] ? 0 : 1),
      ...(actualQuestion ? { lastQuestionAt: Math.max(Number(drive.lastQuestionAt) || 0, at) } : {}),
      ...(!seen.followup && semantic === 'followup' ? { driveFollowUpAt: at, driveLastKind: 'followup', followupByTopic: {...(drive.followupByTopic||{}),[String(topicId||drive.currentTopicId||'current')]:at} } : {}),
      ...(!seen.newTopic && semantic === 'newTopic' ? { driveNewTopicAt: at, driveLastKind: 'newTopic', lastTopicId: String(topicId || text), driveNewTopicTimes: [...(drive.driveNewTopicTimes || []).filter(t => t > at - 3600000), at] } : {}) };
    state.set({ driveByKey: { ...(current.driveByKey || {}), [key]: patch } }); return { ok: true, recorded: true, isProactive: actual.isProactive === true, episodeId: episode, kind: semantic };
  } };
  const discardPendingFollowup = () => {
    if (state.get().pendingFollowup) state.set({ pendingFollowup: null });
  };
  // Config reload preserves state; turning this off cancels queued followups
  // immediately so enabling it later cannot replay a cancelled send.
  if (cfg.privateFollowupEnabled === false) discardPendingFollowup();
  const eligible = (groupKey, userId) => {
    if (!/^group:\d+$/.test(String(groupKey || '')) || !/^\d{1,20}$/.test(String(userId || ''))) return false;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(ctx.root || process.cwd(), 'state', 'person-profiles.json'), 'utf8'));
      const person = data?.people?.[String(userId)];
      return !!person && Array.isArray(person.keys)
        && person.keys.includes(groupKey) && person.keys.includes('private:' + userId);
    } catch { return false; }
  };
  const privateFollowup = createPrivateFollowup(ctx, cfg, eligible);
  const sessionSettings = () => cfg.sessionLimits && typeof cfg.sessionLimits === 'object' ? cfg.sessionLimits : {};
  ctx.registerTool('private_followup_send', {
    description: '群聊回复完成后，如果本轮实际发言者值得关心，或你对其具体经历/话题确实感兴趣且自然想了解后续，应使用本工具向其私聊追问一句。只问一个简短、具体的问题，不复述群里回复；必须使用本轮群聊 key 和实际发言者 QQ。系统会校验真实私聊关系、会话白名单、当前发言者和冷却/日上限，不要尝试绕过限制。',
    schema: { type: 'object', required: ['groupKey', 'userId', 'text'], properties: {
      groupKey: { type: 'string', description: '本轮群聊 key，例如 group:20011' },
      userId: { type: 'string', description: '本轮群消息实际发送者 QQ 号' },
      text: { type: 'string', description: '一条简短的私聊追问，不复述群聊回复' }
    } },
    handler: privateFollowup.request
  });
  return {
    validateConfig: topicActions.validateConfig,
    services: { conversationDrive: { ...conversationDrive, afterWait: payload => referencePolicy(payload).mode !== 'off' ? {action:'wait'} : topicActions.afterWait(payload) } },
    hooks: {
      beforePrompt(payload) {
        if (referencePolicy(payload).mode !== 'off') return '';
        if (payload?.reason && NON_CHAT_REASONS.test(String(payload.reason))) return '';
        const st = payload?.st;
        if (!st) return '';
        const key = String(payload?.key || '');
        const lines = [];
        if (key.startsWith('group:') && cfg.privateFollowupEnabled !== false) {
          const unread = Array.isArray(st.unread) ? st.unread.filter((m) => m && !m.isSelf) : [];
          const speaker = unread.at(-1);
          const userId = String(speaker?.userId || speaker?.user_id || '');
          if (eligible(key, userId)) {
            const limits = effectiveFollowupLimits({ minIntervalMinutes: cfg.minIntervalMinutes, dailyLimit: cfg.dailyLimit }, sessionSettings()['private:' + userId] || {});
            lines.push(`${PRIVATE_FOLLOWUP_POLICY}
【本轮可用工具与限制】仅对当前群会话本轮实际发言者调用：groupKey=${key}、userId=${userId}。先成功完成群聊回复，再调用 private_followup_send；不得用私聊追问替代群内回复。只发一句简短、具体的私聊追问，不复述群里的回复。当前硬限制：两次私聊跟进至少间隔 ${limits.minIntervalMinutes} 分钟，每天最多 ${limits.dailyLimit} 次。`);
          }
        }
        const plan = planConversationDrive({
          state: { ...st, ...(state.get().driveByKey?.[key] || {}) },
          config: cfg,
          now: Date.now(),
          proactive: payload.reason === 'proactiveCheck',
          mood: payload.mood,
          needsClarification: payload.needsClarification === true,
          topicIntent: payload.topicIntent,
          waiting: payload.waiting === true,
          isGroup: String(payload?.key || '').startsWith('group:')
        });
        if (plan && plan.kind !== 'none' && plan.line) {
          lines.unshift(plan.line);
        }
        return lines.join('\n\n');
      }
      ,onIncoming(payload = {}) {
        topicActions.incoming(payload);
        const key = String(payload.key || ''), userId = String(payload.userId || '');
        if (!key.startsWith('group:') || !/^\d{1,20}$/.test(userId)) return;
        const recent = state.get().recentGroupSpeakers || {};
        const next = { ...recent, [key]: { userId, messageId: String(payload.messageId || ''), at: Number(payload.at) || Date.now(), followupUsed: false } };
        for (const [groupKey, item] of Object.entries(next)) if (Date.now() - Number(item?.at) > 30 * 60000) delete next[groupKey];
        const pending = state.get().pendingFollowup;
        state.set({ recentGroupSpeakers: next, ...(pending?.groupKey === key ? { pendingFollowup: null } : {}) });
      },
      afterSend: privateFollowup.afterSend
    }
  };
}
