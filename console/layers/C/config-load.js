import {CONTEXT_LIMIT_FIELDS,normalizeContextLimits} from '../../../src/bridge-core/context-limits.mjs';

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
const ctx = normalizeContextLimits(c.context || {});
for(const [key,rule] of Object.entries(CONTEXT_LIMIT_FIELDS)){const el=document.getElementById('context-'+key);if(el){el.value=ctx[key];el.min=rule.min;el.max=rule.max;}}
for(const [id,key] of [['v2ContextRecentLimit','recentLimit'],['v2ContextUnreadLimit','unreadLimit'],['v2ContextWindow','contextWindow']]){const el=document.getElementById(id);el.min=CONTEXT_LIMIT_FIELDS[key].min;el.max=CONTEXT_LIMIT_FIELDS[key].max;}
document.getElementById('contextReceiptRange').textContent='收件回查：触发来信之前最近'+(c.doubleStamp?.windowCount??8)+'条非bot入站消息，再加触发这条；含已处理消息供核对，不含bot回复。独立于补带历史条数，共享快照字符预算。';
document.getElementById('v2ContextRecentLimit').value = ctx.recentLimit ?? 100;
document.getElementById('v2ContextUnreadLimit').value = ctx.unreadLimit ?? 30;
document.getElementById('v2ContextWindow').value = ctx.contextWindow ?? 20;
}
