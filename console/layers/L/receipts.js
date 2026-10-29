
import { api } from '../../shared/api.js';
// layers/L/receipts: explicit imports; initialize is called in the application startup order.

function loadV2Receipts() {
  const key = document.getElementById('v2ReceiptKey').value.trim();
  const msg = document.getElementById('v2ReceiptMsg');
  const out = document.getElementById('v2ReceiptOutput');
  if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
  msg.textContent = '加载中…';
  msg.className = 'meta';
  return api('/api/socialV2/state?key=' + encodeURIComponent(key)).then((r) => {
    if (!r || r.ok !== true) throw new Error((r && r.error) || '失败');
    const rows = Array.isArray(r.pendingMessages) ? r.pendingMessages : [];
    const fmt = (t) => (t ? new Date(Number(t)).toLocaleTimeString() : '—');
    const lines = [
      `会话：${r.key || key}`,
      `待回复：${Number(r.pendingReplyCount) || 0} 条｜已接收未回复：${Number(r.awaitingReplyCount) || 0} 条｜首条未完成 seq：${r.firstPendingSeq == null ? '—' : r.firstPendingSeq}｜已读水位：${r.lastReadThroughSeq == null ? '—' : r.lastReadThroughSeq}`
    ];
    const audit = r.doubleStampCheck;
    if (audit) lines.push(`最近入站回查：${audit.enabled ? '启用' : '关闭'}｜向前 ${Number(audit.windowCount) || 0} 条｜触发 seq ${audit.triggerSeq || '—'}｜${audit.checkedAt ? new Date(Number(audit.checkedAt)).toLocaleTimeString() : '尚未检查'}｜窗口未完成 ${Number(audit.pendingCount) || 0} 条｜异常 ${Array.isArray(audit.anomalies) ? audit.anomalies.length : 0} 条｜上次 JSON 回执 ${audit.lastReportAt ? new Date(Number(audit.lastReportAt)).toLocaleTimeString() : '尚未上报'}｜${audit.lastReportError || ''}`);
    if (Array.isArray(audit?.anomalies) && audit.anomalies.length) lines.push('异常详情：' + audit.anomalies.map((item) => `seq ${item.seq} ${item.state || ''} ${item.note || item.source || ''}`).join('；'));
    if (!rows.length) lines.push('（窗口内没有未完成的消息：都拿到了 seenAt + repliedAt）');
    for (const m of rows) {
      lines.push(`seq ${m.seq} · ${m.sender || '未知'} · ${m.receiptState || ''} · seenAt=${fmt(m.seenAt)} · repliedAt=${fmt(m.repliedAt)}${m.awaitingReply ? ' · 已接收未回复' : ''}`);
    }
    out.textContent = lines.join('\n');
    msg.textContent = '✅ 已加载';
    msg.className = 'meta ok';
  }).catch((e) => {
    msg.textContent = '❌ ' + (e && e.message ? e.message : (e || '失败'));
    msg.className = 'meta err';
  });
}

export function initialize() {
document.getElementById('v2ReceiptLoad').addEventListener('click', loadV2Receipts);
}
export { loadV2Receipts };
