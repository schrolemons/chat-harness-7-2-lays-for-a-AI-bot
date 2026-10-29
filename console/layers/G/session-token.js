
import { api } from '../../shared/api.js';
export async function changeConsoleToken(generate) {
  const input = document.getElementById('consoleTokenInput');
  const msg = document.getElementById('consoleTokenMsg');
  const token = generate ? '' : input.value.trim();
  if (!generate && token && token.length < 16) {
    msg.textContent = '❌ 令牌至少需要 16 位';
    msg.className = 'meta err';
    return;
  }
  const r = await api('/api/console/token', 'POST', { token });
  if (!r.ok) {
    msg.textContent = '❌ ' + (r.error || '修改失败');
    msg.className = 'meta err';
    return;
  }
  // 保存到 localStorage，当前页面继续使用新令牌
  localStorage.setItem('consoleToken', r.token);
  input.value = r.token;
  msg.textContent = r.generated ? '已生成随机令牌，当前页面已自动使用。可点击显示后复制。' : '已保存新令牌';
  msg.className = 'meta ok';
}
export function initialize() {
document.getElementById('consoleTokenSave').addEventListener('click', () => changeConsoleToken(false));
document.getElementById('consoleTokenRandom').addEventListener('click', () => changeConsoleToken(true));
}
