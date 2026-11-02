import { api } from '../../shared/api.js';

const componentId = 'ctx-memory-context';
const el = id => document.getElementById(id);
let dirty = false, saving = false;

async function readConfig() {
  const result = await api('/api/plugins/detail?id=' + componentId);
  if (!result.ok || !result.plugin) throw Error(result.error || '无法读取事务预算');
  return result.plugin;
}

export async function loadAffairsBudget() {
  if (dirty || saving) return;
  try {
    const plugin = await readConfig();
    if (dirty || saving) return;
    for (const [id, key] of [['v2FactsBudget', 'maxChars'], ['v2AffairsBudget', 'affairsMaxChars']]) {
      const input = el(id), rule = plugin.configSchema[key];
      input.min = rule.min; input.max = rule.max;
      input.value = plugin.config[key]; input.disabled = false;
    }
    el('v2AffairsBudgetSave').disabled = false;
    el('v2AffairsBudgetMsg').textContent = '';
  } catch (error) { el('v2AffairsBudgetMsg').textContent = '读取预算失败：' + error.message; }
}

export function initializeAffairsBudget(refreshPreview) {
  const input = el('v2AffairsBudget'), facts = el('v2FactsBudget'), button = el('v2AffairsBudgetSave'), message = el('v2AffairsBudgetMsg');
  for (const field of [input, facts]) field.addEventListener('input', () => { dirty = true; message.textContent = '尚未保存'; });
  button.addEventListener('click', async () => {
    if (!facts.reportValidity() || !input.reportValidity()) return;
    const value = input.valueAsNumber, factsValue = facts.valueAsNumber;
    if (!Number.isInteger(value) || !Number.isInteger(factsValue)) { message.textContent = '请填写整数预算'; return; }
    saving = true; input.disabled = true; facts.disabled = true; button.disabled = true;
    message.textContent = '保存中…';
    let saved = false;
    try {
      const result = await api('/api/plugins/config', 'POST', { id: componentId, config: { maxChars: factsValue, affairsMaxChars: value } });
      if (!result.ok) throw Error(result.error || '保存失败');
      saved = true;
      const plugin = await readConfig();
      if (plugin.config.affairsMaxChars !== value || plugin.config.maxChars !== factsValue) throw Error('预算读回不一致，请刷新核对');
      input.value = plugin.config.affairsMaxChars;
      facts.value = plugin.config.maxChars;
      dirty = false;
      const refreshed = await refreshPreview();
      message.textContent = '已保存并重载' + (refreshed ? '，预览已刷新' : '');
    } catch (error) { message.textContent = (saved ? '已保存，复核失败：' : '保存失败：') + error.message; }
    finally { saving = false; input.disabled = false; facts.disabled = false; button.disabled = false; }
  });
}
