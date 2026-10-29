
import { api } from '../../shared/api.js';
// layers/C/preset-prompt: explicit imports; initialize is called in the application startup order.

let simPromptOriginal;

let simPromptPreset;

function setSimMsg(text, ok) {
  const el = document.getElementById('simPromptMsg');
  el.textContent = text;
  el.className = ok === undefined ? 'meta' : (ok ? 'meta ok' : 'meta err');
}

function setSimEditing(editing) {
  const area = document.getElementById('simPromptText');
  area.readOnly = !editing;
  area.classList.toggle('editing', editing);
  document.getElementById('simPromptEdit').disabled = editing;
  document.getElementById('simPromptSave').disabled = !editing;
  document.getElementById('simPromptCancel').disabled = !editing;
}

async function refreshSimPrompt() {
  simPromptPreset = document.getElementById('simPromptPreset').value || 'qq-chat-v2';
  setSimMsg('读取中…');
  try {
    const r = await api('/api/preset/sim-prompt?preset=' + encodeURIComponent(simPromptPreset));
    const area = document.getElementById('simPromptText');
    if (!r.ok) {
      area.value = '';
      setSimMsg(r.error || '读取失败', false);
      document.getElementById('simPromptStatus').textContent = '不可用';
      return;
    }
    simPromptOriginal = r.content;
    area.value = r.content;
    setSimEditing(false);
    setSimMsg('');
    const status = r.status || {};
    document.getElementById('simPromptStatus').textContent =
      `${status.label || simPromptPreset} · ${r.chars} 字符${status.installed ? ' · 已同步到 DSH' : ' · 尚未同步到 DSH'}`;
    document.getElementById('simPromptWarnings').textContent = (r.warnings || []).length
      ? '⚠️ ' + r.warnings.join('；') : '';
    document.getElementById('simPromptRestart').textContent =
      '改动写入该代预设的源文件并同步到 DSH 的 preset 目录；preset 由 DSH 在会话创建时装配，因此新会话会自动用新版，正在进行的 QQ 会话需重置该会话或重启 DSH。';
  } catch (error) {
    setSimMsg('读取失败：' + (error?.message ?? error), false);
  }
}

export function initialize() {
simPromptOriginal = '';
simPromptPreset = 'qq-chat-v2';
}
export { simPromptOriginal, simPromptPreset, setSimMsg, setSimEditing, refreshSimPrompt };

export function setSimPromptOriginal(value) { simPromptOriginal = value; }
