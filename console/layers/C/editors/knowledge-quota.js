import { api, esc } from '../../../shared/api.js';

const validKey = key => /^(group|private):\d+(?:#\d+)?$/.test(key);
export async function mountKnowledgeQuota({ body, p }) {
  body.insertAdjacentHTML('beforeend', '<div class="quota-console"><div class="quota-console-head"><div><b>今日用量</b><div class="meta">选择全部或某个会话；切换后自动查询，最新计数可点“刷新用量”。</div></div><div class="quota-console-actions"><select class="quota-key member-key" aria-label="配额查询会话"><option value="">全部会话</option><option value="__manual__">手动填写会话…</option></select><input class="quota-manual-key" placeholder="group:群号 或 private:QQ号" aria-label="手动填写配额查询会话 key" data-session-picker="owned" hidden><button class="small quota-query">刷新用量</button><button class="small danger quota-reset">清空今日用量</button></div></div><div class="quota-result" aria-live="polite">正在读取…</div></div>');
  const panel = body.querySelector('.quota-console'), select = panel.querySelector('.quota-key'), manual = panel.querySelector('.quota-manual-key'), result = panel.querySelector('.quota-result');
  let sequence = 0;
  const keys = new Set();
  const keyValue = () => {
    const key = select.value === '__manual__' ? manual.value.trim() : select.value;
    if ((select.value === '__manual__' || key) && !validKey(key)) throw Error('请填写 group:群号 或 private:QQ号；按群成员查询可加 #QQ号');
    return key;
  };
  const fillOptions = () => {
    const previous = select.value;
    select.replaceChildren(new Option('全部会话', ''), ...[...keys].sort().map(key => new Option(key, key)), new Option('手动填写会话…', '__manual__'));
    select.value = previous;
  };
  const call = async (action, key) => {
    const response = await api('/api/plugins/call', 'POST', { tool: 'knowledge_quota', input: { action, ...(key ? { key } : {}) } });
    if (response.ok === false) throw Error(response.error || '请求失败');
    const data = response.result || response;
    if (data.ok !== true) throw Error(data.error || '请求失败');
    return data;
  };
  const query = async () => {
    const request = ++sequence;
    try {
      const key = keyValue(); result.textContent = '正在读取…';
      const data = await call('query', key);
      if (request !== sequence || !panel.isConnected) return;
      const rows = Array.isArray(data.entries) ? data.entries : data.key ? [{ key: data.key, used: data.used, remaining: data.remaining }] : [];
      for (const row of rows) if (validKey(row.key)) keys.add(row.key);
      fillOptions();
      const categories = { professional: '专业求助', casual: '日常交流', uncertain: '待澄清' };
      const records = Array.isArray(data.recentClassifications) ? data.recentClassifications : [];
      result.innerHTML = '<div class="quota-summary"><span>日期 <b>' + esc(data.day || '—') + '</b></span><span>每日上限 <b>' + esc(data.limit ?? '—') + '</b></span><span>计数方式 <b>' + esc(data.countBy === 'user' ? '按发言人' : '按会话') + '</b></span><span>识别方式 <b>' + ((data.semanticEnabled ?? p.config?.semanticEnabled) !== false ? 'AI语义优先' : '关键词规则') + '</b></span>' + ((data.exemptOwner ?? p.config?.exemptOwner) !== false ? '<span>管理员提问不计数</span>' : '<span>管理员提问也计数</span>') + (data.enabled === false ? '<span class="quota-off">功能已停用</span>' : '') + '</div>'
        + (rows.length ? '<div class="quota-rows">' + rows.map(row => '<div class="quota-row"><code>' + esc(row.key) + '</code><span>已用 <b>' + esc(row.used) + '</b></span><span>剩余 <b>' + esc(row.remaining) + '</b></span></div>').join('') + '</div>' : '<div class="quota-empty">今天还没有专业问答用量。</div>');
      if (records.length) result.insertAdjacentHTML('beforeend', '<details class="parameter-block"><summary>最近识别记录</summary>' + records.map(item => '<p class="meta"><code>' + esc(item.bucketKey || item.key) + '</code> · ' + esc(categories[item.category] || item.category) + ' · ' + (item.source === 'ai' ? 'AI判定' : item.source === 'nontext' ? '媒体交回正常会话' : '规则兜底') + '<br>' + esc(item.reason) + '</p>').join('') + '</details>');
    } catch (error) { if (request === sequence) result.textContent = '读取失败：' + error.message; }
  };
  select.addEventListener('change', () => {
    ++sequence; manual.hidden = select.value !== '__manual__';
    if (manual.hidden) void query(); else { manual.focus(); result.textContent = '填写会话 key 后点“刷新用量”。'; }
  });
  manual.addEventListener('input', () => { ++sequence; result.textContent = '填写完成后点“刷新用量”。'; });
  panel.querySelector('.quota-query').addEventListener('click', query);
  panel.querySelector('.quota-reset').addEventListener('click', async () => {
    let key;
    try { key = keyValue(); } catch (error) { result.textContent = error.message; return; }
    if (!confirm(key ? `清空 ${key} 今天的专业问答用量？` : '清空所有会话今天的专业问答用量？')) return;
    const request = ++sequence;
    result.textContent = '正在清空…';
    try { await call('reset', key); if (request === sequence) await query(); }
    catch (error) { if (request === sequence) result.textContent = '清空失败：' + error.message; }
  });
  const sources = await Promise.allSettled([api('/api/socialV2/states'), api('/api/sessions')]);
  for (const source of sources) if (source.status === 'fulfilled') for (const item of source.value.conversations || source.value.sessions || []) if (validKey(item.key)) keys.add(item.key);
  fillOptions();
  await query();
}
