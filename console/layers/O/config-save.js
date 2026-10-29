
// Collect only the O-layer configuration fields.
export function collectOConfig() { return {
selfReview: {
      enabled: document.getElementById('v2SelfReviewEnabled').checked,
      intervalHours: Math.min(168, Math.max(1, Math.round(Number(document.getElementById('v2SelfReviewHours').value) || 6))),
      autoOptimize: document.getElementById('v2SelfReviewAuto').checked,
      optimizeCooldownHours: Math.min(168, Math.max(1, Math.round(Number(document.getElementById('v2SelfReviewCooldown').value) || 2))),
      maxFeedbackFixesPerRound: Math.min(20, Math.max(1, Math.round(Number(document.getElementById('v2SelfReviewFeedbackMax').value) || 3))),
      maxSelfFixesPerRound: Math.min(20, Math.max(1, Math.round(Number(document.getElementById('v2SelfReviewSelfMax').value) || 3)))
    },
dailyDiary: {
      enabled: document.getElementById('v2DdEnabled').checked,
      hour: Math.min(23, Math.max(0, Math.round(Number(document.getElementById('v2DdHour').value) || 22))),
      minute: Math.min(59, Math.max(0, Math.round(Number(document.getElementById('v2DdMinute').value) || 0))),
      maxChars: Math.min(2000, Math.max(50, Math.round(Number(document.getElementById('v2DdMaxChars').value) || 500)))
    },
feedback: {
      maxLength: Math.round(Number(document.getElementById('v2FeedbackMaxLength').value) || 500),
      notifyOwnerOnError: document.getElementById('v2FeedbackNotifyOwner').checked
    }
}; }
