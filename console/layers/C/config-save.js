
// Collect only the C-layer configuration fields.
export function collectCConfig() { return {
sticker: {
      enabled: document.getElementById('v2StickerEnabled').checked,
      syncTtlMs: Math.max(1000, Math.round(Number(document.getElementById('v2StickerSyncTtlSec').value) || 60) * 1000),
      maxListCount: Math.min(500, Math.max(1, Math.round(Number(document.getElementById('v2StickerMaxList').value) || 100))),
      includeInPrompt: document.getElementById('v2StickerIncludePrompt').checked,
      recentCooldownMinutes: Math.min(1440, Math.max(0, Math.round(Number(document.getElementById('v2StickerRecentCooldown').value) || 0))),
      promptMaxStickers: Math.min(30, Math.max(1, Math.round(Number(document.getElementById('v2StickerPromptMax').value) || 8))),
      collect: {
        enabled: document.getElementById('v2StickerCollectEnabled').checked,
        maxPerMinute: Math.max(0, Math.round(Number(document.getElementById('v2StickerCollectPerMin').value) || 0)),
        maxPerHour: Math.max(0, Math.round(Number(document.getElementById('v2StickerCollectPerHour').value) || 0)),
        maxRemarkChars: Math.min(50, Math.max(1, Math.round(Number(document.getElementById('v2StickerCollectRemarkMax').value) || 20)))
      }
    },
persistentMemory: {
      enabled: document.getElementById('v2PmEnabled').checked,
      updateIntervalMin: Math.min(1440, Math.max(1, Math.round(Number(document.getElementById('v2PmInterval').value) || 60))),
      maxChars: Math.min(20000, Math.max(500, Math.round(Number(document.getElementById('v2PmMaxChars').value) || 4000)))
    },
context: {
      wakeRecentLimit: Number(document.getElementById('context-wakeRecentLimit').value),
      wakeHistoryMessageMaxChars: Number(document.getElementById('context-wakeHistoryMessageMaxChars').value),
      wakeMessageLimit: Number(document.getElementById('context-wakeMessageLimit').value),
      wakePendingMessageMaxChars: Number(document.getElementById('context-wakePendingMessageMaxChars').value),
      wakeMaxChars: Number(document.getElementById('context-wakeMaxChars').value),
      weakWakeMaxChars: Number(document.getElementById('context-weakWakeMaxChars').value),
      recentLimit: Math.round(Number(document.getElementById('v2ContextRecentLimit').value) || 100),
      unreadLimit: Math.round(Number(document.getElementById('v2ContextUnreadLimit').value) || 30),
      contextWindow: Math.round(Number(document.getElementById('v2ContextWindow').value) || 20)
    }
}; }
