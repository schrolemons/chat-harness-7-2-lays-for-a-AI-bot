
import { setSimPromptOriginal, simPromptOriginal, simPromptPreset, setSimMsg, setSimEditing, refreshSimPrompt } from './preset-prompt.js';
import { api } from '../../shared/api.js';
// layers/C/preset-actions: explicit imports; initialize is called in the application startup order.




export function initialize() {
document.getElementById('simPromptEdit').addEventListener('click', () => {
  setSimEditing(true);
  setSimMsg('编辑中：改完点「保存并同步到 DSH」。保存会先备份，并做 YAML 与安全不变量校验。');
});
document.getElementById('simPromptCancel').addEventListener('click', () => {
  document.getElementById('simPromptText').value = simPromptOriginal;
  setSimEditing(false);
  setSimMsg('已放弃修改');
});
document.getElementById('simPromptPreset').addEventListener('change', () => { refreshSimPrompt(); });
document.getElementById('simPromptSave').addEventListener('click', async () => {
  const content = document.getElementById('simPromptText').value;
  if (!confirm('保存会改写该代预设的源文件并同步到 DSH 的 preset 目录（新会话生效，进行中的会话需重置或重启 DSH）。确定继续？')) return;
  setSimMsg('保存中…');
  const r = await api('/api/preset/sim-prompt', 'POST', { preset: simPromptPreset, content });
  if (!r.ok) { setSimMsg('❌ ' + (r.error || '保存失败'), false); return; }
  if (r.unchanged) {
    setSimPromptOriginal(content);
    setSimEditing(false);
    setSimMsg('内容没有变化，未写入文件（避免无谓地重排预设格式）', true);
    return;
  }
  setSimPromptOriginal(content);
  setSimEditing(false);
  setSimMsg(`✅ 已保存${r.synced ? '并同步到 DSH' : ''}；重启 DSH 后生效`, true);
  document.getElementById('simPromptWarnings').textContent = (r.warnings || []).length ? '⚠️ ' + r.warnings.join('；') : '';
  document.getElementById('simPromptStatus').textContent = `${r.status?.label || simPromptPreset} · ${content.length} 字符 · 已保存，待重启 DSH`;
});
document.getElementById('simPromptRestore').addEventListener('click', async () => {
  if (!confirm('还原到该代预设上一次保存前的备份？当前改动会丢失（原文件会先自动备份）。')) return;
  const r = await api('/api/preset/sim-prompt/restore', 'POST', { preset: simPromptPreset });
  if (!r.ok) { setSimMsg('❌ ' + (r.error || '还原失败'), false); return; }
  setSimMsg(`✅ 已还原（${r.restoredFrom}）；重启 DSH 后生效`, true);
  refreshSimPrompt();
});
}
