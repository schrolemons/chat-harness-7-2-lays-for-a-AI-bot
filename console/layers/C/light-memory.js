
import { api, esc } from '../../shared/api.js';
// layers/C/light-memory: explicit imports; initialize is called in the application startup order.

function renderV2Memory(data) {
  const box = document.getElementById('v2MemoryOutput');
  if (!data || !data.ok) {
    box.innerHTML = '<span class="meta">加载失败</span>';
    return;
  }
  const raw = data.raw || {};
  const topics = Array.isArray(raw.activeTopics) ? raw.activeTopics : [];
  const thoughts = Array.isArray(raw.pendingThoughts) ? raw.pendingThoughts : [];
  const impressions = raw.memberImpressions && typeof raw.memberImpressions === 'object' ? raw.memberImpressions : {};
  let html = '<div style="padding:8px">';
  html += '<div class="memory-section"><b>进行中的话题</b> <button class="small" data-action="clear" data-cat="activeTopic">清空</button>';
  if (!topics.length) html += '<div class="meta">（空）</div>';
  for (const t of topics) {
    const text = esc(String(t?.text || ''));
    const extra = t?.pendingQuestion ? `；待追问：${esc(String(t.pendingQuestion))}` : '';
    html += `<div style="margin:4px 0">📌 ${text}${extra} <button class="small" data-action="edit" data-cat="activeTopic" data-content="${esc(String(t?.text || ''))}">编辑</button> <button class="small" data-action="remove" data-cat="activeTopic" data-content="${esc(String(t?.text || ''))}">删除</button></div>`;
  }
  html += '</div>';
  html += '<div class="memory-section"><b>你想说但还没说的</b> <button class="small" data-action="clear" data-cat="pendingThought">清空</button>';
  if (!thoughts.length) html += '<div class="meta">（空）</div>';
  for (const t of thoughts) {
    html += `<div style="margin:4px 0">💭 ${esc(String(t?.text || ''))}${t?.motivation ? `（${esc(String(t.motivation))}）` : ''} <button class="small" data-action="edit" data-cat="pendingThought" data-content="${esc(String(t?.text || ''))}">编辑</button> <button class="small" data-action="remove" data-cat="pendingThought" data-content="${esc(String(t?.text || ''))}">删除</button></div>`;
  }
  html += '</div>';
  html += '<div class="memory-section"><b>当前小上下文窗口内对用户的行为印象</b> <button class="small" data-action="clear" data-cat="memberImpression">清空</button>';
  const names = Object.keys(impressions);
  if (!names.length) html += '<div class="meta">（空）</div>';
  for (const name of names) {
    const im = impressions[name] || {};
    const traits = Array.isArray(im.traits) ? im.traits : [];
    html += `<div style="margin:4px 0">👤 ${esc(name)}：${traits.length ? esc(traits.join('、')) : '暂无记录'}（互动 ${Number(im.interactionCount) || 0} 次） <button class="small" data-action="edit" data-cat="memberImpression" data-target="${esc(name)}" data-traits="${esc(traits.join(', '))}">编辑</button> <button class="small" data-action="remove" data-cat="memberImpression" data-target="${esc(name)}">删除</button></div>`;
  }
  html += '</div></div>';
  box.innerHTML = html;
}

function loadV2Memory() {
  const key = document.getElementById('v2MemoryKey').value.trim();
  const msg = document.getElementById('v2MemoryMsg');
  if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
  msg.textContent = '加载中…';
  msg.className = 'meta';
  return api('/api/socialV2/memory?key=' + encodeURIComponent(key))
    .then(r => {
      renderV2Memory(r);
      msg.textContent = r.ok ? '✅ 已加载' : ('❌ ' + (r.error || '失败'));
      msg.className = r.ok ? 'meta ok' : 'meta err';
    })
    .catch(e => {
      msg.textContent = '❌ ' + (e.message || e);
      msg.className = 'meta err';
    });
}

export function initialize() {
document.getElementById('v2MemoryLoad').addEventListener('click', loadV2Memory);
document.getElementById('v2MemoryClearAll').addEventListener('click', async () => {
  const key = document.getElementById('v2MemoryKey').value.trim();
  const msg = document.getElementById('v2MemoryMsg');
  if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
  if (!confirm('确定清空该会话全部轻量记忆？')) return;
  const r = await api('/api/socialV2/memory-clear', 'POST', { key, category: '' });
  msg.textContent = r.ok ? '✅ 已清空此会话轻量记忆' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) loadV2Memory();
});
document.getElementById('v2MemoryOutput').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const key = document.getElementById('v2MemoryKey').value.trim();
  const msg = document.getElementById('v2MemoryMsg');
  if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
  const cat = btn.dataset.cat;
  const action = btn.dataset.action;
  let r;
  if (action === 'clear') {
    r = await api('/api/socialV2/memory-clear', 'POST', { key, category: cat });
  } else if (action === 'edit') {
    let newContent;
    let newExtra = {};
    if (cat === 'memberImpression') {
      const input = prompt(`编辑对 ${btn.dataset.target} 的印象特质（逗号分隔）：`, btn.dataset.traits || '');
      if (input === null) return;
      newContent = input;
    } else {
      const input = prompt(`编辑${cat === 'activeTopic' ? '话题' : '想法'}内容：`, btn.dataset.content || '');
      if (input === null) return;
      newContent = input;
    }
    r = await api('/api/socialV2/memory-update', 'POST', { key, category: cat, oldContent: btn.dataset.content || '', target: btn.dataset.target || '', newContent, newExtra });
  } else {
    r = await api('/api/socialV2/memory-remove', 'POST', { key, category: cat, content: btn.dataset.content || '', target: btn.dataset.target || '' });
  }
  msg.textContent = r.ok ? '✅ 已更新' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) loadV2Memory();
});
}
export { renderV2Memory, loadV2Memory };
