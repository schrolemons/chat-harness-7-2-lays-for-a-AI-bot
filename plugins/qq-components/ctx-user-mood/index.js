const clamp = (value) => Math.max(0, Math.min(100, value));
const validKey = (key) => /^(group|private):\d+$/.test(String(key));
const validUser = (userId) => /^\d+$/.test(String(userId));

export function createPlugin(ctx) {
  function effective(entry, { initial = 60, decayPerHour = 6, now = Date.now() } = {}) {
    const base = Number.isFinite(Number(entry.score)) ? Number(entry.score) : Number(initial);
    const drift = Math.max(0, now - Number(entry.updatedAt || now)) / 3600000 * Math.max(0, Number(decayPerHour) || 0);
    return Math.round(clamp(base < initial ? Math.min(initial, base + drift) : Math.max(initial, base - drift)));
  }
  return { services: { 'mood-users': {
    record({ key, userId, delta, initial = 60, decayPerHour = 6, now = Date.now() } = {}) {
      if (!validKey(key) || !validUser(userId) || !Number.isFinite(Number(delta)) || Number(delta) === 0) return { ok: false };
      const members = { ...(ctx.state.get().members || {}) };
      const id = key + '#' + userId;
      const previous = members[id] || { score: clamp(Number(initial)), updatedAt: now };
      const score = Math.round(clamp(effective(previous, { initial, decayPerHour, now }) + Number(delta)));
      members[id] = { score, updatedAt: now };
      const entries = Object.entries(members).sort((a, b) => Number(b[1].updatedAt) - Number(a[1].updatedAt)).slice(0, 200);
      ctx.state.set({ members: Object.fromEntries(entries) });
      return { ok: true, score };
    },
    list({ key, initial = 60, decayPerHour = 6, now = Date.now() } = {}) {
      if (!validKey(key)) return { ok: false, items: [] };
      const prefix = key + '#';
      return { ok: true, items: Object.entries(ctx.state.get().members || {})
        .filter(([id]) => id.startsWith(prefix))
        .map(([id, entry]) => ({ userId: id.slice(prefix.length), mood: effective(entry, { initial, decayPerHour, now }), updatedAt: Number(entry.updatedAt) || 0 }))
        .sort((a, b) => b.updatedAt - a.updatedAt) };
    }
  } } };
}
