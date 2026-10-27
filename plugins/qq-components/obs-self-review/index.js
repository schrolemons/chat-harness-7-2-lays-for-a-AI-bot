// 自我更新周期性自查；管理员问题即时修复，其他用户问题排队定向修复。

const REVIEW_RULES = [
  '1. 管理端先用 mcp__bridge-health__bridge_health 或 node scripts/bridge-health.mjs --json；ready 就停止连接修复。受限QQ会话若无诊断工具，报告无法核实，不修接口或提权。401/403、未知、旧日志、旧端口和事件流空闲不是当前掉线证据。之后才按需查日志和历史结论。',
  '2. 根据近期会话和自我更新总结找问题，区分确认的问题与猜测；优先处理已被证据支持、影响明显的问题。',
  '3. 只修功能/代码/配置；能改配置就不改代码。',
  '4. 改代码前先备份，改完 node --check；改动要小、可回滚；插件优先热加载。确需重启桥接时，先向管理员说明影响并等待同意。',
  '5. 记忆文件（state/memory/*.md、日记、持久化记忆）不归这里改。'
].join('\n');

const clean = (value, max = 700) => String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
const makeId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const getState = () => {
    const state = ctx.state.get() || {};
    state.feedbackQueue = Array.isArray(state.feedbackQueue) ? state.feedbackQueue : [];
    state.feedbackDone = Array.isArray(state.feedbackDone) ? state.feedbackDone : [];
    state.selfFindings = Array.isArray(state.selfFindings) ? state.selfFindings : [];
    state.selfDone = Array.isArray(state.selfDone) ? state.selfDone : [];
    state.adminFeedback = Array.isArray(state.adminFeedback) ? state.adminFeedback : [];
    state.toolFeedbackStatuses = state.toolFeedbackStatuses && typeof state.toolFeedbackStatuses === 'object' ? state.toolFeedbackStatuses : {};
    return state;
  };
  const persist = (state) => ctx.state.set({ feedbackQueue: state.feedbackQueue.slice(-300), feedbackDone: state.feedbackDone.slice(-300), selfFindings: state.selfFindings.slice(-300), selfDone: state.selfDone.slice(-300), adminFeedback: state.adminFeedback.slice(-100), toolFeedbackStatuses: state.toolFeedbackStatuses });
  const syncToolFeedback = (entries = ctx.capabilities.getFeedbackReports?.() || []) => {
    const state = getState();
    let changed = false;
    const reports = (Array.isArray(entries) ? entries : []).map((item) => {
      const id = String(item?.id || '');
      if (!id) return null;
      if (!state.toolFeedbackStatuses[id]) { state.toolFeedbackStatuses[id] = { status: '待修复', result: '', updatedAt: '' }; changed = true; }
      return { id, reporter: 'qq_report_feedback', source: String(item.key || ''), text: clean(item.message, 700), createdAt: String(item.time || ''), level: String(item.level || 'info'), kind: '自我发现', ...state.toolFeedbackStatuses[id] };
    }).filter(Boolean);
    if (changed) persist(state);
    return reports;
  };
  const feedbackBatch = () => {
    const state = getState();
    return state.feedbackQueue.filter((item) => item.status === '待修复').slice(0, Math.max(1, Math.min(20, Number(ctx.capabilities.getSelfReviewConfig?.()?.maxFeedbackFixesPerRound) || 3)));
  };
  const selfBatch = () => {
    const state = getState();
    const reports = syncToolFeedback().filter((item) => item.status === '待修复');
    const findings = state.selfFindings.filter((item) => item.status === '待修复');
    const cap = ctx.capabilities.getSelfReviewConfig?.() || {};
    return [...findings, ...reports].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(0, Math.max(1, Math.min(20, Number(cap.maxSelfFixesPerRound) || Number(cfg.maxFixesPerRound) || 3)));
  };
  return {
    services: {
      selfReviewFeedback: {
      listFeedback() {
        const state = getState();
        const reports = syncToolFeedback();
        const userPending = state.feedbackQueue.filter((x) => x.status === '待修复');
        const selfPending = [...state.selfFindings.filter((x) => x.status === '待修复'), ...reports.filter((x) => x.status === '待修复')];
        const adminPending = state.adminFeedback.filter((x) => ['处理中', '待处理'].includes(x.status));
        const pending = [...userPending, ...selfPending, ...adminPending].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
        const completed = [...state.feedbackDone.filter((x) => x.status === '已修复'), ...state.selfDone.filter((x) => x.status === '已修复'), ...reports.filter((x) => x.status === '已修复'), ...state.adminFeedback.filter((x) => x.status === '已修复')].slice(-100).reverse();
        const allTodayCandidates = [...state.feedbackQueue, ...state.feedbackDone, ...state.selfFindings, ...state.selfDone, ...reports, ...state.adminFeedback];
        const today = new Date().toLocaleDateString('zh-CN');
        const todayTotal = allTodayCandidates.filter((x) => x.createdAt && new Date(x.createdAt).toLocaleDateString('zh-CN') === today).length;
        const completedTotal = state.feedbackDone.filter((x) => x.status === '已修复').length + state.selfDone.filter((x) => x.status === '已修复').length + reports.filter((x) => x.status === '已修复').length + state.adminFeedback.filter((x) => x.status === '已修复').length;
        return { entries: pending, pending, completed, admin: state.adminFeedback.slice(-30).reverse(), counts: { pending: pending.length, userPending: userPending.length, selfPending: selfPending.length, adminPending: adminPending.length, completed: completedTotal, adminTotal: state.adminFeedback.length, todayTotal } };
      },
      decorateToolFeedback({ entries = [] } = {}) {
        const byId = new Map(syncToolFeedback(entries).map((item) => [item.id, item]));
        return (Array.isArray(entries) ? entries : []).map((item) => ({ ...item, ...(byId.get(String(item?.id || '')) || {}) }));
      },
      completeFeedbackBatch({ text = '' } = {}) {
        const raw = String(text);
        const match = raw.match(/<USER_FEEDBACK_RESULTS>([\s\S]*?)<\/USER_FEEDBACK_RESULTS>/i);
        if (!match) return { updated: 0, reason: '结果标记缺失，反馈仍保留在待修复队列' };
        let result;
        try { result = JSON.parse(match[1]); } catch { return { updated: 0, reason: '结果格式无效，反馈仍保留在待修复队列' }; }
        syncToolFeedback();
        const state = getState();
        const allowed = new Set(feedbackBatch().map((x) => x.id));
        const updates = Array.isArray(result.items) ? result.items : [];
        let updated = 0;
        for (const item of updates) {
          const id = String(item?.id || '');
          if (!allowed.has(id)) continue;
          const status = item.status === '已修复' ? '已修复' : item.status === '待修复' ? '待修复' : '';
          if (!status) continue;
          const index = state.feedbackQueue.findIndex((x) => x.id === id && x.status === '待修复');
          if (index < 0 && state.toolFeedbackStatuses[id]) {
            state.toolFeedbackStatuses[id] = { status, result: clean(item.summary, 500), updatedAt: new Date().toISOString() };
            updated++;
            continue;
          }
          if (index < 0) continue;
          const [entry] = state.feedbackQueue.splice(index, 1);
          entry.status = status;
          entry.result = clean(item.summary, 500);
          entry.updatedAt = new Date().toISOString();
          (status === '已修复' ? state.feedbackDone : state.feedbackQueue).push(entry);
          updated++;
        }
        persist(state);
        return { updated, reason: updated ? '已保存反馈处理状态' : '没有可确认的处理结果，未标记为已修复' };
      },
      completeSelfFeedbackBatch({ text = '' } = {}) {
        const match = String(text).match(/<SELF_REVIEW_RESULTS>([\s\S]*?)<\/SELF_REVIEW_RESULTS>/i);
        if (!match) return { updated: 0, reason: '自我发现结果标记缺失，条目仍保持待处理' };
        let result;
        try { result = JSON.parse(match[1]); } catch { return { updated: 0, reason: '自我发现结果格式无效' }; }
        syncToolFeedback();
        const state = getState();
        const allowed = new Set(selfBatch().map((x) => x.id));
        const selfMax = Math.max(1, Number(ctx.capabilities.getSelfReviewConfig?.()?.maxSelfFixesPerRound) || Number(cfg.maxFixesPerRound) || 3);
        let updated = 0;
        let fixedCount = 0;
        for (const item of (Array.isArray(result.items) ? result.items : [])) {
          const id = String(item?.id || ''), askedStatus = item?.status === '已修复' ? '已修复' : item?.status === '待修复' ? '待修复' : '';
          const status = askedStatus === '已修复' && fixedCount >= selfMax ? '待修复' : askedStatus;
          if (!allowed.has(id) || !status) continue;
          if (status === '已修复') fixedCount++;
          const index = state.selfFindings.findIndex((x) => x.id === id && x.status === '待修复');
          if (index >= 0) {
            const [entry] = state.selfFindings.splice(index, 1);
            entry.status = status; entry.result = clean(item.summary, 500); entry.updatedAt = new Date().toISOString();
            (status === '已修复' ? state.selfDone : state.selfFindings).push(entry); updated++; continue;
          }
          if (state.toolFeedbackStatuses[id]) {
            state.toolFeedbackStatuses[id] = { status, result: clean(item.summary, 500), updatedAt: new Date().toISOString() };
            updated++;
          }
        }
        for (const item of (Array.isArray(result.newFindings) ? result.newFindings : []).slice(0, 20)) {
          const title = clean(item?.title || item?.text, 500);
          const askedStatus = item?.status === '已修复' ? '已修复' : item?.status === '待修复' ? '待修复' : '';
          const status = askedStatus === '已修复' && fixedCount >= selfMax ? '待修复' : askedStatus;
          if (!title || !status) continue;
          if (status === '已修复') fixedCount++;
          const entry = { id: makeId(), reporter: 'bot-self-review', source: '自我更新', text: title, kind: '自我发现', status, result: clean(item.summary, 500), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          (status === '已修复' ? state.selfDone : state.selfFindings).push(entry); updated++;
        }
        persist(state);
        return { updated, reason: updated ? '自我发现与修复状态已更新' : '本轮没有可记录的自我发现结果' };
      },
      completeAdminFeedback({ id = '', text = '' } = {}) {
        const state = getState();
        const entry = state.adminFeedback.find((x) => x.id === String(id));
        if (!entry) return { updated: false };
        const output = clean(text, 3000);
        entry.status = /已修复|修复完成|已完成修复/i.test(output) && !/未修复|无法修复|未能完成/i.test(output) ? '已修复' : '待处理';
        entry.result = output;
        entry.updatedAt = new Date().toISOString();
        persist(state);
        return { updated: true, status: entry.status };
      }
      }
    },
    hooks: {
      onIncoming(payload = {}) {
        const text = clean(payload.text);
        if (!/(?:^\s*(?:反馈|问题反馈|故障反馈|报错)|我.{0,5}(?:反馈|报错|报告问题)|(?:反馈|报错)一下|反馈这个问题|请.{0,10}(?:修复|改进|处理)|帮(?:我|忙).{0,8}(?:修复|改进|处理)|修复这个问题|这个问题.{0,6}(?:修复|改进))/i.test(text)) return;
        const owner = String(ctx.capabilities.getOwnerQQ?.() || '');
        const reporter = String(payload.userId || payload.sender || '');
        const isOwner = owner && reporter === owner;
        const settings = ctx.capabilities.getSelfReviewConfig?.() || {};
        if (settings.enabled === false || settings.autoOptimize === false) return;
        const guarded = ctx.capabilities.sanitizeFeedbackReport?.(text) || { action: 'accept', text };
        if (guarded.action === 'reject' || !String(guarded.text || '').trim()) return;
        const issue = clean(guarded.text);
        const state = getState();
        const fingerprint = issue.toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
        const now = Date.now();
        if (isOwner) {
          if (!String(payload.key || '').startsWith('private:')) {
            ctx.log('管理员反馈需要在私聊中发送，未启动即时修复');
            return;
          }
          const recentDuplicate = state.adminFeedback.some((x) => x.fingerprint === fingerprint && now - Date.parse(x.createdAt) < 10 * 60 * 1000);
          if (recentDuplicate) return;
          const entry = { id: makeId(), reporter, source: String(payload.key || ''), text: issue, kind: '管理员即时反馈', fingerprint, status: '处理中', createdAt: new Date(now).toISOString() };
          state.adminFeedback.push(entry);
          persist(state);
          const prompt = ['【管理员即时反馈修复】', '以下是管理员刚刚明确提出的问题，请立即查证并在当前回合直接修复；这条反馈不进入普通用户待修复队列。', `反馈编号：${entry.id}`, `反馈原文：${issue}`, REVIEW_RULES, '只有实际完成修改才能向管理员报告“已修复”；需要权限或重启时先明确列出待办和影响，不要虚报完成。'].join('\n');
          if (!ctx.capabilities.requestAdminFeedbackRepair?.({ id: entry.id, text: prompt, reporter })) {
            const latest = getState();
            const saved = latest.adminFeedback.find((x) => x.id === entry.id);
            if (saved) { saved.status = '待处理'; persist(latest); }
          }
          return;
        }
        const recentDuplicate = state.feedbackQueue.some((x) => x.fingerprint === fingerprint && now - Date.parse(x.createdAt) < 24 * 60 * 60 * 1000)
          || state.feedbackDone.some((x) => x.fingerprint === fingerprint && now - Date.parse(x.createdAt) < 24 * 60 * 60 * 1000);
        if (recentDuplicate) return;
        state.feedbackQueue.push({ id: makeId(), reporter, source: String(payload.key || ''), text: issue, kind: '用户反馈', fingerprint, status: '待修复', createdAt: new Date(now).toISOString() });
        persist(state);
        ctx.log('普通用户反馈已进入定向修复队列');
      },
      beforePrompt(payload = {}) {
        const reason = String(payload.reason || '');
        if (reason === 'selfReview') {
          const batch = feedbackBatch();
          const selfItems = selfBatch();
          const feedback = batch.length ? [
            '【用户反馈定向修复队列】仅用户来源，使用独立用户反馈限额；本轮最多处理以下条目，未修好的继续保留为待修复。',
            JSON.stringify(batch.map(({ id, reporter, source, text }) => ({ id, reporter, source, text }))),
            '完成后必须在最终回复末尾输出机器可读结果：<USER_FEEDBACK_RESULTS>{"items":[{"id":"原编号","status":"已修复或待修复","summary":"结果简述"}]}</USER_FEEDBACK_RESULTS>。仅实际改好并保存才标已修复；缺少证据、被权限/重启阻塞或没处理的都标待修复。'
          ].join('\n') : '当前没有待处理的普通用户反馈。';
          const cap = ctx.capabilities.getSelfReviewConfig?.() || {};
          const selfMax = Math.max(1, Number(cap.maxSelfFixesPerRound) || Number(cfg.maxFixesPerRound) || 3);
          const selfFeedback = selfItems.length ? [
            '【Bot自我更新/发现】包括 qq_report_feedback 工具报告和之前排队的自我发现，使用独立自我更新限额。',
            JSON.stringify(selfItems.map(({ id, source, text }) => ({ id, source, text }))),
            '处理后输出：<SELF_REVIEW_RESULTS>{"items":[{"id":"旧编号","status":"已修复或待修复","summary":"证据或改动"}],"newFindings":[{"title":"本轮发现","status":"已修复或待修复","summary":"证据或改动"}]}</SELF_REVIEW_RESULTS>。仅实际修好的条目标已修复，其余保留待修复。'
          ].join('\n') : `【Bot自我更新/发现】本轮自我发现修复上限为 ${selfMax} 项。完成后输出 <SELF_REVIEW_RESULTS>{"items":[],"newFindings":[{"title":"证据支持的新发现","status":"已修复或待修复","summary":"证据或改动"}]}</SELF_REVIEW_RESULTS>；没有新发现时 newFindings 为空数组。`;
          return ['【自我更新｜分析并主动改进】', '定期分析近期收集的问题、对话质量和运行证据；所有问题进入统一反馈参数和统计，但用户反馈与Bot自我发现分别计数、分别受每轮限额控制。', REVIEW_RULES, `Bot自我发现每轮最多修 ${selfMax} 项；用户反馈每轮最多处理 ${Math.max(1, Number(cap.maxFeedbackFixesPerRound) || 3)} 项。`, feedback, selfFeedback, '完成后把分析结论和实际改动追加到 state/memory/_optimization.md；未修复条目保留在反馈参数中。'].join('\n');
        }
        return '';
      }
    }
  };
}
