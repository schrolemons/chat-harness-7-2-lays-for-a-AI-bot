import { api } from '../../shared/api.js';
import { createProactiveExamples, applyProactiveExample } from './proactive-examples.js';

let previewAt = 0;
let busy = false;
const el = id => document.getElementById(id);
function sync() {
  el('v2ExampleApply').disabled = busy || !el('v2ExampleKey').value || !el('v2ExampleConsent').checked;
  for (const id of ['v2ExampleKey', 'v2ExampleTemplate', 'v2ExampleConsent']) el(id).disabled = busy;
}
function preview() {
  previewAt = Date.now();
  const template = createProactiveExamples(previewAt).find(x => x.id === el('v2ExampleTemplate').value);
  el('v2ExamplePreview').textContent = template.description + (template.item
    ? '\n本次首次发生：' + new Date(template.item.dueAt).toLocaleString('zh-CN', { hour12: false }) + '（浏览器本地时间；保存绝对时间）'
    : '\n保存后从下一个有效时段开始，每天重复；已错过时段不补发。');
  el('v2ExampleConsent').checked = false;
  sync();
}

export function updateExampleConversations(conversations) {
  const select = el('v2ExampleKey');
  if (!select) return;
  const previous = select.value;
  select.replaceChildren(new Option('请选择要启用示例的真实会话', ''));
  for (const conversation of conversations) {
    if (/^(private|group):\d+$/.test(conversation.key || '')) select.add(new Option(conversation.key, conversation.key));
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
  if (select.value !== previous) el('v2ExampleConsent').checked = false;
  sync();
}

export function initializeProactiveExamples(onApplied) {
  const select = el('v2ExampleTemplate');
  if (!select) return;
  for (const template of createProactiveExamples()) select.add(new Option(template.title, template.id));
  preview();
  select.addEventListener('change', preview);
  el('v2ExampleKey').addEventListener('change', () => { el('v2ExampleConsent').checked = false; sync(); });
  el('v2ExampleConsent').addEventListener('change', sync);
  el('v2ExampleApply').addEventListener('click', async () => {
    if (busy) return;
    const key = el('v2ExampleKey').value;
    const templateId = select.value;
    const optIn = el('v2ExampleConsent').checked;
    const template = createProactiveExamples(previewAt).find(x => x.id === templateId);
    if (new Date(previewAt).toDateString() !== new Date().toDateString() || (template?.item && template.item.dueAt - template.item.leadMinutes * 60000 <= Date.now())) {
      preview();
      el('v2ExampleMsg').textContent = '日期或提醒窗口已变化，已刷新预览；请重新确认。';
      return;
    }
    busy = true;
    sync();
    try {
      const result = await applyProactiveExample({ templateId, key, optIn, now: previewAt, api });
      el('v2ExampleMsg').textContent = result.added
        ? `已添加 ${result.added} 项到 ${key}；可在下方编辑或删除。到点是否发送仍遵守现有组件与会话规则。`
        : '示例已存在；保留现有内容、修改和锁定状态。';
      el('v2ExampleConsent').checked = false;
      await onApplied?.({ key, template, result });
    } catch (error) {
      el('v2ExampleMsg').textContent = '添加失败：' + error.message;
    } finally { busy = false; sync(); }
  });
}
