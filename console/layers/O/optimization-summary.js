
import { api } from '../../shared/api.js';
import { renderV2ToolLog, loadV2ToolLog } from './tool-log.js';
// layers/O/optimization-summary: explicit imports; initialize is called in the application startup order.


async function loadV2OptimizationSummary() {
  const button = document.getElementById('v2OptimizationSummaryLoad');
  const meta = document.getElementById('v2OptimizationSummaryMeta');
  const output = document.getElementById('v2OptimizationSummaryContent');
  if (button) button.disabled = true;
  if (meta) meta.textContent = '正在读取摘要文件…';
  try {
    const result = await api('/api/socialV2/optimization-memory');
    if (result?.ok !== true) throw new Error(result?.error || '读取失败');
    if (output) output.textContent = result.content || '摘要文件目前为空。';
    if (meta) meta.textContent = result.exists
      ? `共 ${Number(result.chars) || 0} 字 · 更新于 ${result.updatedAt ? new Date(result.updatedAt).toLocaleString() : '时间未知'}`
      : '摘要文件尚未生成；主动扫描或修复处理后会在此显示。';
  } catch (error) {
    if (output) output.textContent = `读取失败：${error?.message || error || '请求失败'}`;
    if (meta) meta.textContent = '无法读取摘要文件';
  } finally {
    if (button) button.disabled = false;
  }
}

export function initialize() {
document.getElementById('v2OptimizationSummaryLoad')?.addEventListener('click', loadV2OptimizationSummary);
loadV2OptimizationSummary();
document.getElementById('v2ToolLogLoad').addEventListener('click', async () => {
  const msg = document.getElementById('v2ToolLogMsg');
  msg.textContent = '';
  await loadV2ToolLog();
});
document.getElementById('v2ToolLogClear').addEventListener('click', async () => {
  if (!confirm('确定清空全部工具调用日志？')) return;
  const r = await api('/api/socialV2/tool-log/clear', 'POST', {});
  const msg = document.getElementById('v2ToolLogMsg');
  msg.textContent = r.ok ? '✅ 已清空' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  renderV2ToolLog([]);
});
}
export { loadV2OptimizationSummary };
