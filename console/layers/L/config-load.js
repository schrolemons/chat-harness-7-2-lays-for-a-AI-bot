
// Apply only the L-layer configuration fields.
export function applyLConfig(c) {
const w = c.wake || {};
document.getElementById('v2WakeHint').value = w.recommendedHint || '';
document.getElementById('v2MaxWakeMin').value = w.maxWakePerMinute ?? 1;
document.getElementById('v2MaxWakeHour').value = w.maxWakePerHour ?? 12;
const wt = c.wait || {};
document.getElementById('v2WaitDefaultMs').value = wt.defaultMs ?? 30000;
document.getElementById('v2WaitMinMs').value = wt.minMs ?? 5000;
document.getElementById('v2WaitMaxMs').value = wt.maxMs ?? 600000;
document.getElementById('v2WaitDefaultQuietMs').value = wt.defaultQuietMs ?? 8000;
document.getElementById('v2MinQuietAfterNewMs').value = wt.minQuietAfterNewMs ?? 10000;
document.getElementById('v2AutoReplyCheckSec').value = Math.round((c.autoReplyCheckMs || 30000) / 1000);
const nw = c.dailyNews || {};
document.getElementById('v2NewsEnabled').checked = nw.enabled !== false;
document.getElementById('v2NewsHour').value = nw.hour ?? 9;
document.getElementById('v2NewsMinute').value = nw.minute ?? 0;
document.getElementById('v2NewsMax').value = nw.maxItems ?? 2;
const defaultNewsTopics = ['科学', '技术', '科普', '自然 纪录片', '艺术', '学习 方法'];
document.getElementById('v2NewsKeywords').value = (Array.isArray(nw.keywords) && nw.keywords.length ? nw.keywords : defaultNewsTopics).join('\n');
const defaultNewsUploaders = [];
const topicUploaders = Array.isArray(nw.topicUploaders) ? nw.topicUploaders : defaultNewsUploaders;
document.getElementById('v2NewsUploaders').value = topicUploaders.map(x => `${x.topic} | ${x.uploader} | ${x.weight ?? 1}`).join('\n');
document.getElementById('v2NewsSessions').value = (Array.isArray(nw.sessionWhitelist) ? nw.sessionWhitelist : []).join('\n');
const ds = c.doubleStamp || {};
document.getElementById('v2DoubleStampEnabled').checked = ds.enabled !== false;
document.getElementById('v2DoubleStampWindowCount').value = Math.min(100, Math.max(1, Math.round(Number(ds.windowCount) || 8)));
}
