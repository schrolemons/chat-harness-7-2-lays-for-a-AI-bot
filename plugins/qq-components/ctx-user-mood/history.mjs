const { clamp, DAILY_FLOOR, UNANSWERED_PENALTY, validScore } = await import((()=>{const u=new URL('./policy.mjs',import.meta.url);u.search=new URL(import.meta.url).search;return u.href;})());

const effectiveTime = event => event.effectiveAt ?? (event.source === 'unanswered' ? event.dueAt ?? event.at : event.at);

// A late receipt may reveal an older penalty. Replay the owned score events,
// preserving their evidence fields, so that penalty precedes a later daily floor.
export function recordHistory(entry, { at, source, before, reason, ...details }) {
  entry.history ||= [];
  if (!validScore(entry.baseScore)) entry.baseScore = entry.history[0]?.before ?? before;
  const event = { at, source, before, after: entry.score, delta: entry.score - before, reason, ...details, recordedAt: Date.now() };
  event.effectiveAt = effectiveTime(event);
  entry.history.push(event);
  entry.history.sort((a, b) => effectiveTime(a) - effectiveTime(b) || Number(b.source === 'unanswered') - Number(a.source === 'unanswered'));
  replayHistory(entry);
}

export function replayHistory(entry) {
  let score = entry.baseScore;
  for (const item of entry.history) {
    const previousDelta = item.delta;
    item.effectiveAt ??= effectiveTime(item);
    item.recordedAt ??= item.at;
    item.before = score;
    if (item.source === 'daily-first' || item.source === 'daily-recovery') score = Math.max(score, DAILY_FLOOR);
    else if (item.source === 'unanswered') score = item.voided === true ? score : clamp(score - UNANSWERED_PENALTY);
    else if (item.source === 'model-adjustment') score = clamp(score + (item.action === 'add' ? item.value : -item.value));
    else score = clamp(score + previousDelta);
    item.after = score;
    item.delta = score - item.before;
  }
  entry.score = score;
}
