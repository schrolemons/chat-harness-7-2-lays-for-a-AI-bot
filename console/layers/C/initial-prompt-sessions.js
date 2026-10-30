import { api } from '../../shared/api.js';

export const manualSession = '__manual__';
export const validSessionKey = key => /^(group|private):\d+$/.test(key);
const picker = () => document.getElementById('v2InitPromptKey');
export function initialPromptKey() {
  return picker().value === manualSession ? document.getElementById('v2InitPromptManualKey').value.trim() : picker().value;
}
export function selectInitialPromptKey(key) {
  const select = picker();
  if (key && ![...select.options].some(option => option.value === key)) select.add(new Option(key, key), select.options.length - 1);
  select.value = key;
  document.getElementById('v2InitPromptManualKey').hidden = true;
}
export async function refreshInitialPromptSessions() {
  const results = await Promise.allSettled([api('/api/socialV2/states'), api('/api/sessions'), api('/api/socialV2/initial-prompt')]);
  const keys = new Set();
  const fields = ['conversations', 'sessions', 'entries'];
  let available = 0;
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled' || result.value.ok === false) return;
    available++;
    for (const item of result.value[fields[index]] || []) if (validSessionKey(item.key)) keys.add(item.key);
  });
  if (!available) throw Error('无法读取会话列表，可选择手动填写会话 key');
  const select = picker(), previous = select.value;
  if (validSessionKey(previous)) keys.add(previous);
  select.replaceChildren(new Option('选择群聊或私聊…', ''),
    ...[...keys].sort().map(key => new Option((key.startsWith('group:') ? '群聊 · ' : '私聊 · ') + key, key)),
    new Option('手动填写新会话…', manualSession));
  select.value = previous;
}
