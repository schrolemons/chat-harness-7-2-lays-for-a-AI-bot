
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
  const names = Object.keys(impressions);
  const section = (title, category, count, rows, empty) => `<section class="light-memory-section"><header><h4>${title}</h4><span class="memory-count">${count}</span><button class="small" data-action="clear" data-cat="${category}"${count ? '' : ' disabled'}>清空</button></header><div class="light-memory-items">${rows || `<p class="memory-empty">${empty}</p>`}</div></section>`;
  const textItems = (items, category, extraKey, extraLabel) => items.map(item => {
    const text = esc(String(item?.text || ''));
    return `<article class="light-memory-item"><div class="light-memory-text"><p>${text}</p>${item?.[extraKey] ? `<small>${extraLabel}：${esc(String(item[extraKey]))}</small>` : ''}</div><div class="light-memory-actions"><button class="small" data-action="edit" data-cat="${category}" data-content="${text}">编辑</button><button class="small" data-action="remove" data-cat="${category}" data-content="${text}">删除</button></div></article>`;
  }).join('');
  const memberRows = names.map(name => {
    const im = impressions[name] || {};
    const traits = Array.isArray(im.traits) ? im.traits : [];
    return `<article class="light-memory-item"><div class="light-memory-text"><p><b>${esc(name)}</b> · ${traits.length ? esc(traits.join('、')) : '暂无特质记录'}</p><small>互动 ${Number(im.interactionCount) || 0} 次</small></div><div class="light-memory-actions"><button class="small" data-action="edit" data-cat="memberImpression" data-target="${esc(name)}" data-traits="${esc(traits.join(', '))}">编辑</button><button class="small" data-action="remove" data-cat="memberImpression" data-target="${esc(name)}">删除</button></div></article>`;
  }).join('');
  box.innerHTML = section('进行中的话题', 'activeTopic', topics.length, textItems(topics, 'activeTopic', 'pendingQuestion', '待追问'), '暂无进行中的话题')
    + section('待说的想法', 'pendingThought', thoughts.length, textItems(thoughts, 'pendingThought', 'motivation', '缘由'), '暂无待说的想法')
    + section('窗口内行为印象', 'memberImpression', names.length, memberRows, '当前窗口暂无用户印象');
}

function loadV2Memory() {
  const key = document.getElementById('v2MemoryKey').value.trim();
  const msg = document.getElementById('v2MemoryMsg');
  if (!key) { msg.textContent = '请选择会话'; msg.className = 'meta err'; return; }
  msg.textContent = '加载中…';
  msg.className = 'meta';
  return api('/api/socialV2/memory?key=' + encodeURIComponent(key))
    .then(r => {
      if (document.getElementById('v2MemoryKey').value !== key) return;
      renderV2Memory(r);
      msg.textContent = r.ok ? '✅ 已加载' : ('❌ ' + (r.error || '失败'));
      msg.className = r.ok ? 'meta ok' : 'meta err';
    })
    .catch(e => {
      if (document.getElementById('v2MemoryKey').value !== key) return;
      msg.textContent = '❌ ' + (e.message || e);
      msg.className = 'meta err';
    });
}

export function initialize() {
document.getElementById('v2MemoryKey').addEventListener('change', () => {
  document.getElementById('v2MemoryOutput').innerHTML = '<p class="memory-empty">已切换会话，请点击“加载记忆”查看。</p>';
  document.getElementById('v2MemoryMsg').textContent = '';
});
document.getElementById('v2MemoryLoad').addEventListener('click', loadV2Memory);
document.getElementById('v2MemoryClearAll').addEventListener('click', async () => {
  const key = document.getElementById('v2MemoryKey').value.trim();
  const msg = document.getElementById('v2MemoryMsg');
  if (!key) { msg.textContent = '请选择会话'; msg.className = 'meta err'; return; }
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
  if (!key) { msg.textContent = '请选择会话'; msg.className = 'meta err'; return; }
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
