
import { registerPageLoader } from '../../shared/page-loaders.js';
import { api, esc } from '../../shared/api.js';
// layers/L/availability: explicit imports; initialize is called in the application startup order.



export function initialize() {
(() => {
  const fmtMin = (mins) => {
    const m = Math.max(0, Math.min(1439, Math.round(Number(mins) || 0)));
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  };
  const fmtIso = (ms) => {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return new Date(n).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  };
  const KIND = { daily: '每天固定', quiet: '一次性免打扰', later: '稍后联系', indefinite: '无限期免打扰' };
  const DONE = { expired: '已过期', cancelled: '已取消', dispatched: '已派发', triggered: '已触发' };
  const typeLabel = (p) => (p.kind === 'quiet' && p.indefinite ? '无限期免打扰' : (KIND[p.kind] || p.kind || '—'));
  const section = document.getElementById('availabilityRefresh')?.closest('details.settings-group');
  const windowLabel = (p) => {
    if (p.kind === 'daily') {
      const ws = Array.isArray(p.windows) ? p.windows : (Number.isFinite(p.start) ? [{ start: p.start, end: p.end }] : []);
      return ws.map((w) => fmtMin(w.start) + ' – ' + fmtMin(w.end)).join('、') || '—';
    }
    if (p.indefinite) return '直到用户再次直接找来';
    if (p.kind === 'later') return '至 ' + fmtIso(p.end);
    return fmtIso(p.start) + ' ~ ' + (p.end ? fmtIso(p.end) : '∞');
  };
  const loadAvailability = async () => {
    const root = document.getElementById('availabilityRoot');
    const status = document.getElementById('availabilityStatus');
    if (!root) return;
    root.innerHTML = '<div class="meta">加载中…</div>';
    try {
      const d = await api('/api/plugins/detail?id=life-user-availability');
      const plans = (d.plugin && d.plugin.state && d.plugin.state.plans) || {};
      const keys = Object.keys(plans);
      if (status) status.textContent = keys.length + ' 条计划';
      if (!keys.length) {
        root.innerHTML = '<div class="meta">（空）当前没有登记任何免打扰 / 稍后联系时段。</div>';
        return;
      }
      const rows = keys.map((k) => {
        const p = plans[k] || {};
        const st = p.finished ? (DONE[p.finished] || p.finished) : '生效中';
        return '<tr><td>' + esc(k) + '</td><td>' + esc(typeLabel(p)) + '</td><td>' + esc(windowLabel(p)) + '</td><td>' + esc(st) + '</td></tr>';
      }).join('');
      root.innerHTML = '<table><tr><th>会话</th><th>类型</th><th>时段</th><th>状态</th></tr>' + rows + '</table>';
    } catch (e) {
      root.innerHTML = '<div class="err">读取失败：' + esc(e.message) + '</div>';
      if (status) status.textContent = '读取失败';
    }
  };
  document.getElementById('availabilityRefresh').addEventListener('click', () => loadAvailability());
  if (section) section.addEventListener('toggle', () => { if (section.open) loadAvailability(); });
  if (section?.open) loadAvailability();
  registerPageLoader('setting-l-0', loadAvailability);
})();
}
