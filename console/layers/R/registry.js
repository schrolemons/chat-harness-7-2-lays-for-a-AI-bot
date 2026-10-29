
import { registerPageLoader } from '../../shared/page-loaders.js';
import { api, esc } from '../../shared/api.js';
// layers/R/registry: explicit imports; initialize is called in the application startup order.



export function initialize() {
(() => {
  async function loadRegistry() {
    const root = document.getElementById('registryRoot');
    const status = document.getElementById('registryStatus');
    if (!root) return;
    root.innerHTML = '<div class="meta">读取中…</div>';
    try {
      const data = await api('/api/plugins');
      const userPlugins = (data.plugins || []).filter((p) => p.builtin === false);
      if (!userPlugins.length) {
        root.innerHTML = '<div class="meta">（空）没有第三方项目。把项目放进 <code>plugins/qq-components-user/&lt;id&gt;/</code>（至少带 plugin.json），刷新后就会出现在这里。</div>';
        if (status) status.textContent = '0 个待管理化';
        return;
      }
      const html = userPlugins.map((p) => {
        const harnessed = !!(p.layer);
        return '<div class="comp-card"><div class="comp-layer-head"><b>' + esc(p.name) + '</b><span class="meta">' + esc(p.id) + ' v' + esc(p.version || '0') + '</span><span class="pill ' + (harnessed ? 'on' : 'off') + '">' + (harnessed ? '已管理化 · ' + esc(p.layer) : '未管理化') + '</span></div>' +
          '<div class="meta">' + esc(p.description) + '</div>' +
          '<div class="row" style="gap:8px;margin-top:6px"><button class="small harnessify" data-id="' + esc(p.id) + '">接入控制台</button><span class="meta harness-msg"></span></div></div>';
      }).join('');
      root.innerHTML = html;
      if (status) status.textContent = userPlugins.length + ' 个第三方项目';
      root.querySelectorAll('.harnessify').forEach((b) => b.addEventListener('click', async () => {
        const msg = b.parentElement.querySelector('.harness-msg');
        msg.textContent = '正在接入控制台…';
        try {
          const r = await api('/api/plugins/harnessify', 'POST', { id: b.dataset.id });
          msg.textContent = '完成：' + (r.message || '已归入对应层');
          loadRegistry();
        } catch (e) {
          msg.textContent = '后端待接入（桥接重启后可用）：' + e.message;
        }
      }));
    } catch (e) {
      root.innerHTML = '<div class="err">读取失败：' + esc(e.message) + '</div>';
      if (status) status.textContent = '读取失败';
    }
  }
  registerPageLoader('registry', loadRegistry);
  document.getElementById('registryRefresh').addEventListener('click', loadRegistry);
})();
}
