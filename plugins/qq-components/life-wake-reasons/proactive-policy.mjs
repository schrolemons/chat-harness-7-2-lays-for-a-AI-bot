export const DEFAULT_PROACTIVE_POLICY = Object.freeze({
  proactiveEnabled: true, silenceMinutes: 20, initialProbability: .15, probabilityStep: .10,
  probabilityMax: .85, checkMinMinutes: 15, checkMaxMinutes: 30, intervalStepMinutes: -1,
  checkFloorMinutes: 1, minActiveGapMinutes: 30, maxSilenceMinutes: 180,
  initialWillingness: 60, activityWillingnessDelta: 10, purposeWillingnessDelta: -10,
  curfewEnabled: true, curfewStartHour: 23, curfewEndHour: 8
});
const ranges = {
  silenceMinutes: [0, 10080], initialProbability: [0, 1], probabilityStep: [0, 1], probabilityMax: [0, 1],
  checkMinMinutes: [1, 10080], checkMaxMinutes: [1, 10080], intervalStepMinutes: [-10080, 10080],
  checkFloorMinutes: [1, 10080], minActiveGapMinutes: [0, 10080], maxSilenceMinutes: [1, 10080],
  initialWillingness: [0, 100], activityWillingnessDelta: [-100, 100], purposeWillingnessDelta: [-100, 100],
  curfewStartHour: [0, 23], curfewEndHour: [0, 23]
};
export function validateProactivePolicy(raw = {}) {
  const p = { ...DEFAULT_PROACTIVE_POLICY, ...raw }, errors = [];
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] < min || p[key] > max) errors.push(`${key} must be ${min}..${max}`);
  }
  for (const key of ['proactiveEnabled', 'curfewEnabled']) if (typeof p[key] !== 'boolean') errors.push(`${key} must be boolean`);
  for (const key of ['curfewStartHour', 'curfewEndHour']) if (!Number.isInteger(p[key])) errors.push(`${key} must be integer`);
  if (p.checkMinMinutes > p.checkMaxMinutes) errors.push('checkMinMinutes must not exceed checkMaxMinutes');
  if (p.checkFloorMinutes > p.checkMinMinutes) errors.push('checkFloorMinutes must not exceed checkMinMinutes');
  if (p.initialProbability > p.probabilityMax) errors.push('initialProbability must not exceed probabilityMax');
  if (p.maxSilenceMinutes < p.silenceMinutes || p.maxSilenceMinutes < p.minActiveGapMinutes) errors.push('maxSilenceMinutes must cover silenceMinutes and minActiveGapMinutes');
  return { ok: errors.length === 0, errors };
}
export function normalizeProactivePolicy(raw = {}) {
  const p = { ...DEFAULT_PROACTIVE_POLICY };
  for (const key of Object.keys(p)) {
    if (typeof p[key] === 'boolean') { if (typeof raw[key] === 'boolean') p[key] = raw[key]; }
    else if (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= ranges[key][0] && raw[key] <= ranges[key][1]
      && (!key.endsWith('Hour') || Number.isInteger(raw[key]))) p[key] = raw[key];
  }
  // Invalid cross-field combinations fail closed at the service boundary, never silently swap endpoints.
  return { ...p, disabledReasons: Array.isArray(raw.disabledReasons) ? raw.disabledReasons.map(String) : [] };
}
export function effectiveProactiveStage(p, stage = 0, willingness = p.initialWillingness, mood = {}) {
  const m = mood.enabled === false ? 1 : Number.isFinite(mood.frequencyFactor) ? Math.max(.2, Math.min(1, mood.frequencyFactor))
    : Number.isFinite(mood.score) ? .2 + .8 * Math.max(0, Math.min(100, mood.score)) / 100 : 1;
  const e = m * (.2 + .8 * Math.max(0, Math.min(100, willingness)) / 100), n = Math.max(0, Math.floor(stage));
  return { effectiveProbability: Math.min(p.probabilityMax, (p.initialProbability + n * p.probabilityStep) * e),
    effectiveInterval: { minMinutes: Math.max(p.checkFloorMinutes, (p.checkMinMinutes + n * p.intervalStepMinutes) * (2 - e)),
      maxMinutes: Math.max(p.checkFloorMinutes, (p.checkMaxMinutes + n * p.intervalStepMinutes) * (2 - e)) } };
}
export function isProactiveCurfew(p, now) {
  if (!p.curfewEnabled || p.curfewStartHour === p.curfewEndHour) return false;
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
  return p.curfewStartHour < p.curfewEndHour ? h >= p.curfewStartHour && h < p.curfewEndHour : h >= p.curfewStartHour || h < p.curfewEndHour;
}
