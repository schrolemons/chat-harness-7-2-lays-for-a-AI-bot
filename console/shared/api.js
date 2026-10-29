
// shared/api: explicit imports; initialize is called in the application startup order.

async function api(path, method, body, _retried = 0) {
  const headers = body ? {'content-type':'application/json'} : {};
  const token = localStorage.getItem('consoleToken');
  if (token) headers['x-console-token'] = token;
  const res = await fetch(path, { method: method || 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) {
    if (_retried >= 2) {
      localStorage.removeItem('consoleToken');
      throw new Error('未授权');
    }
    const t = prompt('请输入控制台访问令牌：');
    if (t) {
      localStorage.setItem('consoleToken', t.trim());
      return api(path, method, body, _retried + 1);
    }
    localStorage.removeItem('consoleToken');
    throw new Error('未授权');
  }
  return res.json();
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

export function initialize() {
(function () {
  // 如果通过 ?token= 进入（控制台启用鉴权时根路径会重定向带 token），存到 localStorage
  const qs = new URLSearchParams(location.search);
  const token = qs.get('token');
  if (token) {
    localStorage.setItem('consoleToken', token);
    history.replaceState({}, '', location.pathname + location.hash);
  }
})();
}
export { api, esc };
