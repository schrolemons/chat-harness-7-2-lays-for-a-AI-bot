// 自我更新、自我发现与三类反馈的统一处理队列。
const REVIEW_RULES = [
  '1. 先核验证据；问题复核时已无法再现，可记为已由人工或其他工具修复，并说明“复核未再现”。',
  '2. 只修功能/代码/配置；能改配置就不改代码。',
  '3. 改代码前备份，改完 node --check；插件优先热加载。需要重启时先向管理员说明影响并等待同意。',
  '4. 记忆文件、日记和持久化记忆不归此回合直接改。'
].join('\n');
const clean = (v, max = 700) => String(v || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
const makeId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const parseMarkedJson = (text, marker) => {
  const normalized = String(text || '').replace(/[＜＞]/g, c => c === '＜' ? '<' : '>').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
  const m = new RegExp(`<${marker}\\s*>([\\s\\S]*?)<\\/${marker}\\s*>`, 'i').exec(normalized);
  if (!m) return null;
  try { return JSON.parse(m[1].trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()); } catch { return null; }
};
const pending = x => x?.status === '待修复';

export function createPlugin(ctx) {
  const getState = () => {
    const s = ctx.state.get() || {};
    for (const k of ['feedbackQueue','feedbackDone','selfFindings','selfDone','adminFeedback']) if (!Array.isArray(s[k])) s[k] = [];
    if (!Array.isArray(s.issueLedger)) s.issueLedger = [];
    if (!Array.isArray(s.hiddenQueueIds)) s.hiddenQueueIds = [];
    if (!Array.isArray(s.difficultyIds)) s.difficultyIds = [];
    if (!Array.isArray(s.queueEvents)) s.queueEvents = [];
    if (!s.toolFeedbackStatuses || typeof s.toolFeedbackStatuses !== 'object') s.toolFeedbackStatuses = {};
    // 一次性迁移旧数组为统一账本；只保留历史状态，不推断已修复。
    if (!s.issueLedgerMigrated) {
      const add = (x, queue, origin) => { if (!x?.id || s.issueLedger.some(y => y.id === String(x.id))) return; s.issueLedger.push({ ...x, id: String(x.id), queue, origin, queuePositionAt: String(x.queuePositionAt || x.createdAt || ''), attempts: Number(x.attempts) || 0, status: x.status === '已修复' ? '已修复' : '待修复' }); };
      s.feedbackQueue.forEach(x => add(x, 'user', 'user')); s.feedbackDone.forEach(x => add(x, 'user', 'user'));
      s.selfFindings.forEach(x => add(x, 'self', 'self')); s.selfDone.forEach(x => add(x, 'self', 'self'));
      s.adminFeedback.forEach(x => add(x, 'admin', 'admin'));
      s.issueLedgerMigrated = true;
    }
    if (Number(s.issueSchemaVersion) < 2) {
      const deletedIds=new Set(s.hiddenQueueIds.map(String)), difficultIds=new Set(s.difficultyIds.map(String));
      for(const item of s.issueLedger){
        if(deletedIds.has(String(item.id))) item.status='已删除';
        else if(difficultIds.has(String(item.id))) item.status='困难问题';
        else if(!['已修复','已删除','困难问题','待修复'].includes(item.status)) item.status='待修复';
        item.queuePositionAt=String(item.queuePositionAt||item.createdAt||item.updatedAt||new Date().toISOString());
      }
      s.issueSchemaVersion=2;
    }
    // The prior delete handler only hid rows, leaving their ledger status as pending.
    // Reconcile those already-deleted rows into the explicit deleted state and event.
    const hiddenIds=new Set(s.hiddenQueueIds.map(String));
    for (const item of s.issueLedger) {
      if (!hiddenIds.has(String(item.id)) || ['已删除','已修复','困难问题'].includes(item.status)) continue;
      item.status='已删除';
      const deletionEvent=[...s.queueEvents].reverse().find(event=>String(event.id)===String(item.id)&&event.action==='hidden');
      item.deletedAt=item.deletedAt||deletionEvent?.at||item.updatedAt||new Date().toISOString();
      item.updatedAt=item.deletedAt;
      if (deletionEvent) {
        deletionEvent.action='deleted';
        deletionEvent.detail=deletionEvent.detail||'此前删除操作已归入已删除状态';
      } else record(s,'deleted',item,'此前删除操作已归入已删除状态');
    }
    return s;
  };
  const persist = s => ctx.state.set({ ...s, issueLedger: s.issueLedger, hiddenQueueIds: s.hiddenQueueIds, difficultyIds: s.difficultyIds, queueEvents: s.queueEvents.slice(-5000), issueLedgerMigrated: true, issueSchemaVersion: 2 });
  const allEntries = (s, reports = ctx.capabilities.getFeedbackReports?.() || []) => {
    const known = new Map(s.issueLedger.map(x => [String(x.id), x]));
    for (const r of (Array.isArray(reports) ? reports : [])) {
      const id = String(r?.id || ''); if (!id) continue;
      const existing = known.get(id);
      if (existing) {
        // Older/imported ledger entries may lack the body even though the feedback ledger has it.
        if (!clean(existing.text) && !clean(existing.message)) existing.text = clean(r.message || r.text || r.description || r.issue || r.detail, 700);
        if (!existing.createdAt) existing.createdAt = String(r.time || r.createdAt || '');
        continue;
      }
      const old = s.toolFeedbackStatuses[id] || {};
      const oldStatus=['已修复','已删除','困难问题'].includes(old.status)?old.status:'待修复';
      const item={ id, reporter: 'qq_report_feedback', source: String(r.key || ''), text: clean(r.message, 700), createdAt: String(r.time || ''), queuePositionAt: String(r.time || ''), level: String(r.level || 'info'), kind: 'Bot自我发现/工具反馈', origin: 'tool', queue: 'self', status: oldStatus, result: old.result || '', updatedAt: old.updatedAt || '', attempts: Number(old.attempts) || 0 };
      s.issueLedger.push(item); record(s,'submitted',item,'qq_report_feedback');
      known.set(id,item);
    }
    return s.issueLedger;
  };
  const visible = (s, queue) => allEntries(s).filter(x => x.queue === queue && pending(x) && !s.hiddenQueueIds.includes(x.id) && !s.difficultyIds.includes(x.id)).sort((a,b) => Date.parse(a.queuePositionAt || a.createdAt || 0) - Date.parse(b.queuePositionAt || b.createdAt || 0));
  const record = (s, action, item, detail = '', flags = {}) => { const event={ at: new Date().toISOString(), action, id: item?.id || '', queue: item?.queue || '', origin:item?.origin||'', ...(flags.discovery === true ? { discovery: true } : {}), detail: clean(detail, 500) }; s.queueEvents.push(event); return event; };
  const transition = (s, id, action, detail = '') => {
    const item = allEntries(s).find(x => x.id === String(id)); if (!item) return { ok:false, error:'未找到该条目' };
    if(item.processingTaskId||item.processingClaimId)return {ok:false,error:'该反馈正在由 DSH 研究处理，请等待任务结束后再操作'};
    if (action === 'difficulty') {
      if (!pending(item)) return { ok:false, error:'已修复条目不能移入困难问题' };
      item.status='困难问题';
      if (!s.difficultyIds.includes(item.id)) s.difficultyIds.push(item.id);
      s.hiddenQueueIds = s.hiddenQueueIds.filter(x => x !== item.id);
      record(s,'difficulty',item,'管理员手动移入困难问题');
    } else if (action === 'restore') {
      if (!['user','self','admin'].includes(detail) || item.status!=='困难问题') return { ok:false, error:'只能将困难问题移回指定队列末尾' };
      item.queue = detail;
      item.status='待修复';
      item.queuePositionAt = new Date().toISOString();
      item.updatedAt = item.queuePositionAt;
      s.hiddenQueueIds = s.hiddenQueueIds.filter(x => x !== item.id);
      s.difficultyIds = s.difficultyIds.filter(x => x !== item.id);
      record(s,'transfer',item,'从困难问题移回' + ({user:'用户反馈',self:'自我发现/工具',admin:'管理员'}[detail] || detail) + '队列末尾');
    } else if (action === 'resolve') {
      item.status = '已修复'; item.result = clean(detail || '管理员在 Console 手动确认已修复',500); item.completedAt = new Date().toISOString(); item.updatedAt = item.completedAt;
      s.hiddenQueueIds = s.hiddenQueueIds.filter(x => x !== item.id); s.difficultyIds = s.difficultyIds.filter(x => x !== item.id); record(s,'resolved',item,item.result);
    } else if (action === 'delete') {
      item.status='已删除'; item.deletedAt=new Date().toISOString(); item.updatedAt=item.deletedAt;
      if (!s.hiddenQueueIds.includes(item.id)) s.hiddenQueueIds.push(item.id);
      s.difficultyIds=s.difficultyIds.filter(x=>x!==item.id);
      record(s,'deleted',item,'管理员在 Console 删除；保留于历史记录');
    } else return { ok:false, error:`操作无效（action: ${clean(action,80)||'空'}）` };
    const event=s.queueEvents.at(-1); persist(s); return { ok:true, item, event };
  };
  const batch = queue => {
    const caps=ctx.capabilities.getSelfReviewConfig?.()||{};
    const n=queue==='user'?caps.maxFeedbackFixesPerRound:caps.maxSelfFixesPerRound;
    return visible(getState(),queue).slice(0,Math.max(1,Math.min(20,Number(n)||3)));
  };
  const complete = (queue, text, marker, { taskId = '', taskTitle = 'Bot主动修复' } = {}) => {
    const repairRecord = (item, summary, conclusion) => {
      const detail=clean(summary,250)||'未提供处理摘要';
      if(!taskId)return detail;
      return clean(`处理任务：${clean(taskTitle,60)}（${clean(taskId,80)}）；问题编号：${item.id}；修复关键与验证：${detail}；结论：${conclusion}`,500);
    };
    const parsed = parseMarkedJson(text, marker);
    if (!parsed) {
      const s=getState(), eventStart=s.queueEvents.length, items=batch(queue), now=new Date().toISOString();
      for(const item of items){item.attempts=(Number(item.attempts)||0)+1;item.updatedAt=now;item.queuePositionAt=now;const difficult=item.attempts>=3&&!s.difficultyIds.includes(item.id);if(difficult){item.status='困难问题';s.difficultyIds.push(item.id);s.hiddenQueueIds=s.hiddenQueueIds.filter(id=>id!==item.id);}const detail=repairRecord(item,'处理标记缺失或格式无效',difficult?'连续三次仍未解决，转入困难问题':'未取得有效修复结论，保留待修复');item.result=detail;record(s,difficult?'difficulty':'retry',item,detail);}
      const events=s.queueEvents.slice(eventStart); persist(s); return { updated:items.length, events, reason:'处理标记缺失或格式无效；条目保留并累计一次未解决尝试' };
    }
    const s = getState(), eventStart=s.queueEvents.length, ids = new Set(batch(queue).map(x => x.id)), reported = new Set(); let updated = 0;
    for (const r of Array.isArray(parsed.items) ? parsed.items : []) {
      const id = String(r?.id || ''), item = s.issueLedger.find(x => x.id === id);
      if (!ids.has(id) || !item || reported.has(id)) continue; reported.add(id);
      const summary = clean(r.summary,320), now = new Date().toISOString();
      if (r.status === '已修复' && summary) { const detail=repairRecord(item,summary,'已修复'); item.status='已修复'; item.result=detail; item.completedAt=now; item.updatedAt=now; s.hiddenQueueIds=s.hiddenQueueIds.filter(x=>x!==id); s.difficultyIds=s.difficultyIds.filter(x=>x!==id); record(s,'resolved',item,detail); }
      else { item.attempts=(Number(item.attempts)||0)+1; item.updatedAt=now; item.queuePositionAt=now; const difficult=item.attempts>=3&&!s.difficultyIds.includes(id); if (difficult) { item.status='困难问题'; s.difficultyIds.push(id); s.hiddenQueueIds=s.hiddenQueueIds.filter(x=>x!==id); } const detail=repairRecord(item,summary,difficult?'连续三次仍未解决，转入困难问题':'待处理：未完成或未能确认修复'); item.result=detail; record(s,difficult?'difficulty':'retry',item,detail); }
      updated++;
    }
    // 本轮未回报的条目也视为一次未解决尝试，防止模型漏项造成无限期悬挂。
    for (const id of ids) if (!reported.has(id)) { const item=s.issueLedger.find(x=>x.id===id); if (!item) continue; item.attempts=(Number(item.attempts)||0)+1; item.updatedAt=new Date().toISOString(); item.queuePositionAt=item.updatedAt; const difficult=item.attempts>=3&&!s.difficultyIds.includes(id); if(difficult){item.status='困难问题';s.difficultyIds.push(id);s.hiddenQueueIds=s.hiddenQueueIds.filter(x=>x!==id);}const detail=repairRecord(item,'本轮没有返回该编号的处理结果',difficult?'连续三次仍未解决，转入困难问题':'待处理：本轮未回报');item.result=detail;record(s,difficult?'difficulty':'retry',item,detail);updated++; }
    const selfCap=Math.max(1,Number(ctx.capabilities.getSelfReviewConfig?.()?.maxSelfFixesPerRound)||3);
    if (queue === 'self') for (const finding of (Array.isArray(parsed.newFindings) ? parsed.newFindings : []).slice(0, Math.max(0,Math.min(3,selfCap-updated)))) {
      const title=clean(finding?.title||finding?.text,500); if(!title)continue;
      const now=new Date().toISOString(), status=finding.status==='已修复'&&clean(finding.summary,300)?'已修复':'待修复';
      const id=makeId(), item={id,reporter:'bot-self-review',source:'自我更新',text:title,kind:'自我发现',origin:'self',queue:'self',queuePositionAt:now,status,result:repairRecord({id},finding.summary||'扫描发现的问题',status==='已修复'?'已修复':'已登记待处理'),attempts:0,createdAt:now,updatedAt:now};
      if(status==='已修复')item.completedAt=now; s.issueLedger.push(item); record(s,status==='已修复'?'resolved':'submitted',item,item.result,{discovery:true}); updated++;
    }
    const events=s.queueEvents.slice(eventStart); persist(s); return { updated, events, reason:updated?'已记录本轮处理结果':'本轮没有匹配条目' };
  };
  return { services: { selfReviewFeedback: {
    beginResearch({id='',claimId=''}={}) {
      const s=getState(), item=allEntries(s).find(x=>x.id===String(id)), claim=String(claimId||'');
      if(!item)return {ok:false,error:'未找到该反馈'};
      if(!claim)return {ok:false,error:'缺少研究占用编号'};
      if(!pending(item)||s.hiddenQueueIds.includes(item.id)||s.difficultyIds.includes(item.id))return {ok:false,error:'只有待修复队列中的条目可以转交研究'};
      if(item.processingTaskId||item.processingClaimId)return {ok:false,error:'该反馈已有一个 DSH 研究任务'};
      const now=new Date().toISOString();
      item.processingClaimId=claim;item.processingStartedAt=now;item.researchStatus='starting';
      const event=record(s,'research_started',item,'转交 DSH Agents 研究');persist(s);
      return {ok:true,item,event};
    },
    attachResearchTask({id='',claimId='',taskId=''}={}) {
      const s=getState(), item=s.issueLedger.find(x=>x.id===String(id));
      if(!item||item.status!=='待修复'||item.processingClaimId!==String(claimId||'')||!taskId)return {ok:false,error:'反馈研究占用已失效，不能绑定任务'};
      item.processingTaskId=String(taskId);item.researchStatus='running';item.updatedAt=new Date().toISOString();persist(s);
      return {ok:true,item};
    },
    updateResearchTask({id='',taskId='',status='running'}={}) {
      const s=getState(), item=s.issueLedger.find(x=>x.id===String(id));
      if(!item||item.status!=='待修复'||item.processingTaskId!==String(taskId||''))return {ok:false,error:'反馈与 DSH 任务关联不匹配'};
      item.researchStatus=status==='waiting_input'?'waiting_input':'running';item.updatedAt=new Date().toISOString();persist(s);
      return {ok:true,item};
    },
    finishResearch({id='',claimId='',taskId='',outcome='failed',summary=''}={}) {
      const s=getState(), item=s.issueLedger.find(x=>x.id===String(id));
      if(!item)return {ok:false,error:'未找到该反馈'};
      const task=String(taskId||''), claim=String(claimId||'');
      const isBound=task?item.processingTaskId===task:!!claim&&item.processingClaimId===claim;
      if(!isBound){
        if(['已修复','困难问题','已删除'].includes(item.status)||(!item.processingTaskId&&!item.processingClaimId))return {ok:true,duplicate:true,item,events:[]};
        return {ok:false,error:'反馈与 DSH 任务关联不匹配'};
      }
      const now=new Date().toISOString(), result=clean(summary,500);
      item.processingTaskId='';item.processingClaimId='';item.processingStartedAt='';item.researchStatus='';
      if(outcome==='resolved'&&result){
        item.status='已修复';item.result=result;item.completedAt=now;item.updatedAt=now;
        s.hiddenQueueIds=s.hiddenQueueIds.filter(x=>x!==item.id);s.difficultyIds=s.difficultyIds.filter(x=>x!==item.id);
        const event=record(s,'resolved',item,result);persist(s);return {ok:true,item,event,events:[event]};
      }
      item.status='待修复';item.attempts=(Number(item.attempts)||0)+1;item.result=result||'DSH 研究任务未能确认修复';item.updatedAt=now;item.queuePositionAt=now;
      const events=[record(s,'retry',item,item.result)];
      if(item.attempts>=3){
        item.status='困难问题';if(!s.difficultyIds.includes(item.id))s.difficultyIds.push(item.id);
        s.hiddenQueueIds=s.hiddenQueueIds.filter(x=>x!==item.id);
        events.push(record(s,'difficulty',item,'连续三次处理后仍未解决：'+item.result));
      }
      persist(s);return {ok:true,item,event:events.at(-1),events};
    },
    listFeedback() {
      const s=getState(), entries=allEntries(s), visibleQueues={ user:visible(s,'user'), self:visible(s,'self'), admin:visible(s,'admin') };
      persist(s);
      const difficulties=entries.filter(x=>x.status==='困难问题');
      const today=new Date().toLocaleDateString('zh-CN'), todayTotal=entries.filter(x=>x.createdAt&&new Date(x.createdAt).toLocaleDateString('zh-CN')===today).length;
      const completed=entries.filter(x=>x.status==='已修复').sort((a,b)=>Date.parse(b.completedAt||b.updatedAt||0)-Date.parse(a.completedAt||a.updatedAt||0));
      const pendingEntries=entries.filter(pending), deleted=entries.filter(x=>x.status==='已删除');
      return { entries, pending:pendingEntries, completed, deleted, queues:visibleQueues, difficulties, historyCount:entries.length, events:s.queueEvents.slice(-300).reverse(), counts:{ pending:pendingEntries.length, userPending:pendingEntries.filter(x=>x.queue==='user').length, selfPending:pendingEntries.filter(x=>x.queue==='self').length, adminPending:pendingEntries.filter(x=>x.queue==='admin').length, completed:completed.length, deleted:deleted.length, todayTotal, difficulty:difficulties.length } };
    },
    decorateToolFeedback({entries=[]}={}) { return Array.isArray(entries)?entries.map(x=>({...x, ...(getState().issueLedger.find(y=>y.id===String(x?.id||''))||{})})):[]; },
    ingestToolFeedback({entry={}}={}) { const s=getState(), id=String(entry.id||''); if(!id)return {ok:false}; allEntries(s,[entry]); const event=s.queueEvents.at(-1); persist(s); return {ok:true,event}; },
    queueAction({id='', action='', queue='', detail=''}={}) { return transition(getState(),id,action,detail||queue); },
    completeFeedbackBatch({text='' }={}) { return complete('user',text,'USER_FEEDBACK_RESULTS'); },
    completeSelfFeedbackBatch({text='',taskId='',taskTitle='Bot自我更新主动修复'}={}) { return complete('self',text,'SELF_REVIEW_RESULTS',{taskId,taskTitle}); },
    completeAdminFeedback({id='',text=''}={}) { const s=getState(), x=s.issueLedger.find(y=>y.id===String(id)); if(!x)return {updated:false}; const j=parseMarkedJson(text,'ADMIN_FEEDBACK_RESULT'); let event; if(j?.status==='已修复'&&clean(j.summary,500)){x.status='已修复';x.result=clean(j.summary,500);x.completedAt=new Date().toISOString();x.updatedAt=x.completedAt;event=record(s,'resolved',x,x.result);}else{x.status='待修复';x.queue='admin';x.attempts=(Number(x.attempts)||0)+1;x.queuePositionAt=new Date().toISOString();if(x.attempts>=3&&!s.difficultyIds.includes(x.id)){x.status='困难问题';s.difficultyIds.push(x.id);event=record(s,'difficulty',x,'连续三次处理后仍未解决');}else event=record(s,'retry',x,clean(j?.summary||text,500));} persist(s); return {updated:true,status:x.status,event}; }
  }}, hooks: {
    onIncoming(payload={}) {
      const text=clean(payload.text); if(!/(?:^\s*(?:反馈|问题反馈|故障反馈|报错)|我.{0,5}(?:反馈|报错|报告问题)|(?:反馈|报错)一下|反馈这个问题|请.{0,10}(?:修复|改进|处理)|帮(?:我|忙).{0,8}(?:修复|改进|处理)|修复这个问题|这个问题.{0,6}(?:修复|改进))/i.test(text))return;
      const owner=String(ctx.capabilities.getOwnerQQ?.()||''), reporter=String(payload.userId||payload.sender||''), isOwner=owner&&reporter===owner, settings=ctx.capabilities.getSelfReviewConfig?.()||{};
      const guarded=ctx.capabilities.sanitizeFeedbackReport?.(text)||{action:'accept',text}; if(guarded.action==='reject'||!String(guarded.text||'').trim())return;
      const issue=clean(guarded.text), s=getState(), fingerprint=issue.toLowerCase().replace(/\s+/g,' ').slice(0,240), now=Date.now();
      if(isOwner&&String(payload.key||'').startsWith('private:')) {
        if(s.issueLedger.some(x=>x.fingerprint===fingerprint&&now-Date.parse(x.createdAt)<600000))return;
        const x={id:makeId(),reporter,source:String(payload.key),text:issue,kind:'管理员即时反馈',origin:'admin',queue:'admin',fingerprint,status:'待修复',attempts:0,createdAt:new Date(now).toISOString()}; s.issueLedger.push(x); const event=record(s,'submitted',x,'管理员即时'); persist(s); ctx.capabilities.recordFeedbackSummary?.(event);
        if(settings.enabled===false||settings.autoOptimize===false){ctx.log('管理员反馈已留存；即时修复开关关闭，暂未启动处理');return;}
        const prompt=['【管理员即时反馈修复】请立即处理以下问题。',JSON.stringify({id:x.id,text:issue}),REVIEW_RULES,'复核时已无法再现也可标已修复，并说明“复核未再现”。输出 <ADMIN_FEEDBACK_RESULT>{"id":"原编号","status":"已修复或待处理","summary":"依据"}</ADMIN_FEEDBACK_RESULT>。'].join('\n');
        if(!ctx.capabilities.requestAdminFeedbackRepair?.({id:x.id,text:prompt,reporter})){x.status='待修复';persist(s);} return;
      }
      if(s.issueLedger.some(x=>x.fingerprint===fingerprint&&now-Date.parse(x.createdAt)<86400000))return;
      const x={id:makeId(),reporter,source:String(payload.key||''),text:issue,kind:'用户反馈',origin:'user',queue:'user',fingerprint,status:'待修复',attempts:0,createdAt:new Date(now).toISOString()}; s.issueLedger.push(x); const event=record(s,'submitted',x,'用户反馈'); persist(s); ctx.capabilities.recordFeedbackSummary?.(event); ctx.log('反馈已写入历史账本及用户处理队列');
    },
    beforePrompt(payload={}) {
      const reason=String(payload.reason||'');
      if(reason==='userFeedbackReview') {
        const user=batch('user'), cap=ctx.capabilities.getSelfReviewConfig?.()||{};
        const section=user.length?`【用户反馈队列】每轮最多处理 ${Number(cap.maxFeedbackFixesPerRound)||3} 条。\n${JSON.stringify(user.map(({id,reporter,source,text})=>({id,reporter,source,text})))}\n每个编号都必须回报；复核时无法再现可按已被人工/其他工具修复处理，并说明“复核未再现”。输出 <USER_FEEDBACK_RESULTS>{"items":[{"id":"原编号","status":"已修复或待修复","summary":"改动或核验证据"}]}</USER_FEEDBACK_RESULTS>。`: '当前用户反馈队列为空。';
        return ['【用户反馈定向修复】只处理以下用户队列条目，不处理自我发现或管理员队列。',REVIEW_RULES,section,'未修复的问题会自动留在队列；第三次仍未解决将移入困难问题列表。'].join('\n');
      }
      if(reason!=='selfReview')return '';
      const s=getState(), user=batch('user'), self=batch('self'), caps=ctx.capabilities.getSelfReviewConfig?.()||{};
      const section=(title,items,tag)=>items.length?`【${title}】\n${JSON.stringify(items.map(({id,reporter,source,text})=>({id,reporter,source,text})))}\n每个输入编号必须回报。summary 必须包含修复关键、验证依据和结论；无法完成或仍有问题填待修复并写明阻塞与当前结论；扫描复核已无法再现时注明“复核未再现”。输出 <${tag}>{"items":[{"id":"原编号","status":"已修复或待修复","summary":"修复关键；验证依据；结论"}]}</${tag}>。`:'';
      const selfText=section('Bot自我发现/qq_report_feedback',self,'SELF_REVIEW_RESULTS');
      const newFindings=`【自我发现】主动修复任务标识：${clean(payload.selfReviewTaskId,80)||'未知'}；每轮最多新增/处理 ${Number(caps.maxSelfFixesPerRound)||3} 项。发现新问题可用 newFindings，summary 同样必须记录修复关键、验证依据和结论，格式：<SELF_REVIEW_RESULTS>{"items":[],"newFindings":[{"title":"问题","status":"待修复","summary":"修复关键；验证依据；结论"}]}</SELF_REVIEW_RESULTS>。`;
      const scan=clean(payload.selfReviewScan,5000);
      return ['【自我更新｜分析并主动改进】','自我发现/工具报告队列每 6 小时最多处理 3 条；用户反馈队列由独立的 2 小时任务处理。',REVIEW_RULES,scan?`【本轮扫描摘要】\n${scan}`:'',selfText,newFindings,'只有本轮确实新发现的问题才写入“自我更新发现的问题”；队列处理情况写入“统一修复摘要”。'].join('\n');
    }
  }};
}
