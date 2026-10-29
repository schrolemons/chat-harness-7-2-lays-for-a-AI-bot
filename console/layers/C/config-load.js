
// Apply only the C-layer configuration fields.
export function applyCConfig(c) {
const stk = c.sticker || {};
document.getElementById('v2StickerEnabled').checked = stk.enabled !== false;
document.getElementById('v2StickerSyncTtlSec').value = Math.round((stk.syncTtlMs || 60000) / 1000);
document.getElementById('v2StickerMaxList').value = stk.maxListCount ?? 100;
document.getElementById('v2StickerPromptMax').value = stk.promptMaxStickers ?? 8;
document.getElementById('v2StickerIncludePrompt').checked = stk.includeInPrompt !== false;
document.getElementById('v2StickerRecentCooldown').value = stk.recentCooldownMinutes ?? 30;
const stkCollect = stk.collect || {};
document.getElementById('v2StickerCollectEnabled').checked = stkCollect.enabled !== false;
document.getElementById('v2StickerCollectPerMin').value = stkCollect.maxPerMinute ?? 2;
document.getElementById('v2StickerCollectPerHour').value = stkCollect.maxPerHour ?? 10;
document.getElementById('v2StickerCollectRemarkMax').value = stkCollect.maxRemarkChars ?? 20;
const pmCfg = c.persistentMemory || {};
document.getElementById('v2PmEnabled').checked = pmCfg.enabled !== false;
document.getElementById('v2PmInterval').value = pmCfg.updateIntervalMin ?? 60;
document.getElementById('v2PmMaxChars').value = pmCfg.maxChars ?? 4000;
const ctx = c.context || {};
document.getElementById('v2ContextRecentLimit').value = ctx.recentLimit ?? 100;
document.getElementById('v2ContextUnreadLimit').value = ctx.unreadLimit ?? 30;
document.getElementById('v2ContextWindow').value = ctx.contextWindow ?? 20;
}
