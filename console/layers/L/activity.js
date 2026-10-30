
import { api } from '../../shared/api.js';
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
});
}
export { refreshV2Activity };
