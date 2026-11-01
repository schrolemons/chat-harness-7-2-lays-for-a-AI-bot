
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
  if (!simPromptPreset) {
    document.getElementById('simPromptText').value = '';
    setSimEditing(false);
    document.getElementById('simPromptEdit').disabled = true;
    setSimMsg('管理员环境使用所选 DSH 预设；请在 DSH 中查看其配置。');
    return;
  }
  setSimMsg('读取中…');
  const requested = simPromptPreset;
  try {
    const r = await api('/api/preset/sim-prompt?preset=' + encodeURIComponent(requested));
    if (requested !== simPromptPreset) return;
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

export function followSimulationMode(mode) {
  const preset = mode === 'reserved2' ? 'qq-chat-v2' : mode === 'reserved' || mode === 'chat' ? 'qq-chat' : null;
  const label = document.getElementById('simPromptMode');
  if (label) label.textContent = preset === 'qq-chat-v2' ? '当前模式：二代仿真；编辑本模式的行为与工具协议。' : preset ? '当前模式：一代／聊天；编辑本模式的行为与工具协议。' : '当前模式：管理员助手；预设由管理员环境选择。';
  if (simPromptPreset !== preset) { simPromptPreset = preset; void refreshSimPrompt(); }
}
