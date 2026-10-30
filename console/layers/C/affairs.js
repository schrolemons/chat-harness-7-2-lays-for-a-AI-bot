import {refreshUsageBudgets} from '../O/usage.js';
import './affairs.css';
import { api, esc } from '../../shared/api.js';
import { registerPageLoader } from '../../shared/page-loaders.js';
import { initializeAffairsBudget, loadAffairsBudget } from './affairs-budget.js';
const labels = { needs_review: '待核实', pending: '待处理', doing: '进行中', waiting: '等待结果', done: '已完成', cancelled: '已取消', superseded: '被替代' };
const el = id => document.getElementById(id);
let selected = null, offset = 0, total = 0, sequence = 0;
let items = new Map();
const key = () => el('v2AffairsKey').value;
const message = text => { el('v2AffairsMsg').textContent = text; el('v2AffairEditorMsg').textContent = text; };
function edit(item = null, show = true) {
  selected = item;
  el('v2AffairEditorMsg').textContent = '';
  for (const [field, id] of [['title', 'Title'], ['detail', 'Detail'], ['nextAction', 'NextAction'], ['source', 'Source']]) el('v2Affair' + id).value = item?.[field] || '';
  el('v2AffairStatus').value = item?.status || 'pending';
  el('v2AffairPriority').value = String(item?.priority ?? 1);
  el('v2AffairEditorTitle').textContent = item ? '编辑事务' : '新增事务';
  if (show && !el('v2AffairEditor').open) el('v2AffairEditor').showModal();
}
async function load() {
  const requestKey = key(), requestId = ++sequence;
  if (!requestKey) { message('请选择会话'); return; }
  message('加载中…');
  try {
    const query = new URLSearchParams({ key: requestKey, status: el('v2AffairsFilter').value, offset, limit: 20 });
    const result = await api('/api/socialV2/affairs?' + query);
    if (requestId !== sequence || requestKey !== key()) return;
    if (!result.ok) throw new Error(result.error || '加载失败');
    items = new Map(result.items.map(item => [item.id, item])); total = result.total;
    el('v2AffairsList').innerHTML = result.items.length ? result.items.map(item => `<article class="affair-card"><div class="affair-card-heading"><strong>${esc(item.title)}</strong><span class="affair-badge" data-status="${esc(item.status)}">${esc(labels[item.status])}</span></div><p class="affair-progress">${esc(item.detail || '尚无进度记录')}</p>${item.nextAction ? `<div class="affair-next"><span>下一步</span>${esc(item.nextAction)}</div>` : ''}<div class="affair-card-footer"><span class="meta">${item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() + ' 更新' : ''}</span><div><button class="small" type="button" data-affair-id="${esc(item.id)}">编辑</button>${['needs_review','pending','doing','waiting'].includes(item.status) ? `<button class="small" type="button" data-affair-done="${esc(item.id)}">标记完成</button>` : ''}</div></div></article>`).join('') : '当前范围没有事务';
    el('v2AffairsPage').textContent = `共 ${total} 项 · 第 ${Math.floor(offset / 20) + 1} 页`;
    el('v2AffairsPrev').disabled = offset === 0; el('v2AffairsNext').disabled = offset + 20 >= total;
    el('v2AffairsPreview').textContent = result.preview?.text || '（当前预算未选中事务）';
    el('v2AffairsPreviewInfo').textContent = `选中 ${result.preview?.selectedIds?.length || 0} 项，未选中 ${result.preview?.omittedIds?.length || 0} 项。组合记忆总预算可能进一步收紧；未选中内容仍完整保存。`;
    message('已加载 ' + result.items.length + ' 项');
    return true;
  } catch (error) { if (requestId === sequence) message('读取失败：' + error.message); return false; }
}
async function loadKeys() {
  try {
    const result = await api('/api/socialV2/states');
    if (!result.ok) throw new Error(result.error || '无法读取会话');
    const previous = key(), keys = result.conversations.map(item => item.key).filter(value => /^(private|group):\d+$/.test(value));
    el('v2AffairsKey').innerHTML = keys.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    if (keys.includes(previous)) el('v2AffairsKey').value = previous;
    await load();
  } catch (error) { message('读取会话失败：' + error.message); }
}
async function save() {
  if (!key()) { message('请选择会话'); return; }
  const requestKey = key(), payload = { key: requestKey, action: 'upsert', title: el('v2AffairTitle').value.trim(), detail: el('v2AffairDetail').value,
    nextAction: el('v2AffairNextAction').value, source: el('v2AffairSource').value, status: el('v2AffairStatus').value, priority: Number(el('v2AffairPriority').value),
    ...(selected ? { id: selected.id, expectedRevision: selected.revision } : {}) };
  if (!payload.title) { message('请填写事项标题'); return; }
  el('v2AffairsSave').disabled = true;
  try {
    const result = await api('/api/socialV2/affairs', 'POST', payload);
    if (!result.ok) throw new Error(result.error || '保存失败');
    if (requestKey !== key()) return;
    el('v2AffairEditor').close(); selected = null; await load(); message('已保存');
  } catch (error) { message('保存失败：' + error.message + '。表单内容已保留；如有版本冲突，请刷新并重新打开该事务。'); }
  finally { el('v2AffairsSave').disabled = false; }
}
export function initialize() {
  initializeAffairsBudget(async () => {
    if (!key()) return false;
    const refreshed = await load();
    if (refreshed === false) throw Error('事务预览刷新失败，请点“刷新事务”重试');
    return refreshed;
  });
  el('v2AffairsLoad').addEventListener('click', () => key() ? load() : loadKeys());
  el('v2AffairsNew').addEventListener('click', () => edit());
  el('v2AffairsSave').addEventListener('click', save);
  el('v2AffairsCancel').addEventListener('click', () => el('v2AffairEditor').close());
  el('v2AffairsList').addEventListener('click', event => { const button = event.target.closest('[data-affair-id]'); if (button) edit(items.get(button.dataset.affairId));
    const done = event.target.closest('[data-affair-done]');
    if (done) { const item = items.get(done.dataset.affairDone); done.disabled = true;
      void api('/api/socialV2/affairs','POST',{key:key(),action:'upsert',id:item.id,expectedRevision:item.revision,status:'done'}).then(result=>{if(!result.ok)throw Error(result.error||'更新失败');return load();}).catch(error=>{message(error.message);done.disabled=false;});
    } });
  for (const id of ['v2AffairsKey', 'v2AffairsFilter']) el(id).addEventListener('change', () => { offset = 0; edit(null, false); el('v2AffairEditor').close(); void load(); });
  el('v2AffairsPrev').addEventListener('click', () => { offset = Math.max(0, offset - 20); void load(); });
  el('v2AffairsNext').addEventListener('click', () => { offset += 20; void load(); });
  registerPageLoader('setting-c-1', () => Promise.all([loadKeys(), loadAffairsBudget(), refreshUsageBudgets()]));
}
