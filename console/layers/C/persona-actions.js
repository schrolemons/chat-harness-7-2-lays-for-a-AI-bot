
import { api } from '../../shared/api.js';
import { roleInjectMax, refreshRoles, roleEditorState, roleCache, setRoleMsg, renderRoleEditor, roleEditorWarnings, updateRoleEditorWarnings, resetRoleForm, setRoleEditorState } from './persona.js';
import { refresh } from '../O/status.js';
// layers/C/persona-actions: explicit imports; initialize is called in the application startup order.




export function initialize() {
document.getElementById('roleInjectMaxSave').addEventListener('click', async () => {
  const msg = document.getElementById('roleInjectMaxMsg');
  const value = Number(document.getElementById('roleInjectMax').value);
  if (!Number.isFinite(value) || value < 1000 || value > 20000) { msg.textContent = '请输入 1000~20000 之间的整数'; msg.className = 'meta err'; return; }
  const r = await api('/api/roles/limit', 'POST', { maxInjectChars: value });
  msg.textContent = r.ok ? `✅ 已设为 ${r.maxInjectChars} 字符，下一条消息生效` : ('❌ ' + (r.error || '保存失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) refreshRoles();
});

document.getElementById('roleSet').addEventListener('click', async () => {
  const r = await api('/api/role', 'POST', { role: document.getElementById('roleInput').value.trim() });
  if (r.ok) refreshRoles(); else alert(r.error || '设置失败');
});
document.getElementById('roleClear').addEventListener('click', async () => { await api('/api/role', 'POST', { role: null }); refreshRoles(); refresh(); });
document.getElementById('roleCreate').addEventListener('click', async () => {
  const name = document.getElementById('newRoleName').value.trim();
  const content = document.getElementById('newRoleContent').value.trim();
  if (!name) { setRoleMsg('请先填人格名', false); return; }
  const editing = roleEditorState.mode === 'edit';
  const exists = roleCache.some((role) => role.name === name);
  // 编辑模式下改了名字 → 先重命名文件，再保存内容
  if (editing && roleEditorState.name !== name) {
    const renamed = await api('/api/roles/rename', 'POST', { from: roleEditorState.name, to: name });
    if (!renamed.ok) { setRoleMsg('❌ ' + (renamed.error || '重命名失败'), false); return; }
  }
  const endpoint = editing || exists ? '/api/roles/update' : '/api/roles/create';
  const r = await api(endpoint, 'POST', { name, content });
  setRoleMsg(r.ok ? `✅ 已保存「${name}」` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) {
    setRoleEditorState({ mode: 'edit', name });
    document.getElementById('roleEditorWarnings').textContent = (r.warnings || []).length ? '⚠️ ' + r.warnings.join('；') : '';
    await refreshRoles();
  }
});
document.getElementById('roleDuplicate').addEventListener('click', async () => {
  const source = document.getElementById('newRoleName').value.trim();
  const content = document.getElementById('newRoleContent').value.trim();
  const target = (prompt('把当前内容另存为新的人格，名称：', source ? source + '-副本' : '') || '').trim();
  if (!target) return;
  const r = await api('/api/roles/create', 'POST', { name: target, content });
  if (!r.ok) { setRoleMsg('❌ ' + (r.error || '另存失败'), false); return; }
  document.getElementById('newRoleName').value = target;
  setRoleEditorState({ mode: 'edit', name: target });
  renderRoleEditor();
  setRoleMsg(`✅ 已另存为「${target}」`, true);
  refreshRoles();
});
document.getElementById('roleDelete').addEventListener('click', async () => {
  const name = document.getElementById('newRoleName').value.trim();
  if (!name) { setRoleMsg('请先选择或填写要删除的人格名', false); return; }
  if (!confirm(`确定删除人格「${name}」？该操作不可撤销（roles/${name}.md）。`)) return;
  const r = await api('/api/roles/delete', 'POST', { name });
  if (!r.ok) { setRoleMsg('❌ ' + (r.error || '删除失败'), false); return; }
  resetRoleForm();
  setRoleMsg(r.clearedCurrent ? `已删除「${name}」，并清除了当前启用的人格` : `已删除「${name}」`, true);
  refreshRoles();
  refresh();
});
document.getElementById('roleFormReset').addEventListener('click', () => resetRoleForm());
document.getElementById('newRoleContent').addEventListener('input', updateRoleEditorWarnings);
}
