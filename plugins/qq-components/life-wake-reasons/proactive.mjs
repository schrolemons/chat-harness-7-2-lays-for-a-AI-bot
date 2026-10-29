const policyUrl = new URL('./proactive-policy.mjs', import.meta.url);
policyUrl.search = new URL(import.meta.url).search;
const { normalizeProactivePolicy, validateProactivePolicy, effectiveProactiveStage, isProactiveCurfew } = await import(policyUrl.href);
const MINUTE = 60000;
const conversational = new Set(['message', 'reply', 'private', 'question', 'atMention', 'poke']);
const mechanical = /^(thinking|thinkingAck|ack|messageAck|replyCheck)$/;
const clamp = n => Math.max(0, Math.min(100, n));
export function createProactive(ctx) {
  const p = normalizeProactivePolicy(ctx.config), valid = validateProactivePolicy(p);
  const recoveredAccepted = new Set(Object.entries(ctx.state?.get?.().proactiveByKey || {}).filter(([, s]) => s.phase === 'accepted').map(([key]) => key));
  const jobId = key => `proactive:${key}`;
  const get = key => ctx.state.get().proactiveByKey?.[key] || { stage: 0, willingness: p.initialWillingness, source: 'default', phase: 'idle' };
  const put = (key, value) => ctx.state.set({ proactiveByKey: { ...(ctx.state.get().proactiveByKey || {}), [key]: value } });
  const cancel = key => ctx.scheduler?.cancel(jobId(key));
  const factsFor = key => ctx.capabilities?.getProactiveFacts?.(key);
  function blocked(facts, now) {
    if (!valid.ok) return 'invalid_policy';
    if (!p.proactiveEnabled || p.disabledReasons.includes('proactiveCheck')) return 'disabled';
    if (!facts || facts.allowed !== true) return 'not_allowed';
    if (facts.paused) return 'paused';
    if (facts.quiet) return 'quiet';
    if (isProactiveCurfew(p, now)) return 'curfew';
    if (facts.budgetAllowed !== true) return 'budget';
    if (facts.busy) return 'busy';
    if (facts.pendingPurpose) return 'pending_purpose';
    if (facts.rateAllowed === false) return 'rate';
    return '';
  }
  function plan({ key, now = Date.now(), facts, mood, random = Math.random } = {}) {
    key = String(key || '');
    if (!/^(private|group):\d+$/.test(key)) return { allowed: false, reason: 'invalid_key' };
    let s = get(key); const reason = blocked(facts, now);
    if (reason) { put(key, { ...s, blockedReason: reason }); cancel(key); return { allowed: false, reason, nextAt: s.nextAt ?? null }; }
    if (s.phase === 'accepted') return { allowed: false, reason: 'accepted', intent: s.intent, nextAt: null };
    const effective = effectiveProactiveStage(p, s.stage, s.willingness, mood || facts.mood);
    if (!Number.isFinite(s.nextAt)) {
      const startAt = Number.isFinite(s.lastActivityAt) ? s.lastActivityAt : Number.isFinite(s.startAt) ? s.startAt : Math.max(Number(facts.lastIncomingAt) || 0, Number(facts.lastOutboundAt) || 0) || now;
      const jitter = Math.max(0, Math.min(1, Number(random()) || 0));
      const intervalMinutes = effective.effectiveInterval.minMinutes + jitter * (effective.effectiveInterval.maxMinutes - effective.effectiveInterval.minMinutes);
      const after = Number.isFinite(s.checkedAt) ? s.checkedAt : startAt + p.silenceMinutes * MINUTE;
      const lastSent = Math.max(Number(s.lastProactiveAt) || 0, Number(facts.lastOutboundAt) || 0);
      const gapAt = lastSent ? lastSent + p.minActiveGapMinutes * MINUTE : 0;
      const forceAt = startAt + p.maxSilenceMinutes * MINUTE;
      s = { ...s, startAt, jitter, nextAt: Math.max(gapAt, s.noSendAt ? after + intervalMinutes * MINUTE : Math.min(after + intervalMinutes * MINUTE, forceAt)),
        intent: 'proactiveCheck', phase: 'scheduled', blockedReason: '', ...effective };
      put(key, s);
    } else { s = { ...s, blockedReason: '', ...effective }; put(key, s); }
    return { allowed: true, nextAt: s.nextAt, intent: s.intent, reason: now >= s.nextAt ? 'due' : 'waiting' };
  }
  function refresh({ key, now = Date.now(), random = Math.random } = {}) {
    const facts = factsFor(key);
    if (!ctx.scheduler || !ctx.capabilities?.requestProactiveWake || !facts || typeof facts.then === 'function') { cancel(key); return { allowed: false, reason: 'capabilities_unavailable' }; }
    if (recoveredAccepted.has(key) && facts.busy === false && !facts.pendingPurpose) {
      recoveredAccepted.delete(key); finished({ key, now, reason: 'recovered-orphan' });
    }
    const result = plan({ key, now, facts, random });
    if (!result.allowed) return result;
    ctx.scheduler.schedule({ id: jobId(key), owner: 'life-wake-reasons', type: 'proactive', at: result.nextAt, run: async ({ now: dueNow = Date.now() } = {}) => {
      const latest = factsFor(key), check = plan({ key, now: dueNow, facts: latest, random });
      if (!check.allowed || check.nextAt > dueNow) return;
      let s = get(key);
      const force = dueNow - s.startAt >= p.maxSilenceMinutes * MINUTE;
      if (!force && random() >= s.effectiveProbability) {
        put(key, { ...s, stage: s.stage + 1, checkedAt: dueNow, nextAt: null, phase: 'idle' });
        refresh({ key, now: dueNow, random }); return;
      }
      // Reserve before awaiting: acceptance is an opportunity, never a delivery receipt.
      put(key, { ...s, phase: 'accepted', nextAt: null, acceptedAt: dueNow });
      try {
        const accepted = await ctx.capabilities.requestProactiveWake({ key, reason: 'proactiveCheck', intent: s.intent, at: dueNow });
        if (!(accepted === true || accepted?.accepted === true || accepted?.ok === true)) finished({ key, now: dueNow });
      } catch (error) { finished({ key, now: dueNow }); ctx.warn?.(`主动唤醒请求失败：${error.message}`); }
    } });
    return result;
  }
  function observe({ key, at = Date.now(), kind, reason = '', eventId, episodeId, hasText, hasImage, isSelf, success } = {}) {
    if (!/^(private|group):\d+$/.test(String(key || '')) || !Number.isFinite(at)) return { ok: false, reengaged: false };
    if ((kind === 'incoming' && ((!hasText && !hasImage) || isSelf)) || (kind === 'sent' && (success === false || mechanical.test(reason))) || !['incoming', 'sent'].includes(kind)) return { ok: false, reengaged: false };
    const s = get(key), events = s.events || {}, episodes = s.episodes || {};
    if (eventId && Object.hasOwn(events, eventId)) return { ok: true, duplicate: true, reengaged: false };
    if (Number.isFinite(s.lastActivityAt) && at < s.lastActivityAt) {
      if (eventId) put(key, { ...s, events: { ...events, [eventId]: at } });
      return { ok: true, stale: true, reengaged: false };
    }
    const oldActivity = Number.isFinite(s.lastActivityAt) ? s.lastActivityAt : s.startAt;
    const reengaged = kind === 'incoming' && Number.isFinite(oldActivity) && at - oldActivity >= p.silenceMinutes * MINUTE;
    const deltaKey = `${kind}:${episodeId || eventId || at}`;
    let willingness = s.willingness, source = s.source;
    const delta = kind === 'incoming' ? p.activityWillingnessDelta : conversational.has(reason) ? 0 : p.purposeWillingnessDelta;
    if (!episodes[deltaKey] && delta !== 0) { willingness = clamp(willingness + delta); source = kind === 'incoming' ? 'activity' : 'purpose'; }
    const lastActivityAt = Math.max(Number(s.lastActivityAt) || 0, at);
    put(key, { ...s, stage: 0, checkedAt: null, noSendAt: null, nextAt: null, phase: 'idle', startAt: lastActivityAt, lastActivityAt,
      willingness, source, ...(kind === 'sent' && reason === 'proactiveCheck' ? { lastProactiveAt: lastActivityAt } : {}),
      events: eventId ? { ...events, [eventId]: at } : events, episodes: { ...episodes, [deltaKey]: at }, blockedReason: '' });
    cancel(key); return { ok: true, reengaged };
  }
  function finished({ key, now = Date.now(), reason = 'no-send' } = {}) {
    const s = get(key); if (s.phase !== 'accepted') return { ok: true, released: false };
    // No-send turns retain the silence episode but wait a fresh full interval, including after force deadline.
    put(key, { ...s, phase: 'idle', nextAt: null, checkedAt: now, noSendAt: now, lastFinishedReason: reason,
      lifecycleHistory: [...(s.lifecycleHistory || []), { at: now, reason }].slice(-100) }); cancel(key);
    return { ok: true, released: true };
  }
  return { policy: () => ({ ...p }), plan, refresh, observe, finished,
    cancel({key}={}) { cancel(key); return {ok:true}; },
    allowsReason({reason,now=Date.now(),hasPendingHuman=false}={}) {
      const r=String(reason||'').split(':')[0];
      if(['replyCheck','timeout'].includes(r) && !hasPendingHuman)return {allowed:false,reason:'observation_only'};
      if(['proactiveCheck','timeBubble','startupGreeting','privateFollowup','newsShare'].includes(r) && isProactiveCurfew(p,now))return {allowed:false,reason:'curfew'};
      return {allowed:true};
    },
    isCurfew: ({ now = Date.now() } = {}) => isProactiveCurfew(p, now),
    setWillingness({ key, value, reason = '', now = Date.now() } = {}) {
      if (!/^(private|group):\d+$/.test(String(key || '')) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100 || !String(reason).trim()) return { ok: false, reason: 'invalid_willingness' };
      put(key, { ...get(key), willingness: value, source: 'ai', lastAI: { value, reason: String(reason).slice(0, 300), at: now } });
      return { ok: true, value };
    },
    preview({ key, now = Date.now() } = {}) {
      const s = get(key), facts = factsFor(key);
      return { stage: s.stage, willingness: s.willingness, source: s.source, lastAI: s.lastAI || null,
        ...effectiveProactiveStage(p, s.stage, s.willingness, facts?.mood), nextAt: s.nextAt ?? null,
        blockedReason: blocked(facts, now) || s.blockedReason || '', intent: s.intent || 'proactiveCheck', phase: s.phase, lastFinishedReason: s.lastFinishedReason || '' };
    }
  };
}
