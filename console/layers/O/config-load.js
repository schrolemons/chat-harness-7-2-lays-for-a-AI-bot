
// Apply only the O-layer configuration fields.
export function applyOConfig(c) {
const sr = c.selfReview || {};
document.getElementById('v2SelfReviewEnabled').checked = sr.enabled !== false;
document.getElementById('v2SelfReviewHours').value = sr.intervalHours ?? 6;
document.getElementById('v2SelfReviewAuto').checked = sr.autoOptimize !== false;
document.getElementById('v2SelfReviewCooldown').value = sr.optimizeCooldownHours ?? 2;
document.getElementById('v2SelfReviewFeedbackMax').value = sr.maxFeedbackFixesPerRound ?? 3;
document.getElementById('v2SelfReviewSelfMax').value = sr.maxSelfFixesPerRound ?? 3;
const ddCfg = c.dailyDiary || {};
document.getElementById('v2DdEnabled').checked = ddCfg.enabled !== false;
document.getElementById('v2DdHour').value = ddCfg.hour ?? 22;
document.getElementById('v2DdMinute').value = ddCfg.minute ?? 0;
document.getElementById('v2DdMaxChars').value = ddCfg.maxChars ?? 500;
const fb = c.feedback || {};
document.getElementById('v2FeedbackMaxLength').value = fb.maxLength ?? 500;
document.getElementById('v2FeedbackNotifyOwner').checked = fb.notifyOwnerOnError === true;
}
