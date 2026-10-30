const { clamp, moodPolicy, validKey, validUser, validateMoodConfig } = await import((()=>{const u=new URL('./policy.mjs',import.meta.url);u.search=new URL(import.meta.url).search;return u.href;})());
const { createMoodLedger } = await import((()=>{const u=new URL('./ledger.mjs',import.meta.url);u.search=new URL(import.meta.url).search;return u.href;})());

export function createPlugin(ctx) {
  function effective(entry, { initial = 60 } = {}) {
    const base = Number.isFinite(Number(entry.score)) ? Number(entry.score) : Number(initial);
    return Math.round(clamp(base));
  }
  const mood = createMoodLedger(ctx, () => moodPolicy(ctx.config));
  return { validateConfig: validateMoodConfig, hooks: { onTick(payload = {}) {
    const result = mood.settle(payload);
    if (mood.policy().enabled === false) return result;
    for (const [key, entry] of Object.entries(ctx.state.get().mood?.conversations || {})) {
      if (!entry.welcomeBurstPending) continue;
      // Reuse the existing scheduler and read-only lifecycle facts. Unknown or
      // busy conversations must not be cancelled by the cooldown clock.
      let facts;try { facts = ctx.capabilities?.getProactiveFacts?.(key); } catch { continue; }
      if (facts?.busy === false && facts.conversationAwake === false) mood.cancelWelcome({ key, now: payload.now ?? Date.now() });
    }
    return result;
  } }, services: { mood, 'mood-users': {
    record({ key, userId, delta, initial = 60, now = Date.now() } = {}) {
      if (!validKey(key) || !validUser(userId) || !Number.isFinite(Number(delta)) || Number(delta) === 0) return { ok: false };
      const members = { ...(ctx.state.get().members || {}) };
      const id = key + '#' + userId;
      const previous = members[id] || { score: clamp(Number(initial)), updatedAt: now };
      const score = Math.round(clamp(effective(previous, { initial }) + Number(delta)));
      members[id] = { score, updatedAt: now };
      const entries = Object.entries(members).sort((a, b) => Number(b[1].updatedAt) - Number(a[1].updatedAt)).slice(0, 200);
      ctx.state.set({ members: Object.fromEntries(entries) });
      return { ok: true, score };
    },
    list({ key, initial = 60 } = {}) {
      if (!validKey(key)) return { ok: false, items: [] };
      const prefix = key + '#';
      return { ok: true, items: Object.entries(ctx.state.get().members || {})
        .filter(([id]) => id.startsWith(prefix))
        .map(([id, entry]) => ({ userId: id.slice(prefix.length), mood: effective(entry, { initial }), updatedAt: Number(entry.updatedAt) || 0 }))
        .sort((a, b) => b.updatedAt - a.updatedAt) };
    }
  } } };
}
