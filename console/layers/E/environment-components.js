
import { registerPageLoader } from '../../shared/page-loaders.js';
import { componentUI } from '../../shared/components/service.js';
import { api, esc } from '../../shared/api.js';
// layers/E/environment-components: explicit imports; initialize is called in the application startup order.



export function initialize() {
(() => {
  const loadEnvironments = () => {
    if (!componentUI.renderIds) return;
    document.querySelectorAll('.env-comp-root').forEach((root) => {
      const ids = (root.dataset.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
      componentUI.renderIds(ids, root.id);
    });
    void loadStatus();
  };
  const loadStatus = () => {
    const status = document.getElementById('envMonitorStatus');
    const scriptStatus = document.getElementById('envScriptStatus');
    if (!status) return;
    api('/api/plugins/call', 'POST', { tool: 'campus_watch_status', input: {} }).then(response => {
      const result = response.result || {};
      const label = { green: '正常', red: '需协助', baseline: '已建基线', stable: '无变化', changed: '有更新', pending: '待发送', none: '无待发送', unknown: '待检查' };
      const lamps = [['fetch', '读取'], ['auth', '登录'], ['diff', '变化'], ['delivery', '发送']];
      status.innerHTML = (result.sites || []).length ? result.sites.map(site =>
        '<div class="tool-reference-item"><strong>' + esc(site.name) + '</strong><span><code>' + esc(site.url) + '</code><br>' + lamps.map(([key, title]) => {
          const value = site.health?.[key] || 'unknown';
          return '<span class="monitor-lamp ' + esc(value) + '" title="' + esc(title + '：' + (label[value] || value)) + '">● ' + esc(title) + '</span>';
        }).join('') + '<br><small>' + esc(site.health?.hint || '等待首次检查') + '</small></span></div>').join('') : '<div class="meta">暂无监控网址。可在上方填写。</div>';
      if (scriptStatus) scriptStatus.innerHTML = (result.scripts || []).length ? result.scripts.map(script =>
        '<div class="tool-reference-item"><code>' + esc(script.path) + '</code><span class="monitor-lamp ' + esc(script.health) + '">● ' + esc(script.health === 'fallback' ? '备用流程正常' : script.health === 'green' ? '运行正常' : script.health === 'red' ? '运行失败' : script.health === 'paused' ? '未启用' : script.health === 'stale' ? '心跳过期' : '暂无心跳') + '</span><small>' + esc((script.checkedAt ? new Date(script.checkedAt).toLocaleString() + ' · ' : '') + (script.hint || '')) + '</small></div>').join('') : '<div class="meta">暂无协同脚本。可在上方每行填写一个路径。</div>';
    }).catch(() => {
      status.innerHTML = '<div class="meta">监控灯等待组件重载后显示。</div>';
      if (scriptStatus) scriptStatus.innerHTML = '<div class="meta">脚本灯等待组件重载后显示。</div>';
    });
  };
  registerPageLoader('environments', loadEnvironments);
  document.getElementById('envStatusRefresh').addEventListener('click',loadStatus);
  setInterval(()=>{if(document.visibilityState==='visible' && !document.getElementById('section-environments').hidden)loadStatus();},30000);
})();
}
