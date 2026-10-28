const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function periodStart(now = Date.now()) {
  const local = new Date(now + SHANGHAI_OFFSET_MS);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 22) - SHANGHAI_OFFSET_MS;
  return now < start ? start - DAY_MS : start;
}

export function createPlugin(ctx) {
  const sessions = () => ctx.config?.sessions && typeof ctx.config.sessions === 'object' && !Array.isArray(ctx.config.sessions) ? ctx.config.sessions : {};
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
  return {
    services: { tokenBudget: { policy, assess, canDispatch, noteDispatch, period: ({ now = Date.now() } = {}) => ({ since: periodStart(now), until: now, resetAt: periodStart(now) + DAY_MS }) } },
    hooks: { beforePrompt(payload = {}) {
      if (payload.budgetStage !== 'weak') return '';
      return '【本轮节省用量】保持原有性格，简短自然地回复当前问题；只读取必要的近期消息，避免主动展开新话题或反复调用工具。';
    } }
  };
}
