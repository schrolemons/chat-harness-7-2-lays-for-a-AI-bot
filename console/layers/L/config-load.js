
// Apply only the L-layer configuration fields.
export function applyLConfig(c) {
const w = c.wake || {};
document.getElementById('v2WakeDefaultMode').value = w.defaultMode === 'active' ? 'active' : 'diving';
document.getElementById('v2RecDefaultInfinite').checked = w.recommendedDefaultInfinite !== false;
document.getElementById('v2RecSleepMin').value = Math.round((w.recommendedSleepMinMs || 300000) / 60000);
document.getElementById('v2RecSleepMax').value = Math.round((w.recommendedSleepMaxMs || 7200000) / 60000);
document.getElementById('v2RecProb').value = w.recommendedProbability ?? 0.05;
document.getElementById('v2RecKeywords').value = (w.recommendedKeywords || []).join(', ');
document.getElementById('v2RecAt').checked = w.recommendedAtMention !== false;
document.getElementById('v2RecName').checked = w.recommendedNameMention !== false;
document.getElementById('v2RecQuestion').checked = w.recommendedQuestion !== false;
document.getElementById('v2RecPoke').checked = w.recommendedPoke !== false;
document.getElementById('v2WakeHint').value = w.recommendedHint || '';
document.getElementById('v2SleepMinMs').value = Math.round((w.sleepMinMs || 60000) / 1000);
document.getElementById('v2SleepMaxMs').value = Math.round((w.sleepMaxMs || 0) / 1000);
document.getElementById('v2MaxWakeMin').value = w.maxWakePerMinute ?? 1;
document.getElementById('v2MaxWakeHour').value = w.maxWakePerHour ?? 12;
document.getElementById('v2BatchWindowMs').value = w.batchWindowMs ?? 8000;
document.getElementById('v2NoActionLimit').value = w.noActionLimit ?? 3;
document.getElementById('v2MaxWakeConfigReminders').value = w.maxWakeConfigReminders ?? 2;
document.getElementById('v2PreSleepWaitEnabled').checked = w.preSleepWaitEnabled !== false;
document.getElementById('v2PreSleepWaitMin').value = Number.isFinite(Number(w.preSleepWaitMs)) ? Math.round(Number(w.preSleepWaitMs) / 60000) : 5;
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
const defaultNewsTopics = ['鲸鱼', '海洋', '少年感', '海洋 纪录片', '大海 治愈', '少年 成长'];
document.getElementById('v2NewsKeywords').value = (Array.isArray(nw.keywords) && nw.keywords.length ? nw.keywords : defaultNewsTopics).join('\n');
const defaultNewsUploaders = [];
const topicUploaders = Array.isArray(nw.topicUploaders) ? nw.topicUploaders : defaultNewsUploaders;
document.getElementById('v2NewsUploaders').value = topicUploaders.map(x => `${x.topic} | ${x.uploader} | ${x.weight ?? 1}`).join('\n');
document.getElementById('v2NewsSessions').value = (Array.isArray(nw.sessionWhitelist) ? nw.sessionWhitelist : []).join('\n');
const ds = c.doubleStamp || {};
document.getElementById('v2DoubleStampEnabled').checked = ds.enabled !== false;
document.getElementById('v2DoubleStampWindowCount').value = Math.min(100, Math.max(1, Math.round(Number(ds.windowCount) || 8)));
}
