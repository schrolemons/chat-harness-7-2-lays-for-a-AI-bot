// Policy only. Transport owns waiting, message snapshots and cancellation of the exact active turn.
export function createPlugin(ctx) {
  const config = { endProbabilityPercent: 50, probabilityStepPercent: 25, ...ctx.config };
  function validateConfig(candidate) {
    const c = { ...config, ...candidate };
    const ok = Number.isFinite(c.endProbabilityPercent) && c.endProbabilityPercent >= 0 && c.endProbabilityPercent <= 100
      && Number.isFinite(c.probabilityStepPercent) && c.probabilityStepPercent >= 1 && c.probabilityStepPercent <= 100;
    return { ok, errors: ok ? [] : ['p 必须为 0–100，q 必须为 1–100 个百分点'] };
  }
  const valid = validateConfig(config).ok;
  const save = (key, value) => {
    const chains = { ...(ctx.state.get().chains || {}), [key]: value };
    const keys = Object.keys(chains);
    if (keys.length > 1000) keys.sort((a, b) => chains[a].at - chains[b].at).slice(0, keys.length - 1000).forEach(k => delete chains[k]);
    ctx.state.set({ chains });
    return value;
  };
  function read({ key, scope, seq = 0 } = {}) {
    if (!valid || !/^(private|group):\d+$/.test(String(key)) || !scope) return { endRound: true, reason: 'invalid_wait_scope', emptyWaits: 0 };
    const old = ctx.state.get().chains?.[key];
    const s = old?.scope === scope && seq <= old.seq ? old : save(key, { scope, seq, emptyWaits: 0, endRound: false, at: Date.now() });
    return { ...s, maxEmptyWaits: Math.ceil((100 - config.endProbabilityPercent) / config.probabilityStepPercent) + 1 };
  }
  return { validateConfig, services: { waitCycle: {
    read,
    timeout(args = {}) {
      const s = read(args);
      // A message racing with timeout always wins. Quiet calls only use read().
      if (args.startSeq !== undefined && args.seq > args.startSeq) return read(args);
      if (s.endRound) return s;
      const probabilityPercent = Math.min(100, Math.round((config.endProbabilityPercent + s.emptyWaits * config.probabilityStepPercent) * 1e8) / 1e8);
      const roll = (args.random || Math.random)();
      const decision = { scope:s.scope, seq:s.seq, maxEmptyWaits:s.maxEmptyWaits, probabilityPercent, emptyWaits: s.emptyWaits + 1,
        endRound: probabilityPercent >= 100 || roll < probabilityPercent / 100, at: Date.now() };
      const choice = ctx.callService?.('conversationDrive',decision.endRound?'endWait':'afterWait',{...args,...decision});
      return save(args.key, { ...decision, ...(choice || {action:'wait',guidance:decision.endRound?'本轮已结束，不要继续等待或发起话题。':'本轮继续等待新来信。'}) });
    }
  } } };
}
