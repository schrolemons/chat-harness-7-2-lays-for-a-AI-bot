
import { api } from '../../shared/api.js';
// layers/C/persistent-memory: explicit imports; initialize is called in the application startup order.

function setV2PmMsg(text) { const el = document.getElementById('v2PmMsg'); if (el) el.textContent = text || ''; }

async function loadV2PersistentMemory(key) {
  const ta = document.getElementById('v2PmContent');
  if (!key) { if (ta) ta.value = ''; setV2PmMsg('请选择会话'); return; }
  try {
    const r = await api('/api/socialV2/persistent-memory?key=' + encodeURIComponent(key));
    if (!r.ok) throw new Error(r.error || '读取失败');
    if (ta) ta.value = r.content || '';
    const when = r.updatedAt ? new Date(r.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '未更新';
    setV2PmMsg('已保存 ' + (r.chars || 0) + ' 字符；本轮注入预算 ' + (r.maxChars || 4000) + '（事实/画像，非存储容量）；最后更新：' + when);
  } catch (e) { setV2PmMsg('读取失败：' + (e && e.message ? e.message : e)); }
}

async function saveV2PersistentMemory(key) {
  if (!key) { setV2PmMsg('请选择会话'); return; }
  const ta = document.getElementById('v2PmContent');
  try {
    const r = await api('/api/socialV2/persistent-memory', 'POST', { key, content: ta ? ta.value : '' });
    setV2PmMsg(r.ok ? ('✅ 已保存（' + (r.chars || 0) + ' 字）') : ('❌ ' + (r.error || '失败')));
  } catch (e) { setV2PmMsg('保存失败：' + (e && e.message ? e.message : e)); }
}

async function triggerV2PersistentMemory(key) {
  if (!key) { setV2PmMsg('请选择会话'); return; }
  try {
    const r = await api('/api/socialV2/persistent-memory', 'POST', { key, action: 'updateNow' });
    setV2PmMsg(r.ok ? '✅ 已触发 AI 更新（稍等片刻后点“加载记忆”查看）' : ('❌ ' + (r.error || '失败')));
  } catch (e) { setV2PmMsg('触发失败：' + (e && e.message ? e.message : e)); }
}

async function clearV2PersistentMemory(key) {
  if (!key) return;
  if (!confirm('清空该会话的持久化记忆？')) return;
  try {
    const r = await api('/api/socialV2/persistent-memory', 'POST', { key, action: 'clear' });
    setV2PmMsg(r.ok ? '✅ 已清空' : ('❌ ' + (r.error || '失败')));
    if (r.ok) loadV2PersistentMemory(key);
  } catch (e) { setV2PmMsg('清空失败：' + (e && e.message ? e.message : e)); }
}

export function initialize() {


document.getElementById('v2PmLoad').addEventListener('click', () => loadV2PersistentMemory(document.getElementById('v2PmKey').value));
document.getElementById('v2PmSave').addEventListener('click', () => saveV2PersistentMemory(document.getElementById('v2PmKey').value));
document.getElementById('v2PmUpdate').addEventListener('click', () => triggerV2PersistentMemory(document.getElementById('v2PmKey').value));
document.getElementById('v2PmClear').addEventListener('click', () => clearV2PersistentMemory(document.getElementById('v2PmKey').value));
}
export { setV2PmMsg, loadV2PersistentMemory, saveV2PersistentMemory, triggerV2PersistentMemory, clearV2PersistentMemory };
