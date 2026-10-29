
import { setRoleEditorState, roleEditorState, roleCache, setRoleMsg, renderRoleEditor, roleEditorWarnings, updateRoleEditorWarnings, resetRoleForm, refreshRoles } from '../C/persona.js';
import { api, esc } from '../../shared/api.js';
import { refresh, saveMode } from '../O/status.js';
// layers/E/sessions: explicit imports; initialize is called in the application startup order.



async function refreshSessions() {
  try {
    const s = await api('/api/sessions');
    const box = document.getElementById('sessionList');
    document.getElementById('metricSessions').textContent = s.sessions.length;
    if (!s.sessions.length) { box.innerHTML = '<div class="empty-state"><strong>还没有会话</strong><p>白名单中的群或好友发来消息后，会话会显示在这里。</p></div>'; return; }
    let html = '<table><tr><th>QQ 会话</th><th>DSH 会话 ID</th><th>类型</th><th></th></tr>';
    for (const x of s.sessions) {
      const isP = x.key.startsWith('private:');
      const type = isP ? '<span class="pill b">私聊</span>' : '<span class="pill g">群</span>';
      const ownerTag = x.owner ? ' <span class="pill r">管理员</span>' : '';
      html += `<tr><td>${esc(x.key)}${ownerTag}</td><td><code>${esc(x.sessionId)}</code></td><td>${type}</td><td><button class="small" data-reset-key="${esc(x.key)}">清除上下文</button></td></tr>`;
    }
    box.innerHTML = html + '</table>';
    box.querySelectorAll('[data-reset-key]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('确定清除该会话的上下文？下次消息将开新会话。')) return;
      const r = await api('/api/session/reset', 'POST', { key: btn.dataset.resetKey });
      alert(r.ok ? '✅ 已清除上下文' : ('❌ ' + (r.error || '失败')));
      refreshSessions();
    }));
  } catch {}
}

async function refreshPending() {
  try {
    const p = await api('/api/pending');
    const box = document.getElementById('pendingList');
    document.getElementById('metricPending').textContent = p.pending.length;
    document.getElementById('pendingCount').textContent = p.pending.length;
    if (!p.pending.length) { box.innerHTML = '<div class="empty-state"><strong>暂时没有待处理请求</strong><p>AI 的提问或工具审批会出现在这里，请前往对应 QQ 会话回复。</p></div>'; return; }
    let html = '<table><tr><th>会话</th><th>类型</th><th>详情</th></tr>';
    for (const x of p.pending) {
      const kind = x.kind === 'approval' ? '<span class="pill r">审批</span>' : '<span class="pill b">提问</span>';
      let detail = '';
      if (x.kind === 'approval') detail = `${esc(x.toolName)}${x.reason ? '：' + esc(x.reason) : ''}`;
      else if (x.questions) detail = x.questions.map(q => esc(q.question)).join(' / ');
      html += `<tr><td>${esc(x.key)}</td><td>${kind}</td><td>${detail}</td></tr>`;
    }
    box.innerHTML = html + '</table>';
  } catch {}
}

export function initialize() {
document.querySelectorAll('#modeRow button').forEach(b => b.addEventListener('click', async () => {
  if (b.disabled) return;
  await saveMode(b.dataset.mode);
}));
document.getElementById('closedPreset').addEventListener('change', async () => {
  // 切换预设立即保存（若当前是 closed-agent 则即时生效，否则供下次切换使用）
  const active = document.querySelector('#modeRow button.active');
  const mode = active ? active.dataset.mode : 'chat';
  await saveMode(mode);
});







}
export { refreshSessions, refreshPending };
