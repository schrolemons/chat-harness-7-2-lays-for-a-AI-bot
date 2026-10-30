
// Collect only the L-layer configuration fields.
export function collectLConfig() { return {
autoReplyCheckMs: Math.round(Number(document.getElementById('v2AutoReplyCheckSec').value) || 30) * 1000,
wake: {
      recommendedHint: document.getElementById('v2WakeHint').value,
      maxWakePerMinute: Math.round(Number(document.getElementById('v2MaxWakeMin').value) || 0),
      maxWakePerHour: Math.round(Number(document.getElementById('v2MaxWakeHour').value) || 0)
    },
wait: {
      defaultMs: Math.round(Number(document.getElementById('v2WaitDefaultMs').value) || 5000),
      minMs: Math.round(Number(document.getElementById('v2WaitMinMs').value) || 1000),
      maxMs: Math.round(Number(document.getElementById('v2WaitMaxMs').value) || 10000),
      defaultQuietMs: Number.isFinite(Number(document.getElementById('v2WaitDefaultQuietMs').value)) ? Math.max(0, Math.round(Number(document.getElementById('v2WaitDefaultQuietMs').value))) : 8000,
      minQuietAfterNewMs: Number.isFinite(Number(document.getElementById('v2MinQuietAfterNewMs').value)) ? Math.max(0, Math.round(Number(document.getElementById('v2MinQuietAfterNewMs').value))) : 10000
    },
dailyNews: {
      enabled: document.getElementById('v2NewsEnabled').checked,
      hour: Math.min(23, Math.max(0, Math.round(Number(document.getElementById('v2NewsHour').value) || 9))),
      minute: Math.min(59, Math.max(0, Math.round(Number(document.getElementById('v2NewsMinute').value) || 0))),
      maxItems: Math.min(5, Math.max(1, Math.round(Number(document.getElementById('v2NewsMax').value) || 2))),
      keywords: document.getElementById('v2NewsKeywords').value.split(/[，,\r\n]+/).map(s => s.trim()).filter(Boolean),
      topicUploaders: document.getElementById('v2NewsUploaders').value.split(/[\r\n]+/).map(line => {
        const [topic = '', uploader = '', weight = '1'] = line.split('|').map(s => s.trim());
        return { topic, uploader, weight: weight ? Number(weight) : 1 };
      }).filter(x => x.topic && x.uploader),
      sessionWhitelist: document.getElementById('v2NewsSessions').value.split(/[，,\r\n]+/).map(s => s.trim()).filter(Boolean)
    },
doubleStamp: {
      enabled: document.getElementById('v2DoubleStampEnabled').checked,
      windowCount: Math.min(100, Math.max(1, Math.round(Number(document.getElementById('v2DoubleStampWindowCount').value) || 8)))
    }
}; }
