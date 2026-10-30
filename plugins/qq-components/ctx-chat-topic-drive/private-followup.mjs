const policyURL=new URL('./followup-policy.mjs',import.meta.url);policyURL.search=new URL(import.meta.url).search;
const {effectiveFollowupLimits,isFollowupAllowed}=await import(policyURL.href);

// Queueing is a proposal. Only a confirmed delivery spends the independent cross-private quota.
export function createPrivateFollowup(ctx, cfg, eligible) {
  const state = ctx.state, day = at => new Date(at).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const limitsFor = id => effectiveFollowupLimits(cfg, cfg.sessionLimits?.['private:' + id] || {});
  const permitted = id => {
    const entry = state.get().followupSent?.[id] || {};
    return isFollowupAllowed({ limits: limitsFor(id), lastSentAt: entry.lastSentAt, sentToday: entry.day === day(Date.now()) ? entry.count : 0 });
  };
  async function dispatch(pending) {
    const current = state.get(), activity = current.recentGroupSpeakers?.[pending.groupKey];
    if (cfg.privateFollowupEnabled === false || !eligible(pending.groupKey, pending.userId)
      || activity?.userId !== pending.userId || activity?.at !== pending.sourceAt
      || Date.now() - pending.queuedAt > 5 * 60000 || !permitted(pending.userId)) return { ok: false, reason: 'expired_or_limited' };
    const actionId = `privateFollowup:${pending.groupKey}:${pending.userId}:${pending.sourceAt}`;
    const claims = current.followupClaims || {};
    if (claims[actionId] || Object.values(claims).some(x => x.userId === pending.userId && x.status === 'sending')) return { ok: false, reason: 'already_claimed' };
    state.set({ pendingFollowup: null, followupClaims: { ...claims, [actionId]: { userId: pending.userId, status: 'sending', at: Date.now() } } });
    let result;
    try { result = await ctx.capabilities.sendPrivateFollowup?.({ userId: pending.userId, text: pending.text, sourceKey: pending.groupKey, actionId }); }
    catch (error) { ctx.warn?.('群聊后私聊追问结果未知：' + error.message); return { ok: false, reason: 'unknown_delivery' }; }
    // Unknown outcomes retain the durable claim; never replay them automatically after reload.
    if (!result || typeof result.ok !== 'boolean') return { ok: false, reason: 'unknown_delivery' };
    const at = Date.now(), latest = state.get();
    state.set({ followupClaims: { ...(latest.followupClaims || {}), [actionId]: { userId: pending.userId, status: result.ok ? 'delivered' : 'failed', at } } });
    if (result.ok) {
      const entry = state.get().followupSent?.[pending.userId] || {};
      state.set({ followupSent: { ...(state.get().followupSent || {}), [pending.userId]: { day: day(at), count: (entry.day === day(at) ? Number(entry.count) || 0 : 0) + 1, lastSentAt: at } } });
    }
    return { ...result, sent: result.ok, limits: limitsFor(pending.userId) };
  }
  async function request({ groupKey, userId, text } = {}) {
    if (cfg.privateFollowupEnabled === false) return { ok: false, reason: 'disabled' };
    const group = String(groupKey || ''), id = String(userId || ''), body = String(text || '').trim();
    if (!eligible(group, id)) return { ok: false, reason: 'no_private_relationship' };
    const current = state.get(), activity = current.recentGroupSpeakers?.[group];
    if (!activity || activity.userId !== id || activity.followupUsed || Date.now() - activity.at > 30 * 60000) return { ok: false, reason: 'not_current_group_speaker' };
    if (!body || body.length > 300 || /[\r\n]/.test(body)) return { ok: false, reason: 'invalid_message' };
    if (!permitted(id)) return { ok: false, reason: 'rate_limited', limits: limitsFor(id) };
    if (current.pendingFollowup) return { ok: false, reason: 'pending_followup' };
    const pending = { groupKey: group, userId: id, sourceAt: activity.at, text: body, queuedAt: Date.now() };
    state.set({ recentGroupSpeakers: { ...current.recentGroupSpeakers, [group]: { ...activity, followupUsed: true } } });
    if (activity.replyDeliveredAt) return dispatch(pending);
    state.set({ pendingFollowup: pending });
    return { ok: true, queued: true, limits: limitsFor(id), note: '群内回复确认送达后再私聊；尚未占用次数' };
  }
  function afterSend({ key, success, sentAt = Date.now() } = {}) {
    if (cfg.privateFollowupEnabled === false || !success || !String(key).startsWith('group:')) return;
    const current = state.get(), activity = current.recentGroupSpeakers?.[key];
    if (!activity) return;
    state.set({ recentGroupSpeakers: { ...current.recentGroupSpeakers, [key]: { ...activity, replyDeliveredAt: sentAt } } });
    const pending = current.pendingFollowup;
    if (pending?.groupKey === key) return dispatch(pending);
  }
  return { request, afterSend };
}
