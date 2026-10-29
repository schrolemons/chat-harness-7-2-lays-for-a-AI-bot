
import { api, esc } from '../../shared/api.js';
// layers/O/tool-log: explicit imports; initialize is called in the application startup order.

function v2ToolLogStatus(entry) {
  if (entry.type === 'result') {
    const ok = entry.ok !== false;
    return `<span class="pill ${ok ? 'g' : 'r'}">${ok ? '成功' : '失败'}</span>`;
  }
  return '<span class="pill b">调用</span>';
}

function summarizeToolArgs(tool, args) {
  let obj = args;
  if (typeof args === 'string') {
    try { obj = JSON.parse(args); } catch { return args || ''; }
  }
  if (!obj || typeof obj !== 'object') return String(obj ?? '');
  const parts = [];
  const push = (k, v) => {
    if (v === undefined || v === null || v === '') return;
    parts.push(`${k}=${v}`);
  };
  const t = String(tool || '');
  if (t.includes('qq_set_wake_config')) {
    const cfg = (obj.config && typeof obj.config === 'object') ? obj.config : obj;
    push('mode', cfg.mode);
    push('infinite', cfg.infinite);
    const sleepUntil = cfg.sleepUntil || obj.sleepUntil;
    const sleepMs = cfg.sleepMs !== undefined ? cfg.sleepMs : obj.sleepMs;
    if (sleepUntil) push('sleepUntil', sleepUntil);
    else if (sleepMs !== undefined) push('sleepMs', sleepMs + 'ms');
    else push('sleep', '未设置时间');
    const tr = (cfg.triggers && typeof cfg.triggers === 'object') ? cfg.triggers : {};
    const trigs = [];
    if (tr.atMention) trigs.push('@');
    if (tr.nameMention) trigs.push('名字');
    if (tr.question) trigs.push('提问');
    if (tr.poke) trigs.push('拍一拍');
    if (Array.isArray(tr.keywords) && tr.keywords.length) trigs.push('关键词:' + tr.keywords.join(','));
    if (Array.isArray(tr.speakerIds) && tr.speakerIds.length) trigs.push('指定成员:' + tr.speakerIds.join(','));
    if (tr.anyMessage) trigs.push('anyMessage');
    if (Number(tr.probability) > 0) trigs.push('概率:' + tr.probability);
    if (trigs.length) push('triggers', trigs.join('|'));
  } else if (t.includes('qq_wait_for_messages')) {
    push('timeoutMs', obj.timeoutMs != null ? obj.timeoutMs : '默认30000');
    push('minNewMessages', obj.minNewMessages != null ? obj.minNewMessages : 1);
    push('quietMs', obj.quietMs != null ? obj.quietMs : '默认8000');
  } else if (t.includes('qq_send_message')) {
    const msgs = Array.isArray(obj.messages) ? obj.messages : (obj.messages != null ? [obj.messages] : []);
    push('条数', msgs.length);
    if (msgs.length) push('首条', String(msgs[0]).slice(0, 30));
    push('gapMode', obj.gapMode || 'auto');
    if (obj.gapMs != null) push('gapMs', obj.gapMs);
    if (Array.isArray(obj.gaps) && obj.gaps.length) push('gaps', obj.gaps.join(','));
    if (obj.replyToMessageId != null && obj.replyToMessageId !== '') push('引用id', obj.replyToMessageId);
  } else if (t.includes('qq_send_burst')) {
    const msgs = Array.isArray(obj.messages) ? obj.messages : [];
    push('条数', msgs.length);
    if (msgs.length) push('首条', String(msgs[0]).slice(0, 30));
  } else if (t.includes('qq_send_poke')) {
    push('key', obj.key);
    if (obj.targetUserId != null && obj.targetUserId !== '') push('target', obj.targetUserId);
  } else if (t.includes('qq_get_forward_msg')) {
    push('key', obj.key);
    if (obj.id != null && obj.id !== '') push('id', String(obj.id).slice(0, 40));
  } else if (t.includes('qq_mark_read')) {
    push('key', obj.key);
  } else if (t.includes('qq_get_prompt') || t.includes('qq_get_unread_messages') || t.includes('qq_get_recent_messages') || t.includes('qq_social_state') || t.includes('qq_get_my_recent_messages') || t.includes('qq_get_message_detail') || t.includes('qq_get_active_members')) {
    push('key', obj.key);
    if (obj.messageId != null) push('messageId', obj.messageId);
    if (obj.limit != null) push('limit', obj.limit);
  } else {
    push('key', obj.key);
  }
  return parts.join(' | ') || JSON.stringify(obj);
}

function v2ToolLogCell(value, tool) {
  const text = value == null ? '' : String(value);
  if (!text) return '<span class="meta">-</span>';
  const summary = tool ? summarizeToolArgs(tool, text) : text;
  const short = summary.length > 100 ? summary.slice(0, 100) + '…' : summary;
  return `<span class="tool-log-cell" data-full="${esc(text)}" data-short="${esc(short)}" title="点击查看完整 JSON">${esc(short)}</span>`;
}

function renderV2ToolLog(entries) {
  const box = document.getElementById('v2ToolLogOutput');
  const list = entries || [];
  if (!list.length) { box.innerHTML = '<span class="meta">（空）</span>'; return; }
  let html = '<table><tr><th>时间</th><th>会话 key</th><th>工具名</th><th>状态</th><th>参数</th><th>错误信息</th></tr>';
  for (const e of list) {
    const time = e.time ? new Date(e.time).toLocaleString() : '-';
    const key = esc(e.key || '');
    const tool = esc(e.tool || '-');
    const status = v2ToolLogStatus(e);
    const params = e.type === 'call' ? v2ToolLogCell(e.args, e.tool) : '<span class="meta">-</span>';
    const error = e.type === 'result' ? v2ToolLogCell(e.error) : '<span class="meta">-</span>';
    html += `<tr><td>${esc(time)}</td><td>${key}</td><td>${tool}</td><td>${status}</td><td>${params}</td><td>${error}</td></tr>`;
  }
  html += '</table>';
  box.innerHTML = html;
}

function loadV2ToolLog() {
  return api('/api/socialV2/tool-log?limit=200')
    .then(r => { renderV2ToolLog(r.entries || []); })
    .catch(() => { renderV2ToolLog([]); });
}

export function initialize() {
document.getElementById('v2ToolLogOutput').addEventListener('click', (ev) => {
  const cell = ev.target.closest('.tool-log-cell');
  if (!cell) return;
  const full = cell.dataset.full;
  const short = cell.dataset.short;
  if (cell.classList.contains('expanded')) {
    cell.classList.remove('expanded');
    cell.textContent = short;
  } else {
    cell.classList.add('expanded');
    cell.textContent = full;
  }
});
}
export { v2ToolLogStatus, summarizeToolArgs, v2ToolLogCell, renderV2ToolLog, loadV2ToolLog };
