// Trusted stored facts or literal templates; no model or caller budget override.
export async function sendDirectTimedNotice({ key, reason, state, send, status, prepareBubble, releaseBubble, save, now = Date.now() }) {
  if (reason === 'timeBubble') {
    const pending = state.pendingTimeBubble;
    if (!pending) return;
    const id = `time-bubble:${key}:${state.lastTimeBubbleId || new Date(now).toISOString().slice(0, 10) + ':' + pending.label}`;
    const receipt = status(id);
    if (receipt.status === 'sent') { state.pendingTimeBubble = null; save(); return; }
    if (!receipt.ok || receipt.status !== 'absent') return;
    const text = prepareBubble({ key, label: pending.label });
    if (!text) return;
    let result;
    try { result = await send(key, text, { id, reason, sourceAt: now, expiresAt: now + 40 * 60000 }); }
    finally { if (status(id).status === 'absent') releaseBubble?.({ key }); }
    if (result.ok && state.pendingTimeBubble === pending) { state.pendingTimeBubble = null; save(); }
    return;
  }
  if (reason !== 'reminder') return;
  for (const item of [...state.pendingReminderItems || []]) {
    const interval = Math.max(60000, Number(item.intervalMinutes) * 60000 || 24 * 3600000);
    const cycle = Number(item.intervalMinutes) > 0 ? Math.floor((now - Number(item.dueAt)) / interval) : 0;
    const id = `schedule-direct:${key}:${item.id}:${item.dueAt}:${cycle}`;
    const result = await send(key, '日程提醒：' + item.text, { id, reason, sourceAt: now, expiresAt: now + interval });
    if (result.ok || result.reason === 'already_sent') {
      state.pendingReminderItems = state.pendingReminderItems.filter(current => current !== item);
      save();
    }
  }
}
