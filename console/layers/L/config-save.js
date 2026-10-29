
// Collect only the L-layer configuration fields.
export function collectLConfig() { return {
autoReplyCheckMs: Math.round(Number(document.getElementById('v2AutoReplyCheckSec').value) || 30) * 1000,
wake: {
      defaultMode: document.getElementById('v2WakeDefaultMode').value,
      recommendedDefaultInfinite: document.getElementById('v2RecDefaultInfinite').checked,
      preSleepWaitEnabled: document.getElementById('v2PreSleepWaitEnabled').checked,
      preSleepWaitMs: (Number.isFinite(Number(document.getElementById('v2PreSleepWaitMin').value)) && Number(document.getElementById('v2PreSleepWaitMin').value) >= 0 ? Math.round(Number(document.getElementById('v2PreSleepWaitMin').value)) : 5) * 60000,
      recommendedSleepMinMs: (Math.round(Number(document.getElementById('v2RecSleepMin').value) || 5)) * 60000,
      recommendedSleepMaxMs: (Math.round(Number(document.getElementById('v2RecSleepMax').value) || 120)) * 60000,
      recommendedProbability: Number(document.getElementById('v2RecProb').value) || 0,
      recommendedKeywords: document.getElementById('v2RecKeywords').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      recommendedAtMention: document.getElementById('v2RecAt').checked,
      recommendedNameMention: document.getElementById('v2RecName').checked,
      recommendedQuestion: document.getElementById('v2RecQuestion').checked,
      recommendedPoke: document.getElementById('v2RecPoke').checked,
      recommendedHint: document.getElementById('v2WakeHint').value,
      sleepMinMs: (Math.round(Number(document.getElementById('v2SleepMinMs').value) || 0)) * 1000,
      sleepMaxMs: (Math.round(Number(document.getElementById('v2SleepMaxMs').value) || 0)) * 1000,
      maxWakePerMinute: Math.round(Number(document.getElementById('v2MaxWakeMin').value) || 0),
      maxWakePerHour: Math.round(Number(document.getElementById('v2MaxWakeHour').value) || 0),
      batchWindowMs: Math.round(Number(document.getElementById('v2BatchWindowMs').value) || 8000),
      noActionLimit: Math.round(Number(document.getElementById('v2NoActionLimit').value) || 3),
      maxWakeConfigReminders: Math.round(Number(document.getElementById('v2MaxWakeConfigReminders').value) || 2)
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
