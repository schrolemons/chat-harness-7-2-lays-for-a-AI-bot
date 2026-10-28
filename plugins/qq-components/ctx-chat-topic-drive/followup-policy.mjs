export function effectiveFollowupLimits(global = {}, session = {}) {
  const number = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const globalInterval = number(global.minIntervalMinutes, 180);
  const globalDaily = Math.round(number(global.dailyLimit, 1));
  const sessionInterval = number(session.minIntervalMinutes, globalInterval);
  const sessionDaily = Math.round(number(session.dailyLimit, globalDaily));
  return {
    minIntervalMinutes: Math.min(globalInterval, sessionInterval),
    dailyLimit: Math.min(globalDaily, sessionDaily)
  };
}

export function isFollowupAllowed({ limits, lastSentAt = 0, sentToday = 0, now = Date.now() } = {}) {
  if (!limits || Number(limits.dailyLimit) <= 0 || Number(sentToday) >= Number(limits.dailyLimit)) return false;
  const last = Number(lastSentAt) || 0;
  const interval = Math.max(0, Number(limits.minIntervalMinutes) || 0) * 60000;
  return !last || now - last >= interval;
}
