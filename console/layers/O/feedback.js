
import { api } from '../../shared/api.js';
import { refresh } from './status.js';
// layers/O/feedback: explicit imports; initialize is called in the application startup order.


async function loadV2FeedbackState() {
  const loadButton = document.getElementById('v2FeedbackLoad');
  const msg = document.getElementById('v2FeedbackMsg');
  if (loadButton) loadButton.disabled = true;
  if (msg) { msg.textContent = '正在加载…'; msg.className = 'meta'; }
  try {
  const [r, q] = await Promise.all([api('/api/socialV2/feedback'), api('/api/socialV2/self-review-feedback')]);
  const entries = r.entries || [];
  const counts = q.counts || {};
  const summary = document.getElementById('v2FeedbackStatusSummary');
  if (summary) summary.textContent = `历史记录-${q.historyCount ?? r.historyCount ?? entries.length}　·　待修复 ${counts.pending || 0}（用户反馈 ${counts.userPending || 0} · Bot自我发现/工具 ${counts.selfPending || 0} · 管理员反馈 ${counts.adminPending || 0}）　·　困难问题 ${counts.difficulty || 0}　·　已修复 ${counts.completed || 0}　·　已删除 ${counts.deleted || 0}　·　今日新增 ${counts.todayTotal || 0}`;
  const host = document.getElementById('v2FeedbackQueueOutput');
  const historyHost = document.getElementById('v2FeedbackHistoryOutput');
  const escText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const queueName = { user: '待修复 · 用户反馈 · 2 小时 / 每轮最多 3 条', self: '待修复 · Bot自我发现/工具 · 6 小时 / 每轮最多 3 条', admin: '待修复 · 管理员反馈 · 即时' };
  const itemCard = item => {
    const kind = item.kind || ({user:'用户反馈',self:'自我发现/工具反馈',admin:'管理员即时反馈'}[item.origin] || '反馈');
    const source = item.source || item.reporter || '未知来源';
    const description = item.text || item.message || item.description || item.issue || item.detail || '（原记录未包含描述）';
    const result = item.result ? `<div class="feedback-result"><span class="feedback-result-label">处理记录</span><p>${escText(item.result)}</p></div>` : '';
    const processing = !!(item.processingTaskId || item.processingClaimId);
    const processingLabel = item.researchStatus === 'waiting_input' ? 'DSH 研究等待输入' : item.researchStatus === 'starting' ? 'DSH 研究启动中' : 'DSH 研究处理中';
    return `<article class="feedback-item"><div class="feedback-item-main">${processing?`<span class="feedback-processing">${processingLabel}</span>`:''}<div class="feedback-description">${escText(description)}${processing?' —处理中':''}</div><small class="feedback-item-meta"><span>编号 ${escText(item.id)}</span><span>类别 ${escText(kind)}</span><span>来源 ${escText(source)}</span><span>${escText(item.createdAt || '')}</span><span>失败尝试 ${Number(item.attempts)||0}</span>${item.processingTaskId?`<span>DSH 任务 ${escText(item.processingTaskId)}</span>`:''}</small>${result}</div><div class="feedback-actions"><button class="small" data-feedback-action="research" data-id="${escText(item.id)}" ${processing?'disabled':''}>${processing?'DSH 研究中':'转移到 DSH 研究'}</button><button class="small" data-feedback-action="difficulty" data-id="${escText(item.id)}" ${processing?'disabled':''}>移入困难问题</button><button class="small" data-feedback-action="resolve" data-id="${escText(item.id)}" ${processing?'disabled':''}>已修复</button><button class="small danger" data-feedback-action="delete" data-id="${escText(item.id)}" ${processing?'disabled':''}>删除</button></div></article>`;
  };
  const queues = q.queues || {};
  const metrics = document.getElementById('v2FeedbackQueueMetrics');
  if (metrics) metrics.innerHTML = `<div class="feedback-metric"><span>用户反馈</span><b>${(queues.user||[]).length}</b><small>每 2 小时 · 每轮最多 3 条</small></div><div class="feedback-metric"><span>自我发现 / 工具</span><b>${(queues.self||[]).length}</b><small>每 6 小时 · 每轮最多 3 条</small></div><div class="feedback-metric"><span>管理员即时</span><b>${(queues.admin||[]).length}</b><small>收到后即时处理</small></div><div class="feedback-metric is-difficult"><span>困难问题</span><b>${(q.difficulties||[]).length}</b><small>三次未解决或手动移入</small></div>`;
  const section = (key, items) => `<section class="feedback-queue"><h4><strong class="feedback-status feedback-status-pending">${queueName[key]}</strong><span>${items.length}</span></h4>${items.length ? items.map(itemCard).join('') : '<div class="feedback-empty">当前队列为空</div>'}</section>`;
  const hard = (q.difficulties || []).map(item => { const result=item.result?`<div class="feedback-result"><span class="feedback-result-label">处理记录</span><p>${escText(item.result)}</p></div>`:''; return `<article class="feedback-item"><div class="feedback-item-main"><div class="feedback-description">${escText(item.text || item.message || item.description || item.issue || item.detail || '（原记录未包含描述）')}</div><small class="feedback-item-meta"><span>编号 ${escText(item.id)}</span><span>类别 ${escText(item.kind || item.origin || '反馈')}</span><span>来源 ${escText(item.source || item.reporter || '未知来源')}</span><span>${escText(item.createdAt || '')}</span><span>累计尝试 ${Number(item.attempts)||0}</span></small>${result}</div><div class="feedback-actions"><label class="feedback-transfer-label" for="restore-${escText(item.id)}">移回哪个队列</label><select id="restore-${escText(item.id)}" aria-label="移回目标队列" data-restore-select="${escText(item.id)}"><option value="user" ${item.queue==='user'?'selected':''}>用户反馈队列</option><option value="self" ${item.queue==='self'?'selected':''}>自我发现/工具队列</option><option value="admin" ${item.queue==='admin'?'selected':''}>管理员反馈队列</option></select><button class="small" data-feedback-action="restore" data-id="${escText(item.id)}">移回队列末尾</button><button class="small" data-feedback-action="resolve" data-id="${escText(item.id)}">已修复</button><button class="small danger" data-feedback-action="delete" data-id="${escText(item.id)}">删除</button></div></article>`; }).join('');
  const historyStatus = item => (item.status === '待修复' ? `待修复 · ${{user:'用户反馈',self:'Bot自我发现/工具',admin:'管理员反馈'}[item.queue] || item.kind || '其他来源'}` : (item.status || '待修复')) + (item.processingTaskId || item.processingClaimId ? ' · DSH研究处理中' : '');
  const historyStateClass = status => ({'待修复':'pending','困难问题':'difficulty','已修复':'completed','已删除':'deleted'}[status] || 'pending');
  const history = entries.slice().sort((a,b)=>Date.parse(b.createdAt||b.time||0)-Date.parse(a.createdAt||a.time||0)).slice(0,100).map(item=>`<div class="feedback-history-row"><b class="feedback-status feedback-status-${historyStateClass(item.status)}">${escText(historyStatus(item))}</b><span>${escText(item.createdAt || item.time || '')}</span><p>${escText(item.text || item.message || item.description || item.issue || item.detail || '（原记录未包含描述）')}</p></div>`).join('');
  historyHost.innerHTML = `<div class="feedback-history-list"><div class="meta">最近显示 ${Math.min(entries.length,100)} 条 / 历史共 ${q.historyCount ?? entries.length} 条</div>${history || '<div class="feedback-empty">暂无历史反馈</div>'}</div>`;
  host.innerHTML = `<div class="feedback-manager"><p class="meta">状态共四种：待修复、困难问题、已修复、已删除。待修复按用户反馈、Bot自我发现/工具、管理员反馈分队列；删除后仍保留在历史中，连续三次未解决自动转入困难问题。</p>${section('user',queues.user||[])}${section('self',queues.self||[])}${section('admin',queues.admin||[])}<section class="feedback-queue"><h4><strong class="feedback-status feedback-status-difficulty">困难问题列表</strong><span>${(q.difficulties||[]).length}</span></h4>${hard || '<div class="feedback-empty">暂无困难问题</div>'}</section></div>`;
  host.querySelectorAll('[data-feedback-action]').forEach(button => button.addEventListener('click', async () => {
    const action=button.dataset.feedbackAction, id=button.dataset.id;
    if (action === 'research') {
      button.disabled = true; button.textContent = '正在启动 DSH 研究…';
      try {
        const result = await api('/api/socialV2/self-review-feedback/research', 'POST', { id });
        if (!result.ok) alert(result.error || '启动 DSH 研究失败');
        else { await loadV2FeedbackState(); const feedbackMsg=document.getElementById('v2FeedbackMsg'); if(feedbackMsg)feedbackMsg.textContent=`已启动 DSH 研究任务 ${result.taskId}；任务状态会回写到此卡片。`; }
      } catch (error) { alert(error?.message || '启动 DSH 研究失败'); button.disabled=false; button.textContent='转移到 DSH 研究'; }
      return;
    }
    if (action === 'delete' && !confirm('确定删除这条反馈？删除后会移出待修复队列、保留在历史记录中，并计入“已删除”。')) return;
    let detail=''; if(action==='restore') detail=host.querySelector(`[data-restore-select="${CSS.escape(id)}"]`)?.value || 'user';
    if(action==='resolve') detail=prompt('可补充已修复依据；留空将记录为人工确认。') || '管理员在 Console 手动确认已修复';
    const result=await api('/api/socialV2/self-review-feedback/action','POST',{id,action,detail});
    if(!result.ok) alert(result.error || '操作失败'); else {
      await loadV2FeedbackState();
      const feedbackMsg = document.getElementById('v2FeedbackMsg');
      if (feedbackMsg) feedbackMsg.textContent = action === 'delete' ? '已删除：记录保留在历史中，已删除计数已更新。' : action === 'difficulty' ? '已移入困难问题。' : action === 'resolve' ? '已标记为已修复。' : '已移回所选队列末尾。';
    }
  }));
  if (msg) { msg.textContent = '已更新'; msg.className = 'meta'; }
  } catch (e) {
    const errorText = `加载失败：${e && e.message ? e.message : e || '请求失败'}`;
    const metrics = document.getElementById('v2FeedbackQueueMetrics');
    const queue = document.getElementById('v2FeedbackQueueOutput');
    const history = document.getElementById('v2FeedbackHistoryOutput');
    if (metrics) metrics.innerHTML = `<span class="feedback-empty">${String(errorText).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span>`;
    if (queue) queue.textContent = errorText;
    if (history) history.textContent = errorText;
    if (msg) { msg.textContent = `❌ ${errorText}`; msg.className = 'meta err'; }
  } finally {
    if (loadButton) loadButton.disabled = false;
  }
}

export function initialize() {
document.getElementById('v2FeedbackLoad').addEventListener('click', loadV2FeedbackState);
loadV2FeedbackState();
}
export { loadV2FeedbackState };
