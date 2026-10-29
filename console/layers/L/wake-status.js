
import { api, esc } from '../../shared/api.js';
// layers/L/wake-status: explicit imports; initialize is called in the application startup order.

function formatWakeStatus(r) {
  if (!r || !r.ok) return '<span class="meta">加载失败</span>';
  const wc = r.wakeConfig || {};
  const lines = [];
  const mode = wc.mode === 'active' ? '活跃（任何消息都会唤醒）' : (wc.mode === 'diving' ? '潜水' : (wc.mode || '未知'));
  lines.push(`<div><b>模式：</b>${esc(mode)}</div>`);
  lines.push(`<div><b>无限期：</b>${wc.infinite ? '是' : '否'}</div>`);
  const safety = r.wakeSafety || {};
  const badge = safety.guaranteed ? '🟢 已保证' : '🔴 无保证';
  lines.push(`<div><b>唤醒保证：</b>${badge}${safety.stale ? '（配置较旧，未确认）' : ''}</div>`);
  let next = '';
  if (wc.mode === 'active' || wc.triggers?.anyMessage) {
    next = '任何新消息都会唤醒';
  } else if (wc.sleepUntil) {
    const until = new Date(wc.sleepUntil).getTime();
    const remain = until - Date.now();
    if (!Number.isFinite(remain)) next = '时间格式无效';
    else if (remain > 0) next = `约 ${Math.max(1, Math.round(remain / 1000))} 秒后（${new Date(wc.sleepUntil).toLocaleString()}）`;
    else next = '已到期，等待下一次唤醒';
  } else if (wc.infinite) {
    next = '无限期潜水，等待指定条件';
  } else {
    next = '未设置时间';
  }
  lines.push(`<div><b>下次唤醒：</b>${esc(next)}</div>`);
  const tr = wc.triggers || {};
  const conds = [];
  if (tr.atMention) conds.push('@');
  if (tr.nameMention) conds.push('名字');
  if (Array.isArray(tr.keywords) && tr.keywords.length) conds.push('关键词：' + tr.keywords.join('、'));
  if (Array.isArray(tr.speakerIds) && tr.speakerIds.length) conds.push('指定成员：' + tr.speakerIds.join('、'));
  if (tr.question) conds.push('提问');
  if (tr.poke) conds.push('拍一拍');
  if (tr.anyMessage) conds.push('任何消息');
  if (Number(tr.probability) > 0) conds.push('普通消息概率 ' + Number(tr.probability));
  lines.push(`<div><b>提前唤醒条件：</b>${conds.length ? esc(conds.join('；')) : '（无）'}</div>`);
  lines.push(`<div><b>最近唤醒原因：</b>${esc(r.lastWakeReason || '-')}</div>`);
  lines.push(`<div><b>唤醒次数：</b>${Number(wc.wakeCount) || 0}</div>`);
  if (wc.confirmedAt) {
    const ago = Math.max(0, Math.round((Date.now() - wc.confirmedAt) / 60000));
    lines.push(`<div><b>配置确认：</b>${ago} 分钟前（${esc(wc.confirmedBy || 'unknown')}）</div>`);
  }
  if (r.lastAiReplyAt) {
    const ago = Math.max(0, Math.round((Date.now() - r.lastAiReplyAt) / 60000));
    lines.push(`<div><b>上次发言：</b>${ago} 分钟前</div>`);
  }
  lines.push(`<div><b>未读：</b>${Number(r.unreadCount) || 0} 条</div>`);
  return '<div style="padding:8px">' + lines.join('') + '</div>';
}

function loadV2WakeStatus() {
  const key = document.getElementById('v2WakeKey').value.trim();
  const msg = document.getElementById('v2WakeStatusMsg');
  if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
  msg.textContent = '加载中…';
  msg.className = 'meta';
  return api('/api/socialV2/state?key=' + encodeURIComponent(key))
    .then(r => {
      document.getElementById('v2WakeStatusOutput').innerHTML = formatWakeStatus(r);
      msg.textContent = r.ok ? '✅ 已加载' : ('❌ ' + (r.error || '失败'));
      msg.className = r.ok ? 'meta ok' : 'meta err';
    })
    .catch(e => {
      msg.textContent = '❌ ' + (e.message || e);
      msg.className = 'meta err';
    });
}

export function initialize() {
document.getElementById('v2WakeStatusLoad').addEventListener('click', loadV2WakeStatus);
}
export { formatWakeStatus, loadV2WakeStatus };
