
import { api, esc } from '../../shared/api.js';
import { registerPageLoader } from '../../shared/page-loaders.js';
import { initialPromptKey, selectInitialPromptKey, refreshInitialPromptSessions, manualSession, validSessionKey } from './initial-prompt-sessions.js';
import { loadVoiceLibrary, sendVoiceFromConsole } from '../E/voice.js';
import { buildV2TimeBubbleRow, applyV2TimeBubbleLocks, syncV2TimeBubbleCapacity, loadV2TimeBubblesFor, saveV2TimeBubblesFor, resetV2TimeBubblesFor, loadV2FollowupSessionLimits, saveV2FollowupSessionLimits } from '../L/time-bubbles.js';
import { loadV2PersistentMemory, saveV2PersistentMemory, triggerV2PersistentMemory, clearV2PersistentMemory } from './persistent-memory.js';
import { refreshV2Diary } from '../O/diary.js';
import { refreshV2DiaryHistory } from '../O/diary-history.js';
import { refreshV2Schedule } from '../L/schedule.js';
import { refreshV2Mood } from './mood.js';
import { saveV2SelfReviewConfig } from '../O/self-review.js';
import { saveV2Config } from '../../shared/config-save.js';
// layers/C/initial-prompt: explicit imports; initialize is called in the application startup order.










let v2InitPromptTextEl;
let requestSequence = 0, loadedKey = '', dirty = false, loading = false, writing = false, writable = true;

function v2InitPromptKeyValue() { return initialPromptKey(); }

function updateInitialPromptActions() {
  const ready = !!loadedKey && loadedKey === v2InitPromptKeyValue() && !loading && !writing;
  v2InitPromptTextEl.disabled = !ready;
  document.getElementById('v2InitPromptSave').disabled = !ready || !writable;
  document.getElementById('v2InitPromptClear').disabled = !ready || !writable;
}

function setV2InitPromptMsg(text, kind) {
  const msg = document.getElementById('v2InitPromptMsg');
  msg.textContent = text;
  msg.className = 'meta' + (kind ? ' ' + kind : '');
}

function updateV2InitPromptCount() {
  document.getElementById('v2InitPromptCount').textContent = String(v2InitPromptTextEl.value.length);
}

function applyV2InitPromptMax(maxChars) {
  const max = Math.round(Number(maxChars));
  if (!Number.isFinite(max) || max <= 0) return;
  document.getElementById('v2InitPromptMax').textContent = String(max);
  v2InitPromptTextEl.maxLength = max;
}

function renderV2InitPromptEntries(entries) {
  const box = document.getElementById('v2InitPromptList');
  if (!Array.isArray(entries) || !entries.length) { box.textContent = '（还没有任何会话设置初始提示词）'; return; }
  box.innerHTML = entries.map((e) => {
    const when = Number(e.updatedAt) > 0 ? new Date(Number(e.updatedAt)).toLocaleString() : '未知时间';
    return `<div style="margin:3px 0"><code>${esc(e.key)}</code> · ${Number(e.chars) || 0} 字符 · ${esc(when)} <button class="small" data-init-prompt-key="${esc(e.key)}">编辑</button></div>`;
  }).join('');
}

async function loadV2InitialPrompt() {
  const key = v2InitPromptKeyValue();
  if (key && !validSessionKey(key)) { setV2InitPromptMsg('会话格式应为 group:群号 或 private:QQ号', 'err'); return; }
  if (dirty && !confirm('重新加载将放弃尚未保存的会话背景，是否继续？')) return;
  const sequence = ++requestSequence;
  loadedKey = ''; dirty = false; loading = true;
  v2InitPromptTextEl.value = ''; updateV2InitPromptCount(); updateInitialPromptActions();
  setV2InitPromptMsg('加载中…');
  try {
    const r = await api('/api/socialV2/initial-prompt' + (key ? '?key=' + encodeURIComponent(key) : ''));
    if (sequence !== requestSequence || key !== v2InitPromptKeyValue()) return;
    if (!r.ok) { setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err'); return; }
    applyV2InitPromptMax(r.maxChars);
    const readOnly = r.writable === false;
    if (!key) {
      renderV2InitPromptEntries(r.entries);
      setV2InitPromptMsg(readOnly ? '⚠️ 文件不可写（只读降级），只显示已有内容' : `✅ 共 ${(r.entries || []).length} 条`, readOnly ? 'err' : 'ok');
      return;
    }
    v2InitPromptTextEl.value = r.text || '';
    loadedKey = key; writable = !readOnly;
    updateV2InitPromptCount();
    document.getElementById('v2InitPromptList').textContent = r.exists
      ? '该会话已设置初始提示词；再点「保存」会覆盖。'
      : '该会话还没有设置初始提示词；填写后点「保存」新建。';
    if (readOnly) setV2InitPromptMsg('⚠️ 文件不可写（只读降级）：能看不能存', 'err');
    else setV2InitPromptMsg(r.exists ? '✅ 已加载' : '（空）', r.exists ? 'ok' : '');
  } catch (e) {
    if (sequence === requestSequence) setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
  } finally { if (sequence === requestSequence) { loading = false; updateInitialPromptActions(); } }
}

async function saveV2InitialPrompt() {
  const key = v2InitPromptKeyValue();
  if (!key) { setV2InitPromptMsg('请输入会话 key（group:群号 或 private:QQ号）', 'err'); return; }
  if (key !== loadedKey || loading || writing) { setV2InitPromptMsg('请先加载此会话背景', 'err'); return; }
  const sequence = requestSequence, text = v2InitPromptTextEl.value;
  writing = true; updateInitialPromptActions();
  setV2InitPromptMsg('保存中…');
  try {
    const r = await api('/api/socialV2/initial-prompt', 'POST', { key, text });
    if (sequence !== requestSequence || key !== v2InitPromptKeyValue()) return;
    if (!r.ok) { setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err'); return; }
    applyV2InitPromptMax(r.maxChars);
    dirty = false;
    if (r.deleted) {
      v2InitPromptTextEl.value = '';
      updateV2InitPromptCount();
      setV2InitPromptMsg('✅ 内容为空，已删除该会话的初始提示词', 'ok');
    } else {
      setV2InitPromptMsg(`✅ 已保存（${r.chars} 字符），该会话下一次首次唤醒时注入`, 'ok');
    }
  } catch (e) {
    if (sequence === requestSequence) setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
  } finally { writing = false; updateInitialPromptActions(); }
}



export function initialize() {
v2InitPromptTextEl = document.getElementById('v2InitPromptText');
updateInitialPromptActions();
document.getElementById('v2InitPromptKey').addEventListener('change', () => {
  if (dirty && !confirm('切换会话将放弃尚未保存的背景，是否继续？')) { selectInitialPromptKey(loadedKey); return; }
  ++requestSequence; dirty = false; loadedKey = ''; loading = false;
  v2InitPromptTextEl.value = ''; updateV2InitPromptCount(); updateInitialPromptActions();
  const manual = document.getElementById('v2InitPromptKey').value === manualSession;
  const input = document.getElementById('v2InitPromptManualKey'); input.hidden = !manual;
  if (manual) { input.value = ''; input.focus(); setV2InitPromptMsg('填写会话 key 后点“加载”'); }
  else void loadV2InitialPrompt();
});
document.getElementById('v2InitPromptManualKey').addEventListener('input', () => { ++requestSequence; loadedKey = ''; loading = false; updateInitialPromptActions(); });
registerPageLoader('setting-c-2', () => refreshInitialPromptSessions().catch(error => setV2InitPromptMsg(error.message, 'err')));
document.getElementById('v2InitPromptLoad').addEventListener('click', loadV2InitialPrompt);
document.getElementById('v2InitPromptSave').addEventListener('click', saveV2InitialPrompt);
document.getElementById('v2InitPromptClear').addEventListener('click', async () => {
  const key = v2InitPromptKeyValue();
  if (!key) { setV2InitPromptMsg('请输入会话 key', 'err'); return; }
  if (key !== loadedKey || loading || writing) return;
  if (!confirm(`确定删除 ${key} 的初始提示词？`)) return;
  const sequence = requestSequence;
  writing = true; updateInitialPromptActions();
  try {
    const r = await api('/api/socialV2/initial-prompt', 'POST', { key, delete: true });
    if (sequence !== requestSequence || key !== v2InitPromptKeyValue()) return;
    if (!r.ok) { setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err'); return; }
    v2InitPromptTextEl.value = '';
    dirty = false;
    updateV2InitPromptCount();
    setV2InitPromptMsg('✅ 已删除', 'ok');
  } catch (e) {
    if (sequence === requestSequence) setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
  } finally { writing = false; updateInitialPromptActions(); }
});
v2InitPromptTextEl.addEventListener('input', () => { dirty = true; updateV2InitPromptCount(); });
document.getElementById('v2InitPromptList').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-init-prompt-key]');
  if (!btn) return;
  if (dirty && !confirm('切换会话将放弃尚未保存的背景，是否继续？')) return;
  dirty = false;
  selectInitialPromptKey(btn.dataset.initPromptKey || '');
  loadV2InitialPrompt();
});


document.getElementById('v2MoodRefresh').addEventListener('click', refreshV2Mood);





















document.getElementById('voiceRefreshBtn').addEventListener('click', () => loadVoiceLibrary(true));
document.getElementById('voiceSendBtn').addEventListener('click', sendVoiceFromConsole);
}
export { v2InitPromptTextEl, v2InitPromptKeyValue, setV2InitPromptMsg, updateV2InitPromptCount, applyV2InitPromptMax, renderV2InitPromptEntries, loadV2InitialPrompt, saveV2InitialPrompt };
