
import { api, esc } from '../../shared/api.js';
// layers/O/diary: explicit imports; initialize is called in the application startup order.

function diaryWindowForDay(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!match) return '时间窗未知';
  const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  start.setDate(start.getDate() - 1);
  const key = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return key(start) + ' 22:00 — ' + String(day) + ' 22:00';
}

async function refreshV2Diary() {
  const listEl = document.getElementById('v2DdList');
  const msg = document.getElementById('v2DdMsg');
  const catchUpButton = document.getElementById('v2DdCatchUp');
  if (!listEl) return;
  try {
    const r = await api('/api/socialV2/daily-diary');
    const convs = r.conversations || [];
    const catchUpKeys = new Set();
    let historyAvailable = false;
    try {
      const historyRes = await api('/api/plugins/call', 'POST', { tool: 'diary_history', input: { limit: 200 } });
      const dates = historyRes?.result?.dates;
      if (historyRes?.result?.ok === true && Array.isArray(dates)) {
        historyAvailable = true;
        for (const entry of dates) {
          const day = String(entry?.date || '');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
          for (const delivery of Array.isArray(entry.deliveries) ? entry.deliveries : []) {
            if (['absent', 'archive_only'].includes(delivery.status)) catchUpKeys.add(String(delivery.key || '') + '|' + day);
          }
        }
      }
    } catch {}
    const hasCatchUpFor = (key, targetDate) => historyAvailable && [...catchUpKeys].some((item) => item.startsWith(String(key) + '|') && item.slice(String(key).length + 1) < String(targetDate || ''));
    // deliveries are keyed by date and recipient so each session can independently disable catch-up.
    const rows = convs.map((c) => {
      const last = c.lastDiaryDate || '未发过';
      const state = c.hasDiary ? ('目标日记 ' + c.diaryChars + ' 字（' + (c.diarySource === 'archive' ? '归档' : '当前记忆') + '）') : '没有 ' + (c.targetDate || '目标日期') + ' 的日记内容';
      const delivery = ({ sent: '目标日已确认发送', claimed: '发送处理中', uncertain: '发送结果未确认', absent: '目标日尚无发送凭据', archive_only: '仅有归档，未确认发送', unavailable: '凭据状态不可用' })[c.deliveryStatus] || '状态未知';
      const alreadySent = c.targetSent === true;
      const unresolved = ['claimed', 'uncertain', 'unavailable'].includes(c.deliveryStatus);
      const blocked = c.diaryPending;
      const blockReason = !c.hasDiary ? '目标日期没有日记内容' : unresolved ? '发送凭据尚未确认，请先检查 QQ 会话和记录' : '';
      const statusLabel = c.diaryPending ? '刷新或发送处理中' : alreadySent ? delivery : unresolved ? delivery : c.hasDiary ? '待发送' : '暂无内容';
      const statusClass = c.diaryPending || unresolved ? 'pending' : alreadySent ? 'sent' : 'muted';
      const title = '发送对象：' + c.key + (blockReason ? '；' + blockReason : '');
      const catchUpAvailable = hasCatchUpFor(c.key, c.targetDate);
      const sendDateLabel = alreadySent && c.sentAt
        ? '最近确认发送：' + new Date(c.sentAt).toLocaleString()
        : '上次发送日期：' + last;
      return '<article class="diary-session-card" title="' + esc(title) + '"><div class="diary-session-head"><b class="diary-session-key">' + esc(c.key) + '</b><span class="diary-session-state ' + statusClass + '">' + esc(statusLabel) + '</span></div>'
        + '<div class="diary-session-window">' + esc(c.targetDate || '目标日期') + ' 日记时间窗 · ' + esc(diaryWindowForDay(c.targetDate)) + '</div>'
        + '<div class="diary-session-detail">' + esc(state) + ' · ' + esc(sendDateLabel) + '</div>'
        + '<div class="diary-session-actions"><button class="small" title="每次点击都会重新总结当前记忆并发送今天的日记" ' + (blocked ? 'disabled' : '') + ' data-dd-key="' + encodeURIComponent(c.key) + '" data-dd-day="' + esc(c.targetDate || '') + '" data-dd-action="sendNow">刷新并发送今日日记</button>'
        + '<button class="small" title="只补发今天以前、尚未确认发送的归档日记" ' + (c.diaryPending || !catchUpAvailable ? 'disabled' : '') + ' data-dd-key="' + encodeURIComponent(c.key) + '" data-dd-action="catchUpAll">补发未发送日记</button></div></article>';
    });
    if (catchUpButton) catchUpButton.disabled = !historyAvailable || !convs.some((c) => !c.diaryPending && hasCatchUpFor(c.key, c.targetDate));
    listEl.innerHTML = rows.join('') || '（暂无会话）';
    listEl.querySelectorAll('[data-dd-key]').forEach((btn) => btn.addEventListener('click', async () => {
      const key = decodeURIComponent(btn.dataset.ddKey);
      const action = btn.dataset.ddAction;
      if (action === 'catchUpAll' && !window.confirm('将按日期逐条补发 ' + key + ' 所有未确认发送的日记。请先核对 QQ 历史；发送凭据不明的日期会自动跳过。继续吗？')) return;
      const row = btn.closest('.diary-session-card');
      row?.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      let finalMessage = action === 'sendNow' ? ('正在重新总结 ' + key + ' 当前最新记忆；完成后发送今天的日记…') : ('正在逐日补发 ' + key + ' 的历史日记…');
      if (msg) msg.textContent = finalMessage;
      try {
        const rr = await api('/api/socialV2/daily-diary', 'POST', { action, key, day: btn.dataset.ddDay });
        finalMessage = rr.pending === true
          ? ('⏳ ' + (rr.message || '已请求刷新今天的记忆，发送完成后状态会更新。'))
          : action === 'catchUpAll'
            ? ('补发完成：成功 ' + (rr.sentCount || 0) + ' 篇；' + (rr.results || []).filter(x => !x.ok && x.reason !== 'already_sent').length + ' 篇跳过/失败。' + (rr.results || []).map(x => x.day + ' ' + (x.ok ? '✅' : '· ' + (x.reason || '未确认'))).join('；'))
            : (rr.sent === true ? ('✅ 已发送 ' + (rr.day || btn.dataset.ddDay) + ' 日记：' + key) : ('❌ ' + (rr.error || '发送未获确认')));
      } catch (e) {
        finalMessage = '发送请求失败：' + (e && e.message ? e.message : e);
      } finally {
        await refreshV2Diary();
        if (msg) msg.textContent = finalMessage;
      }
    }));
    if (msg) msg.textContent = '已刷新';
  } catch (e) {
    if (catchUpButton) catchUpButton.disabled = true;
    if (msg) msg.textContent = '读取失败：' + (e && e.message ? e.message : e);
  }
}

export function initialize() {


document.getElementById('v2DdRefresh').addEventListener('click', refreshV2Diary);
document.getElementById('v2DdCatchUp').addEventListener('click', async () => {
  const msg = document.getElementById('v2DdMsg');
  const button = document.getElementById('v2DdCatchUp');
  button.disabled = true;
  let finalMessage = '';
  try {
    const r = await api('/api/socialV2/daily-diary');
    const convs = r.conversations || [];
    const successes = [], failures = [];
    for (const c of convs) {
      if (c.diaryPending) { failures.push({ key: c.key, reason: '今日刷新/发送处理中' }); continue; }
      const result = await api('/api/socialV2/daily-diary', 'POST', { action: 'catchUpAll', key: c.key });
      const sentDays = (result.results || []).filter(x => x.ok).map(x => x.day);
      if (sentDays.length) successes.push(...sentDays.map(day => c.key + ' ' + day));
      const skipped = (result.results || []).filter(x => !x.ok && x.reason !== 'already_sent');
      if (skipped.length) failures.push({ key: c.key, reason: skipped.map(x => x.day + ' ' + (x.reason || '未确认')).join('、') });
    }
    if (msg) {
      if (!successes.length && !failures.length) finalMessage = '没有需要补发的会话';
      else finalMessage = `补发完成：成功 ${successes.length} 篇，未确认 ${failures.length} 个会话` + (successes.length ? '；' + successes.join('、') : '') + (failures.length ? '；' + failures.map(x => x.key + '：' + x.reason).join('；') : '');
    }
    await refreshV2Diary();
  } catch (e) { finalMessage = '补发失败：' + (e && e.message ? e.message : e); }
  finally { await refreshV2Diary(); if (msg) msg.textContent = finalMessage; }
});
}
export { diaryWindowForDay, refreshV2Diary };
