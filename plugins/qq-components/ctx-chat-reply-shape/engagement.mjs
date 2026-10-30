// Availability is an objective estimate of the human's time/energy; mood is subjective affect.
const unit = n => Math.max(0, Math.min(1, n));
export function engagementFactors(mood = {}, willingness = 100) {
  const moodFactor = mood?.enabled === false ? 1 : Number.isFinite(mood?.score) ? .2 + .8 * unit(mood.score / 100)
    : Number.isFinite(mood?.frequencyFactor) ? Math.max(.2, unit(mood.frequencyFactor)) : 1;
  const availabilityFactor = Number.isFinite(willingness) ? .2 + .8 * unit(willingness / 100) : 1;
  const factor = moodFactor * availabilityFactor;
  return { moodFactor, availabilityFactor, factor, detailLevel: factor >= .75 ? 'expanded' : factor >= .45 ? 'balanced' : factor >= .2 ? 'concise' : 'brief' };
}
