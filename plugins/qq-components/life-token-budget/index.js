import { DEFAULT_PRIVATE_REPLIES, DEFAULT_GROUP_REPLIES } from './default-replies.js';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function periodStart(now = Date.now()) {
  const local = new Date(now + SHANGHAI_OFFSET_MS);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 22) - SHANGHAI_OFFSET_MS;
  return now < start ? start - DAY_MS : start;
}

export function createPlugin(ctx) {
  const sessions = () => ctx.config?.sessions && typeof ctx.config.sessions === 'object' && !Array.isArray(ctx.config.sessions) ? ctx.config.sessions : {};
  const entries = (kind) => {
    const configured = kind === 'private' ? ctx.config?.mechanicalPrivateReplies : ctx.config?.mechanicalGroupReplies;
    const valid = Array.isArray(configured) ? configured.filter((item) => typeof item === 'string' && item.trim() && item.length <= 120).map((item) => item.trim()) : [];
    return valid.length ? valid : kind === 'private' ? [...DEFAULT_PRIVATE_REPLIES] : [...DEFAULT_GROUP_REPLIES];
  };
  function policy(key) {
    const all = sessions();
    const raw = Object.hasOwn(all, String(key)) ? all[String(key)] : {};
    const coldLimitYuan = Math.max(0, Number(raw.coldLimitYuan) || 0);
    const hardLimitYuan = Math.max(0, Number(raw.hardLimitYuan) || 0);
    const weakMinIntervalMin = Math.max(1, Math.min(1440, Number(raw.weakMinIntervalMin) || 30));
    return { coldLimitYuan, hardLimitYuan, weakMinIntervalMin };
  }
  function assess({ key, cost = 0, globalCost = 0, now = Date.now() } = {}) {
    const limits = policy(key);
    const spent = Math.max(0, Number(cost) || 0);
    const allSpent = Math.max(0, Number(globalCost) || 0);
    const globalHardLimitYuan = Math.max(0, Number(ctx.config?.globalHardLimitYuan) || 0);
    const stage = (globalHardLimitYuan > 0 && allSpent >= globalHardLimitYuan)
      || limits.hardLimitYuan > 0 && spent >= limits.hardLimitYuan ? 'silent'
      : limits.coldLimitYuan > 0 && spent >= limits.coldLimitYuan ? 'weak' : 'normal';
    return { key, ...limits, cost: spent, globalCost: allSpent, globalHardLimitYuan,
      remainingYuan: limits.hardLimitYuan > 0 ? Math.max(0, limits.hardLimitYuan - spent) : null,
      globalRemainingYuan: globalHardLimitYuan > 0 ? Math.max(0, globalHardLimitYuan - allSpent) : null,
      stage, periodStart: periodStart(now), resetAt: periodStart(now) + DAY_MS };
  }
  function canDispatch({ key, stage, now = Date.now() } = {}) {
    if (stage === 'silent') return false;
    if (stage !== 'weak') return true;
    const last = Number(ctx.state.get().lastWeakDispatch?.[String(key)]) || 0;
    return now - last >= policy(key).weakMinIntervalMin * 60_000;
  }
  function noteDispatch({ key, stage, now = Date.now() } = {}) {
    if (stage !== 'weak') return;
    const previous = ctx.state.get().lastWeakDispatch || {};
    ctx.state.set({ lastWeakDispatch: { ...previous, [String(key)]: now } });
  }
  function onSilentIncoming({ key, kind, messageId, atSelf = false, stage, periodStart: cycle = 0 } = {}) {
    if (!/^(private|group):[1-9]\d*$/.test(String(key)) || !['private', 'group'].includes(kind)) return { handled: false, text: null };
    const state = ctx.state.get();
    const previous = state.mechanical || {};
    if (stage !== 'silent') {
      if (previous[key]) { const next = { ...previous }; delete next[key]; ctx.state.set({ mechanical: next }); }
      return { handled: false, text: null };
    }
    const old = previous[key]?.periodStart === cycle ? previous[key] : { periodStart: cycle, count: 0, seenIds: [] };
    const id = String(messageId ?? '').slice(0, 120);
    if (id && old.seenIds.includes(id)) return { handled: true, text: null, duplicate: true };
    const seenIds = id ? [...old.seenIds.slice(-31), id] : old.seenIds.slice(-32);
    const count = kind === 'private' ? (Number(old.count) || 0) + 1 : 0;
    const shouldReply = kind === 'private' ? count >= 5 : atSelf === true;
    const next = { ...previous, [key]: { periodStart: cycle, count: shouldReply ? 0 : count, seenIds } };
    ctx.state.set({ mechanical: next });
    const pool = entries(kind);
    return { handled: true, text: shouldReply ? pool[Math.floor(Math.random() * pool.length)] : null, count: next[key].count };
  }
  return {
    services: { tokenBudget: { policy, assess, canDispatch, noteDispatch, onSilentIncoming,
      mechanicalReplies: () => ({ private: entries('private'), group: entries('group') }),
      period: ({ now = Date.now() } = {}) => ({ since: periodStart(now), until: now, resetAt: periodStart(now) + DAY_MS }) } },
    hooks: { beforePrompt(payload = {}) {
      if (payload.budgetStage !== 'weak') return '';
      return '【本轮节省用量】保持原有性格，简短自然地回复当前问题；只读取必要的近期消息，避免主动展开新话题或反复调用工具。';
    } }
  };
}
