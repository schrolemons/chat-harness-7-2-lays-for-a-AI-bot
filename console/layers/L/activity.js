
import { api } from '../../shared/api.js';
import { viewV2State, showSessionStates } from './session-state.js';
// layers/L/activity: explicit imports; initialize is called in the application startup order.


async function refreshV2Activity() {
  try {
    const r = await api('/api/socialV2/activity');
    const el = document.getElementById('v2ActivityStatus');
    el.textContent = r.paused ? '二代 bot：已暂停' : '二代 bot：运行中';
    el.className = r.paused ? 'meta err' : 'meta ok';
  } catch {}
}

export function initialize() {
document.getElementById('v2PauseBtn').addEventListener('click', async () => {
  await api('/api/socialV2/activity', 'POST', { paused: true });
  refreshV2Activity();
});
document.getElementById('v2ResumeBtn').addEventListener('click', async () => {
  await api('/api/socialV2/activity', 'POST', { paused: false });
  refreshV2Activity();
});
document.getElementById('v2ResetBtn').addEventListener('click', async () => {
  if (!confirm('确定重置二代 AI 状态？\n将清空所有二代会话、唤醒配置、未读消息和定时器；工具调用日志会保留。')) return;
  const r = await api('/api/socialV2/reset', 'POST', {});
  const msg = document.getElementById('lifecycleActionMessage');
  msg.textContent = r.ok ? '✅ 已重置二代状态' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  refreshV2Activity();
  document.getElementById('v2StateSummary').textContent = '暂无会话状态。';
  document.getElementById('v2StateOutput').textContent = '（空）';
});
document.getElementById('v2StateView').addEventListener('click', viewV2State);
document.getElementById('v2ForceWake').addEventListener('click', async () => {
  const key = document.getElementById('v2StateKey').value.trim();
  if (!key) { alert('请输入会话 key'); return; }
  const r = await api('/api/socialV2/wake', 'POST', { key, reason: 'admin' });
  const msg = document.getElementById('lifecycleActionMessage');
  msg.textContent = r.ok ? '✅ 已发送唤醒' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
});
document.getElementById('v2StatesList').addEventListener('click', async () => {
  const r = await api('/api/socialV2/states');
  showSessionStates(r);
});
}
export { refreshV2Activity };
