
import { api, esc } from '../../shared/api.js';
import { diaryWindowForDay } from './diary.js';
let v2DiaryHistorySection;
// layers/O/diary-history: explicit imports; initialize is called in the application startup order.


let V2_DA_EMPTY;

function setV2DaMsg(text) { const el = document.getElementById('v2DaMsg'); if (el) el.textContent = text || ''; }

async function loadV2DiaryArchive(date) {
  const pre = document.getElementById('v2DaContent');
  if (!pre || !date) return;
  document.querySelectorAll('#v2DaList [data-da-date]').forEach((btn) => btn.classList.toggle('active', btn.dataset.daDate === date));
  pre.textContent = '读取中…';
  try {
    const res = await api('/api/plugins/call', 'POST', { tool: 'diary_read', input: { date } });
    const result = (res && res.result) || {};
    if (result.ok !== true) { pre.textContent = result.error || V2_DA_EMPTY; return; }
    pre.textContent = result.text || '（这一天没有内容）';
    setV2DaMsg('已读取 ' + date + ' 日日记 · ' + diaryWindowForDay(date));
  } catch (e) {
    pre.textContent = '读取失败：' + (e && e.message ? e.message : e);
  }
}

async function refreshV2DiaryHistory() {
  const listEl = document.getElementById('v2DaList');
  const pre = document.getElementById('v2DaContent');
  if (!listEl) return;
  listEl.classList.add('is-loading');
  setV2DaMsg('读取中…');
  try {
    const res = await api('/api/plugins/call', 'POST', { tool: 'diary_history', input: { limit: 60 } });
    const result = (res && res.result) || {};
    const dates = Array.isArray(result.dates) ? result.dates : [];
    if (result.ok !== true || !dates.length) {
      listEl.innerHTML = '<div class="meta">' + V2_DA_EMPTY + '</div>';
      if (pre) pre.textContent = '（还没有归档）';
      setV2DaMsg(V2_DA_EMPTY);
      return;
    }
    listEl.innerHTML = dates.map((d) => {
      const date = String((d && d.date) || '');
      const sentCount = (Array.isArray(d.deliveries) ? d.deliveries : []).filter(item => item.status === 'sent').length;
      return '<button class="diary-history-date" type="button" data-da-date="' + esc(date) + '"><b>' + esc(date) + ' 日记</b><small>' + esc(diaryWindowForDay(date)) + '</small><small>' + esc(String((d && d.count) || 0)) + ' 个会话 · ' + esc(String((d && d.chars) || 0)) + ' 字 · 已确认发送 ' + sentCount + '</small></button>';
    }).join('');
    listEl.querySelectorAll('[data-da-date]').forEach((btn) => btn.addEventListener('click', () => loadV2DiaryArchive(btn.dataset.daDate)));
    setV2DaMsg('共 ' + dates.length + ' 天归档');
    await loadV2DiaryArchive(dates[0].date);
  } catch (e) {
    listEl.innerHTML = '<div class="meta">' + V2_DA_EMPTY + '</div>';
    if (pre) pre.textContent = '（还没有归档）';
    setV2DaMsg('读取失败：' + (e && e.message ? e.message : e));
  } finally {
    listEl.classList.remove('is-loading');
  }
}

export function initialize() {
V2_DA_EMPTY = '日记归档插件未启用，或还没有归档';

document.getElementById('v2DaRefresh').addEventListener('click', refreshV2DiaryHistory);
v2DiaryHistorySection = document.getElementById('v2DaRefresh')?.closest('details.settings-group');
if (v2DiaryHistorySection) {
  v2DiaryHistorySection.addEventListener('toggle', () => {
    if (v2DiaryHistorySection.open) refreshV2DiaryHistory();
  });
  if (v2DiaryHistorySection.open) refreshV2DiaryHistory();
}
}
export { V2_DA_EMPTY, setV2DaMsg, loadV2DiaryArchive, refreshV2DiaryHistory };
