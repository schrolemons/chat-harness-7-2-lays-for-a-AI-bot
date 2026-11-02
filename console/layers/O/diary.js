
import { api, esc } from '../../shared/api.js';
import {diaryWindow} from '../../../plugins/qq-components/ctx-memory-store/diary-delivery.mjs';
// layers/O/diary: explicit imports; initialize is called in the application startup order.

function diaryWindowForDay(day,config) {return diaryWindow(day,config)?.label || '时间窗未知';}
const sentTime=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(Number(value))+'（北京时间）';

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
            if (['absent', 'archive_only', 'legacy_unconfirmed'].includes(delivery.status)) catchUpKeys.add(String(delivery.key || '') + '|' + day);
          }
        }
      }
    } catch {}
    const hasCatchUpFor = (key, targetDate) => historyAvailable && [...catchUpKeys].some((item) => item.startsWith(String(key) + '|') && item.slice(String(key).length + 1) < String(targetDate || ''));
    // deliveries are keyed by date and recipient so each session can independently disable catch-up.
    const rows = convs.map((c) => {
      const last = c.lastDiaryDate || '未发过';
      const state = c.hasDiary ? ('目标日记 ' + c.diaryChars + ' 字（' + (c.diarySource === 'archive' ? '归档' : '当前记忆') + '）') : '没有 ' + (c.targetDate || '目标日期') + ' 的日记内容';
      const confirmed=c.deliveryStatus==='sent'&&c.targetSent===true&&Number(c.sentAt)>0;
      const deliveryStatus=c.deliveryStatus==='sent'&&!confirmed?'legacy_unconfirmed':c.deliveryStatus;
      const alreadySent = confirmed;
      const unresolved = ['claimed', 'uncertain', 'unavailable', 'legacy_unconfirmed'].includes(deliveryStatus);
      const blocked = c.diaryPending || ['claimed','unavailable'].includes(deliveryStatus);
      const blockReason = !c.hasDiary ? '目标日期没有日记内容' : unresolved ? '发送凭据尚未确认，请先检查 QQ 会话和记录' : '';
      const previousUnknown=['claimed','uncertain','unavailable'].includes(c.previousDiaryStatus);
      const statusLabel = c.previousDiaryMissing ? (previousUnknown?'昨日日记发送未确认':'昨日日记未发送') : c.diaryPending ? '刷新或发送处理中' : '当前窗口进行中';
      const statusClass = c.previousDiaryMissing ? 'missing' : c.diaryPending ? 'pending' : 'muted';
      const title = '发送对象：' + c.key + (blockReason ? '；' + blockReason : '');
      const catchUpAvailable = (c.previousDiaryMissing&&c.previousDiaryAvailable&&!previousUnknown)||hasCatchUpFor(c.key, c.targetDate);
      const confirmedAt=Number(c.lastConfirmedSentAt)||(alreadySent?Number(c.sentAt):0),confirmedDay=c.lastConfirmedDiaryDate||(alreadySent?c.targetDate:'');
      const sendDateLabel=confirmedAt?'最近确认发送：'+sentTime(confirmedAt)+' · 所属日记：'+confirmedDay:(c.lastDiaryDate?'旧日期记录：'+last+'（没有确认回执，不代表已发送）':'尚无确认发送记录');
      const windowLabel=c.windowStart&&c.windowEnd?c.windowStart+' 至 '+c.windowEnd:diaryWindowForDay(c.targetDate,r.config);
      const scheduledLabel=c.previousDiaryMissing?'上一窗口：'+c.previousDay+' 日记 · '+(c.previousDiaryAvailable?'可直接补发已有正文，不调用模型':'暂无可补发正文'):c.previousSentAt?'上一窗口已发送：'+sentTime(c.previousSentAt):'手动发送不抵扣本窗口结束时的定时发送';
      return '<article class="diary-session-card" title="' + esc(title) + '"><div class="diary-session-head"><b class="diary-session-key">' + esc(c.key) + '</b><span class="diary-session-state ' + statusClass + '">' + esc(statusLabel) + '</span></div>'
        + '<div class="diary-session-window">' + esc(c.targetDate || '目标日期') + ' 日记时间窗 · ' + esc(windowLabel) + '</div>'
        + '<div class="diary-session-detail">' + esc(state) + ' · ' + esc(sendDateLabel) + '</div>'
        + '<div class="diary-session-detail">' + esc(scheduledLabel) + '</div>'
        + '<div class="diary-session-actions"><button class="small" title="重新总结并发送此窗口日记；窗口分界读取已配置的时、分" ' + (blocked ? 'disabled' : '') + ' data-dd-key="' + encodeURIComponent(c.key) + '" data-dd-day="' + esc(c.targetDate || '') + '" data-dd-confirm="' + (['legacy_unconfirmed','uncertain'].includes(deliveryStatus)?'1':'0') + '" data-dd-action="sendNow">刷新并发送 ' + esc(c.targetDate || '当前窗口') + ' 日记</button>'
        + '<button class="small" title="只补发当前窗口之前的归档日记；旧日期记录需先核对QQ" ' + (c.diaryPending || !catchUpAvailable ? 'disabled' : '') + ' data-dd-key="' + encodeURIComponent(c.key) + '" data-dd-action="catchUpAll">补发未发送日记</button></div></article>';
    });
    if (catchUpButton) catchUpButton.disabled = !convs.some((c) => !c.diaryPending && ((c.previousDiaryMissing&&c.previousDiaryAvailable&&!['claimed','uncertain','unavailable'].includes(c.previousDiaryStatus))||hasCatchUpFor(c.key, c.targetDate)));
    listEl.innerHTML = rows.join('') || '（暂无会话）';
    listEl.querySelectorAll('[data-dd-key]').forEach((btn) => btn.addEventListener('click', async () => {
      const key = decodeURIComponent(btn.dataset.ddKey);
      const action = btn.dataset.ddAction;
      if(action==='catchUpAll'&&!window.confirm('请确认已核对QQ：将补发 '+key+' 当前窗口之前、未确认发送的归档日记。只有旧日期记录的也会尝试补发；处理中或结果不明的真实发送凭据会跳过，避免重复。继续吗？'))return;
      if(action==='sendNow'&&btn.dataset.ddConfirm==='1'&&!window.confirm('该窗口的旧发送记录没有确认回执。请先核对QQ；继续会重新总结并发送 '+btn.dataset.ddDay+' 日记，可能重复已收到的内容。继续吗？'))return;
      const row = btn.closest('.diary-session-card');
      row?.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      let finalMessage = action === 'sendNow' ? ('正在重新总结 ' + key + ' 当前窗口记忆；完成后发送 ' + btn.dataset.ddDay + ' 日记…') : ('正在逐日补发 ' + key + ' 的历史日记…');
      if (msg) msg.textContent = finalMessage;
      try {
        const rr = await api('/api/socialV2/daily-diary', 'POST', { action, key, day: btn.dataset.ddDay, ...(action==='catchUpAll'?{confirmLegacyUnsent:true}:{}) });
        finalMessage = rr.pending === true
          ? ('⏳ ' + (rr.message || '已请求刷新此窗口记忆，发送完成后状态会更新。'))
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
  if(!window.confirm('请确认已核对QQ：将按各会话当前配置的窗口分界，补发更早且未确认发送的归档日记。仅有旧日期记录的也会尝试补发；真实凭据仍处于处理中或结果不明时会跳过。继续吗？'))return;
  button.disabled = true;
  let finalMessage = '';
  try {
    const r = await api('/api/socialV2/daily-diary');
    const convs = r.conversations || [];
    const successes = [], failures = [];
    for (const c of convs) {
      if (c.diaryPending) { failures.push({ key: c.key, reason: '今日刷新/发送处理中' }); continue; }
      const result = await api('/api/socialV2/daily-diary', 'POST', { action: 'catchUpAll', key: c.key, confirmLegacyUnsent:true });
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
