import { api } from '../../shared/api.js';
import './memory.css';

// Memory editors own their selectors; schedule refreshes must not replace them.
export async function refreshMemorySessions() {
  const results = await Promise.allSettled([api('/api/socialV2/states'), api('/api/sessions')]);
  const available = results.filter(result => result.status === 'fulfilled' && result.value.ok !== false).map(result => result.value);
  if (!available.length) throw Error('无法读取会话，请刷新页面重试');
  const keys = [...new Set(available.flatMap(data => [...(data.conversations || []), ...(data.sessions || [])]).map(item => item.key))].filter(key => /^(private|group):\d+$/.test(key));
  for (const id of ['v2MemoryKey', 'v2AffairsKey', 'v2PmKey']) {
    const select = document.getElementById(id), previous = select.value;
    select.replaceChildren(...(keys.length ? keys.map(key => new Option((key.startsWith('group:') ? '群聊 · ' : '私聊 · ') + key.split(':')[1], key)) : [new Option('暂无可选会话', '')]));
    if (keys.includes(previous)) select.value = previous;
  }
  return keys;
}
