import {readSourceKeys,sourceKeysText,sourceKeysMarkup,requireLearningScopes} from './source-keys.js';

import { setSlangActiveTab, setSlangEntriesCache, setSlangModalId, setSlangModalMode, slangEntriesCache, slangSelected, slangActiveTab, slangModalId, slangModalMode } from './slang-state.js';
import { api, esc } from '../../shared/api.js';
import { learningCall } from './learning-common.js';
// layers/C/slang: explicit imports; initialize is called in the application startup order.



function slangStatusLabel(status) {
  return { candidate: '候选', confirmed: '已确认', rejected: '已拒绝' }[status] || esc(status);
}

function slangStatusClass(status) {
  return { candidate: 'pill b', confirmed: 'pill g', rejected: 'pill r' }[status] || 'pill';
}

function slangSourceLabel(e) {
  if (e.source === 'manual') return '手动';
  if (Array.isArray(e.evidence) && e.evidence.some((ev) => ev.sender === 'AI提交')) return 'AI提交';
  return '自动提取';
}

function slangEvidenceHtml(e) {
  return Array.isArray(e.evidence) && e.evidence.length
    ? e.evidence.slice(-2).map((ev) => `<span class="meta">${esc(String(ev.sender || '未知'))}：${esc(String(ev.text || '').slice(0, 30))}</span>`).join('<br>')
    : '<span class="meta">—</span>';
}

function slangSourcesHtml(e) {
  return Array.isArray(e.sources) && e.sources.length
    ? e.sources.slice(0, 5).map((s) => `<span class="meta">🔗 ${esc(s)}</span>`).join('<br>')
    : '';
}

function slangSearchFields(e) {
  return [e.content, e.meaning, e.usage, e.example, e.risk, Array.isArray(e.sources) ? e.sources.join(' ') : '', Array.isArray(e.evidence) ? e.evidence.map((x) => x.text || '').join(' ') : ''].join(' ').toLowerCase();
}

function getSlangLimit() {
  const id = slangActiveTab === 'candidate' ? 'slangLimitCand' : slangActiveTab === 'confirmed' ? 'slangLimitConfirmed' : 'slangLimitRejected';
  return Math.max(10, Number(document.getElementById(id)?.value) || 100);
}

function getSlangSearch() {
  const id = slangActiveTab === 'candidate' ? 'slangSearchCand' : slangActiveTab === 'confirmed' ? 'slangSearchConfirmed' : 'slangSearchRejected';
  return String(document.getElementById(id)?.value || '').trim().toLowerCase();
}

function selectedIdsForStatus(status) {
  return [...slangSelected].filter((id) => slangEntriesCache.some((e) => e.id === id && e.status === status));
}

function setSlangMsg(text, ok = true) {
  const msg = document.getElementById('slangMsg');
  if (!msg) return;
  msg.textContent = text;
  msg.className = ok ? 'meta ok' : 'meta err';
}

function setSlangTab(tab) {
  setSlangActiveTab(tab);
  document.querySelectorAll('#section-slang .slang-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.slangTab === tab));
  document.querySelectorAll('#section-slang .slang-panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'slangPanel' + tab[0].toUpperCase() + tab.slice(1)));
  renderSlangPanel();
}

function updateSlangSelectAll(status) {
  const id = status === 'candidate' ? 'slangCandidateSelectAll' : status === 'confirmed' ? 'slangConfirmedSelectAll' : 'slangRejectedSelectAll';
  const el = document.getElementById(id);
  if (!el) return;
  const list = slangEntriesCache.filter((e) => e.status === status);
  const q = getSlangSearch();
  const filtered = q ? list.filter((e) => slangSearchFields(e).includes(q)) : list;
  el.checked = filtered.length > 0 && filtered.every((e) => slangSelected.has(e.id));
  el.indeterminate = filtered.some((e) => slangSelected.has(e.id)) && !el.checked;
}

function renderSlangPanel() {
  const status = slangActiveTab;
  const containerId = status === 'candidate' ? 'slangCandidateList' : status === 'confirmed' ? 'slangConfirmedList' : 'slangRejectedList';
  const box = document.getElementById(containerId);
  if (!box) return;
  const list = slangEntriesCache.filter((e) => e.status === status);
  const q = getSlangSearch();
  const filtered = q ? list.filter((e) => slangSearchFields(e).includes(q)) : list;
  if (!filtered.length) {
    box.innerHTML = '<div class="meta" style="padding:8px">' + (list.length ? '没有符合条件的词条' : (status === 'candidate' ? '暂无候选黑话，等 DSH 自动提取、AI 提交或手动添加' : status === 'confirmed' ? '暂无已确认黑话' : '暂无已拒绝词条')) + '</div>';
    updateSlangSelectAll(status);
    return;
  }
  const limit = getSlangLimit();
  const shown = filtered.slice(0, limit);
  let html = `<div class="meta" style="padding:6px 8px">共 ${filtered.length} 条，显示 ${shown.length} 条（可滚动查找）</div>`;
  html += '<table><tr><th>选择</th><th>词条</th><th>次数</th><th>录入 / 适用来源</th><th>含义 / 用法 / 示例</th><th>参考来源</th><th>语境证据</th><th>操作</th></tr>';
  for (const e of shown) {
    const researchLabel=status==='candidate'?(Number(e.lastInferenceCount)>0?(Number(e.lastInferenceCount)<Number(e.count)?'有新语境，待复核':e.meaning?'已研究，待审核':'已研究，仍不确定'):e.meaning?'已有解释，待审核':String(e.risk||'').startsWith('研究未确定：')?'已研究，仍不确定':'待研究'):'';
    const meaning = e.meaning ? esc(e.meaning)+(status==='candidate'?'<br><span class="meta">'+researchLabel+'</span>':'') : (status === 'candidate' ? '<span class="meta">'+researchLabel+'</span>' : '<span class="meta">无</span>');
    const checked = slangSelected.has(e.id) ? ' checked' : '';
    const actions = [];
    if (status === 'candidate') {
      actions.push(`<button class="small" data-slang-edit="${esc(e.id)}">查看 / 编辑</button>`);
      actions.push(`<button class="small" data-slang-confirm="${esc(e.id)}">确认</button>`);
      actions.push(`<details class="compact-actions"><summary>更多</summary><div class="compact-actions-menu"><button class="small" data-slang-reject="${esc(e.id)}">拒绝</button><button class="small danger" data-slang-del="${esc(e.id)}">删除</button></div></details>`);
    } else if (status === 'confirmed') {
      actions.push(`<button class="small" data-slang-edit="${esc(e.id)}">编辑</button>`);
      actions.push(`<button class="small danger" data-slang-del="${esc(e.id)}">删除</button>`);
    } else {
      actions.push(`<button class="small" data-slang-restore="${esc(e.id)}">恢复候选</button>`);
      actions.push(`<button class="small danger" data-slang-del="${esc(e.id)}">删除</button>`);
    }
    html += `<tr>
      <td><input type="checkbox" data-slang-select="${esc(e.id)}"${checked}></td>
      <td><b>${esc(e.content)}</b><br><span class="${slangStatusClass(status)}">${slangStatusLabel(status)}</span></td>
      <td>${esc(e.count)}</td>
      <td>${esc(slangSourceLabel(e))}<br>${sourceKeysMarkup(e)}</td>
      <td>${meaning}${e.usage ? '<br><span class="meta">用法：' + esc(e.usage) + '</span>' : ''}${e.example ? '<br><span class="meta">例：' + esc(e.example) + '</span>' : ''}${e.risk ? '<br><span class="meta">' + (String(e.risk).startsWith('研究未确定：') ? '研究备注：' + esc(String(e.risk).slice(6)) : '风险：' + esc(e.risk)) + '</span>' : ''}</td>
      <td>${slangSourcesHtml(e) || '<span class="meta">—</span>'}</td>
      <td>${slangEvidenceHtml(e)}</td>
      <td class="row">${actions.join('')}</td>
    </tr>`;
  }
  box.innerHTML = html + '</table>';
  box.querySelectorAll('[data-slang-select]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.slangSelect;
    if (cb.checked) slangSelected.add(id); else slangSelected.delete(id);
    updateSlangSelectAll(status);
  }));
  box.querySelectorAll('[data-slang-confirm]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangConfirm, 'confirm')));
  box.querySelectorAll('[data-slang-edit]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangEdit, 'edit')));
  box.querySelectorAll('[data-slang-reject]').forEach((btn) => btn.addEventListener('click', async () => {
    const r2 = await api('/api/slang/' + btn.dataset.slangReject + '/reject', 'POST', {});
    if (!r2.ok) alert(r2.error || '拒绝失败');
    setSlangMsg(r2.ok ? '✅ 已拒绝' : ('❌ ' + (r2.error || '失败')), r2.ok);
    refreshSlang();
  }));
  box.querySelectorAll('[data-slang-restore]').forEach((btn) => btn.addEventListener('click', async () => {
    const e = slangEntriesCache.find((x) => x.id === btn.dataset.slangRestore);
    if (!e) return;
    const r2 = await api('/api/slang/' + e.id, 'PATCH', { status: 'candidate' });
    if (!r2.ok) alert(r2.error || '恢复失败');
    setSlangMsg(r2.ok ? '✅ 已恢复为候选' : ('❌ ' + (r2.error || '失败')), r2.ok);
    refreshSlang();
  }));
  box.querySelectorAll('[data-slang-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('确定删除该黑话？')) return;
    const r2 = await api('/api/slang/' + btn.dataset.slangDel, 'DELETE', {});
    if (!r2.ok) alert(r2.error || '删除失败');
    setSlangMsg(r2.ok ? '✅ 已删除' : ('❌ ' + (r2.error || '失败')), r2.ok);
    slangSelected.delete(btn.dataset.slangDel);
    refreshSlang();
  }));
  updateSlangSelectAll(status);
}

async function refreshSlang() {
  try {
    const r = await api('/api/slang');
    setSlangEntriesCache(r.entries || []);
    renderSlangPanel();
  } catch (e) {
    const box = document.getElementById('slangCandidateList');
    if (box) box.innerHTML = '<span class="meta">加载失败</span>';
  }
}

function openSlangModal(id, mode) {
  const e = slangEntriesCache.find((x) => x.id === id);
  if (!e) return;
  setSlangModalId(id);
  setSlangModalMode(mode);
  document.getElementById('slangModalTitle').textContent = mode === 'confirm' ? `确认黑话：${e.content}` : `编辑黑话：${e.content}`;
  document.getElementById('slangModalContent').textContent = mode === 'confirm'
    ? '你可以直接填写含义/用法并转正，也可以先送 DSH 深度联网研究，研究结果回来后在此处删改再确认。'
    : '修改后保存；候选不会转正，已确认仍保持已确认。';
  document.getElementById('slangSourceKeys').value=sourceKeysText(e);
  document.getElementById('slangModalMeaning').value = e.meaning || '';
  document.getElementById('slangModalUsage').value = e.usage || '';
  document.getElementById('slangModalExample').value = e.example || '';
  document.getElementById('slangModalRisk').value = e.risk || '';
  document.getElementById('slangModalSources').value = Array.isArray(e.sources) ? e.sources.join('\n') : '';
  document.getElementById('slangModalDirectConfirm').textContent = mode === 'confirm' ? '直接确认（转正）' : '保存修改';
  document.getElementById('slangModalSendResearch').style.display = mode === 'confirm' && e.status === 'candidate' ? '' : 'none';
  document.getElementById('slangModalOverlay').classList.add('open');
}

function closeSlangModal() {
  document.getElementById('slangModalOverlay').classList.remove('open');
  setSlangModalId(null);
}

function readSlangModalPayload() {
  return {
    sourceKeys:readSourceKeys('slangSourceKeys'),
    meaning: document.getElementById('slangModalMeaning').value.trim(),
    usage: document.getElementById('slangModalUsage').value.trim(),
    example: document.getElementById('slangModalExample').value.trim(),
    risk: document.getElementById('slangModalRisk').value.trim(),
    sources: document.getElementById('slangModalSources').value.split(/\n/).map((s) => s.trim()).filter(Boolean)
  };
}

async function researchSlangIds(ids,button){
  if(!ids.length){setSlangMsg('请先勾选要研究的候选词',false);return;}
  button.disabled=true;let researched=0,uncertain=0,missing=0,requested=0;
  try{
    for(let i=0;i<ids.length;i+=5){
      setSlangMsg('正在研究第 '+(Math.floor(i/5)+1)+' / '+Math.ceil(ids.length/5)+' 批；本批完成后会写回词库',true);
      const result=await learningCall('slang_research_batch',{ids:ids.slice(i,i+5)});
      researched+=result.researched||0;uncertain+=result.uncertain||0;missing+=result.missing||0;requested+=result.requested||0;
      await refreshSlang();
    }
    setSlangMsg('研究已写回：'+researched+' 条得到解释，'+uncertain+' 条仍不确定，'+missing+' 条未返回；请审核候选。',true);
  }catch(error){await refreshSlang();setSlangMsg('已处理 '+requested+' / '+ids.length+' 条；研究中断：'+error.message,false);}
  finally{button.disabled=false;}
}

function loadSlangConfig() {
  api('/api/slang').then(r => {
    const c = r.config || {};
    document.getElementById('slangEnabled').checked = c.enabled !== false;
    document.getElementById('slangExtractMin').value = c.extractMinMessages ?? 10;
    document.getElementById('slangCooldown').value = c.extractCooldownMs ?? 300000;
    document.getElementById('slangThresholds').value = (c.inferenceThresholds || [2, 4, 8]).join(', ');
    document.getElementById('slangInjectMax').value = c.injectMax ?? 8;
    document.getElementById('slangLearnerPreset').value = c.learnerPreset || 'qq-chat';
    document.getElementById('slangWorkspaceTitle').value = c.workspaceTitle || 'QQ 黑话学习';
    document.getElementById('slangAutoResearch').checked = c.autoResearch !== false;
  }).catch(() => {});
}













export function initialize() {
document.querySelectorAll('#section-slang .slang-tab').forEach((btn) => btn.addEventListener('click', () => setSlangTab(btn.dataset.slangTab)));
document.getElementById('slangSearchCand').addEventListener('input', renderSlangPanel);
document.getElementById('slangSearchConfirmed').addEventListener('input', renderSlangPanel);
document.getElementById('slangSearchRejected').addEventListener('input', renderSlangPanel);
document.getElementById('slangLimitCand').addEventListener('change', renderSlangPanel);
document.getElementById('slangLimitConfirmed').addEventListener('change', renderSlangPanel);
document.getElementById('slangLimitRejected').addEventListener('change', renderSlangPanel);
document.getElementById('slangCandidateSelectAll').addEventListener('change', (e) => {
  const list = slangEntriesCache.filter((x) => x.status === 'candidate');
  const q = getSlangSearch();
  const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
  for (const x of filtered) { if (e.target.checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
  renderSlangPanel();
});
document.getElementById('slangConfirmedSelectAll').addEventListener('change', (e) => {
  const list = slangEntriesCache.filter((x) => x.status === 'confirmed');
  const q = getSlangSearch();
  const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
  for (const x of filtered) { if (e.target.checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
  renderSlangPanel();
});
document.getElementById('slangRejectedSelectAll').addEventListener('change', (e) => {
  const list = slangEntriesCache.filter((x) => x.status === 'rejected');
  const q = getSlangSearch();
  const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
  for (const x of filtered) { if (e.target.checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
  renderSlangPanel();
});
document.getElementById('slangBatchResearch').addEventListener('click', async event => {
  const ids = selectedIdsForStatus('candidate');
  await researchSlangIds(ids,event.currentTarget);
});
document.getElementById('slangBatchConfirm').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('candidate');
  if (!ids.length) { alert('请先勾选要确认的候选词'); return; }
  if (!confirm(`确定批量确认 ${ids.length} 条候选？缺少含义的会被跳过。`)) return;
  const r = await api('/api/slang/batch-confirm', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已确认 ${r.confirmedCount} 条，跳过 ${r.skippedCount} 条` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchReject').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('candidate');
  if (!ids.length) { alert('请先勾选要拒绝的候选词'); return; }
  if (!confirm(`确定拒绝 ${ids.length} 条候选？`)) return;
  const r = await api('/api/slang/batch-reject', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已拒绝 ${r.rejectedCount} 条` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchDeleteCand').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('candidate');
  if (!ids.length) { alert('请先勾选要删除的候选词'); return; }
  if (!confirm(`确定删除 ${ids.length} 条候选？此操作不可恢复！`)) return;
  const r = await api('/api/slang/batch-delete', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条候选` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchDeleteConfirmed').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('confirmed');
  if (!ids.length) { alert('请先勾选要删除的已确认词条'); return; }
  if (!confirm(`确定删除 ${ids.length} 条已确认黑话？此操作不可恢复！`)) return;
  const r = await api('/api/slang/batch-delete', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条已确认` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchDeleteRejected').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('rejected');
  if (!ids.length) { alert('请先勾选要删除的已拒绝词条'); return; }
  if (!confirm(`确定删除 ${ids.length} 条已拒绝词条？此操作不可恢复！`)) return;
  const r = await api('/api/slang/batch-delete', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条已拒绝` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchRestore').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('rejected');
  if (!ids.length) { alert('请先勾选要恢复的已拒绝词条'); return; }
  let okCount = 0;
  for (const id of ids) {
    const r = await api('/api/slang/' + id, 'PATCH', { status: 'candidate' });
    if (r.ok) okCount++;
  }
  setSlangMsg(`✅ 已恢复 ${okCount}/${ids.length} 条为候选`);
  if (okCount) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangModalDirectConfirm').addEventListener('click', async () => {
  if (!slangModalId) return;
  let payload;try{await requireLearningScopes();payload=readSlangModalPayload();}catch(error){setSlangMsg(error.message,false);return;}
  if (!payload.meaning) { alert('请先填写含义，确认后才会注入 AI 上下文'); return; }
  const e = slangEntriesCache.find((x) => x.id === slangModalId);
  if (!e) return;
  const path = slangModalMode === 'confirm' ? `/api/slang/${e.id}/confirm` : `/api/slang/${e.id}`;
  const r2 = await api(path, slangModalMode === 'confirm' ? 'POST' : 'PATCH', payload);
  if (!r2.ok) alert(r2.error || '保存失败');
  setSlangMsg(r2.ok ? (slangModalMode === 'confirm' ? '✅ 已确认转正' : '✅ 已保存') : ('❌ ' + (r2.error || '失败')), r2.ok);
  closeSlangModal();
  refreshSlang();
});
document.getElementById('slangModalSendResearch').addEventListener('click', async event => {
  if (!slangModalId) return;
  await researchSlangIds([slangModalId],event.currentTarget);
  closeSlangModal();
});
document.getElementById('slangModalCancel').addEventListener('click', closeSlangModal);
document.getElementById('slangModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'slangModalOverlay') closeSlangModal(); });
document.getElementById('slangAdd').addEventListener('click', async () => {
  const content = document.getElementById('slangContent').value.trim();
  const meaning = document.getElementById('slangMeaning').value.trim();
  const usage = document.getElementById('slangUsage').value.trim();
  const example = document.getElementById('slangExample').value.trim();
  if (!content) { alert('词条不能为空'); return; }
  let scope;try{await requireLearningScopes();scope=readSourceKeys('slangManualSourceKeys');}catch(error){setSlangMsg(error.message,false);return;}
  const r = await api('/api/slang', 'POST', { content, meaning, usage, example,sourceKeys:scope });
  document.getElementById('slangMsg').textContent = r.ok ? '✅ 已添加' : ('❌ ' + (r.error || '失败'));
  document.getElementById('slangMsg').className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) {
    document.getElementById('slangContent').value = '';
    document.getElementById('slangMeaning').value = '';
    document.getElementById('slangUsage').value = '';
    document.getElementById('slangExample').value = '';
    refreshSlang();
  }
});
document.getElementById('slangExtract').addEventListener('click', async () => {
  const r = await api('/api/slang/extract', 'POST', {});
  setSlangMsg(r.ok ? '✅ 已触发提取' : ('❌ ' + (r.error || '失败')), r.ok);
});
document.getElementById('slangResearch').addEventListener('click', async event => {
  await researchSlangIds(slangEntriesCache.filter(e=>e.status==='candidate').map(e=>e.id),event.currentTarget);
});
document.getElementById('slangConfigSave').addEventListener('click', async () => {
  try{await requireLearningScopes();}catch(error){setSlangMsg(error.message,false);return;}
  const r = await api('/api/slang/config', 'POST', {
    enabled: document.getElementById('slangEnabled').checked,
    extractMinMessages: Number(document.getElementById('slangExtractMin').value) || 10,
    extractCooldownMs: Number(document.getElementById('slangCooldown').value) || 300000,
    inferenceThresholds: document.getElementById('slangThresholds').value.split(/[,，\s]+/).map(Number).filter(Boolean),
    injectMax: Number(document.getElementById('slangInjectMax').value),
    learnerPreset: document.getElementById('slangLearnerPreset').value.trim(),
    workspaceTitle: document.getElementById('slangWorkspaceTitle').value.trim(),
    autoResearch: document.getElementById('slangAutoResearch').checked
  });
  const msg = document.getElementById('slangConfigMsg');
  msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) loadSlangConfig();
});





}
export { slangStatusLabel, slangStatusClass, slangSourceLabel, slangEvidenceHtml, slangSourcesHtml, slangSearchFields, getSlangLimit, getSlangSearch, selectedIdsForStatus, setSlangMsg, setSlangTab, updateSlangSelectAll, renderSlangPanel, refreshSlang, openSlangModal, closeSlangModal, readSlangModalPayload, researchSlangIds, loadSlangConfig };
