import { api, esc } from '../../shared/api.js';
const time = value => value ? new Date(value).toLocaleString('zh-CN', {hour12:false}) : '—';
function historyItem(item) {
  const corrected = item.voided === true;
  return '<li class="mood-history-item' + (corrected ? ' is-corrected' : '') + '">'
    + '<div><b>' + esc(corrected ? '已核实回应，原未答判定已更正' : ({'daily-recovery':'每日04:00保底恢复','daily-first':'历史首次发言恢复','model-adjustment':'AI加减分','unanswered':'主动未回应扣分'}[item.source]||item.source||'未知来源')) + '</b><time>' + esc(time(item.effectiveAt ?? item.at)) + '</time></div>'
    + '<p>' + esc(item.reason || '未提供原因') + '</p>'
    + '<span>' + esc(item.before ?? '—') + ' → ' + esc(item.after ?? '—') + '（变化 ' + esc(item.delta ?? '—') + '）</span>'
    + (corrected ? '<small>原记录：' + esc(item.source) + '；原扣分 ' + esc(item.originalPenalty ?? '—') + '；记录于 ' + esc(time(item.recordedAt)) + '<br>更正依据：' + esc(typeof item.correction === 'string' ? item.correction : JSON.stringify(item.correction || {})) + '</small>' : '') + '</li>';
}
export async function refreshV2Mood() {
  const el = document.getElementById('v2MoodCurrent');
  if (!el) return;
  const stamp = document.getElementById('v2MoodUpdated');
  el.classList.add('is-loading');
  try {
    const response = await api('/api/socialV2/states');
    if (response.ok === false) throw Error(response.error || '读取失败');
    el.innerHTML = (response.conversations || []).map(conversation => {
      const state = conversation.moodState;
      if (!state) return '<div class="mood-card"><b>' + esc(conversation.key) + '</b><p>心情组件未启用或状态不可用</p></div>';
      const history = conversation.moodHistory || [];
      return '<div class="mood-card" data-state="' + (state.mode === 'critical' ? 'low' : 'normal') + '">'
        + '<div class="mood-card-head"><b>' + esc(conversation.key) + '</b><span>' + esc(state.modeName ?? '—') + ' · ' + (state.mode === 'critical' ? '临界形态' : '普通形态') + '</span></div>'
        + '<div class="mood-card-body"><span class="mood-value">' + esc(state.score ?? '—') + '</span><span>连续未答 ' + esc(state.unansweredStreak ?? '—') + ' 回合</span></div>'
        + '<dl class="runtime-facts"><dt>被叫回后的热情回应</dt><dd>' + (state.welcomeBurstActive ? '待首条成功回复使用' : '未激活') + '</dd><dt>再次触发冷却截止</dt><dd>' + esc(time(state.cooldownUntil)) + '</dd></dl>'
        + '<details class="mood-history"><summary>实际变动历史（最近 ' + history.length + ' 条）</summary>' + (history.length ? '<ol>' + history.map(historyItem).join('') + '</ol>' : '<p class="meta">暂无实际变动记录</p>') + '</details></div>';
    }).join('') || '<div class="mood-empty">暂无会话</div>';
    if (stamp) stamp.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', {hour12:false});
  } catch (error) { el.innerHTML = '<div class="mood-empty err">读取失败：' + esc(error.message) + '</div>'; }
  finally { el.classList.remove('is-loading'); }
}
export function initialize() {}
