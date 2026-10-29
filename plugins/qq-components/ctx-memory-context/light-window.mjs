// A behavior impression is scoped to real speakers in the current message window.
export function windowImpressions(st = {}, { limit = 20 } = {}) {
  const speakers = new Set(), times = [];
  const messages = new Map();
  for (const list of [st.recentMessages, st.unread]) for (const message of Array.isArray(list) ? list : []) {
    if (message) messages.set(message.messageId || (Number.isSafeInteger(message.seq) && message.seq > 0 ? message.seq : message), message);
  }
  const stamp = message => {
    const value = Number(message.at ?? message.time);
    return Number.isFinite(value) ? value > 0 && value < 1e11 ? value * 1000 : value : 0;
  };
  const ordered = [...messages.values()].sort((a, b) =>
    Number.isSafeInteger(a.seq) && a.seq > 0 && Number.isSafeInteger(b.seq) && b.seq > 0
      ? a.seq - b.seq : stamp(a) - stamp(b));
  for (const message of ordered.slice(-Math.max(1, Number(limit) || 20))) {
    if (!message || message.isSelf) continue;
    for (const value of [message.userId, message.user_id, message.sender, message.who]) {
      if (value != null && String(value).trim()) speakers.add(String(value).trim().toLocaleLowerCase());
    }
    let at = Number(message.at ?? message.time);
    if (at > 0 && at < 1e11) at *= 1000;
    if (Number.isFinite(at) && at > 0) times.push(at);
  }
  const start = times.length ? Math.min(...times) : 0;
  return Object.fromEntries(Object.entries(st.memberImpressions || {}).filter(([name, impression]) => speakers.has(name.trim().toLocaleLowerCase())
    && (!start || Number(impression?.lastSeenAt) >= start)));
}
