export function mergeTimeBubbleSlots(current = [], proposed = [], opts = {}) {
  const actor = opts.actor === 'agent' ? 'agent' : 'console';
  const allLocked = opts.allLocked === true;
  const unlockAll = actor === 'console' && opts.proposedAllLocked === false;
  if (allLocked && !unlockAll) {
    return { slots: structuredClone(current), allLocked: true, rejected: true, conflicts: ['*'] };
  }
  const previous = new Map((Array.isArray(current) ? current : []).map((slot) => [String(slot.id), slot]));
  const slots = [];
  const conflicts = [];
  for (const raw of Array.isArray(proposed) ? proposed.slice(0, 20) : []) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id || '');
    if (!id) continue;
    const old = previous.get(id);
    const unlocking = actor === 'console' && old?.locked === true && raw.locked === false;
    if (old?.locked === true && !unlocking) {
      if (['hour', 'minute', 'label', 'hint', 'enabled'].some((field) => Object.hasOwn(raw, field) && raw[field] !== old[field]) || raw.locked === false) conflicts.push(id);
      slots.push(structuredClone(old));
      continue;
    }
    slots.push({ ...raw, id, locked: raw.locked === true });
  }
  for (const old of Array.isArray(current) ? current : []) {
    if (old?.locked === true && !slots.some((slot) => String(slot.id) === String(old.id))) {
      conflicts.push(String(old.id));
      slots.push(structuredClone(old));
    }
  }
  return {
    slots,
    allLocked: unlockAll ? false : (opts.proposedAllLocked === true || allLocked),
    rejected: false,
    conflicts
  };
}
