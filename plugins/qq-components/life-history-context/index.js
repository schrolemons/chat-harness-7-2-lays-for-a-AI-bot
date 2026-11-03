const valid = value => Number.isSafeInteger(value) && value > 0;
const bounded = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.floor(Number(value)))) : fallback;
export function createPlugin(ctx) {
  const privateReplyLimit = bounded(ctx.config?.privateReplyLimit, 5);
  const historyLimit = bounded(ctx.config?.historyLimit, 40);
  const runtime = ctx.runtime || {}, synced = runtime.synced || (runtime.synced = new Map());
  const wakeHeads = runtime.wakeHeads || (runtime.wakeHeads = new Map());
  const boundaries = runtime.recoveryBoundaries || (runtime.recoveryBoundaries = new Map());
  const policyKey = JSON.stringify([privateReplyLimit,historyLimit,ctx.config?.localHistoryEnabled !== false]);
  if (runtime.policyKey !== policyKey) { synced.clear(); runtime.policyKey = policyKey; }
  const rowsOf = state => [...new Map([...(state.recentMessages||[]),...(state.unread||[])].filter(m=>!m.isSelf&&valid(m.seq)).map(m=>[m.seq,m])).values()].sort((a,b)=>a.seq-b.seq);
  const pending = m => !m.repliedAt&&!m.resolvedAt&&m.replyDisposition!=='history'&&!['pending','rejected'].includes(m.quotaAdmission);
  const asHistory = (state,seq,reason,now) => {
    for(const list of [state.unread,state.recentMessages])for(const row of list||[])if(row.seq===seq&&!row.repliedAt){row.replyDisposition='history';row.replyDispositionReason=reason;row.replyDispositionAt=now;}
  };
  function refreshWindow({key,state,triggerSeq=state?.lastUnreadSeq,windowCount=state?.doubleStampCheck?.windowCount||8,now=Date.now()}={}) {
    if(!state||state.replyWindowOpen!==true)return null;
    const count=Math.max(1,Math.min(100,Math.floor(Number(windowCount)||8)));
    const candidates=rowsOf(state).filter(m=>m.seq>=state.wakeTriggerSeq&&m.replyRequirement==='required'&&pending(m));
    // The first input stands alone until another arrival starts the recheck.
    const started=Number(triggerSeq)>state.wakeTriggerSeq||state.replyWindowStarted===true;
    state.replyWindowStarted=started;
    const window=started?candidates.slice(-count):[];
    if(started&&String(key).startsWith('group:'))for(const m of candidates.slice(0,-count))asHistory(state,m.seq,'outside_required_receipt_window',now);
    const receipts=window.map(m=>({seq:m.seq,state:m.seenAt?'seen':'unseen'}));
    state.doubleStampCheck={...(state.doubleStampCheck||{}),enabled:true,windowCount:count,checkedAt:now,triggerSeq,windowSeqs:window.map(m=>m.seq),receipts,pendingCount:window.length,wakeTriggerSeq:state.wakeTriggerSeq,anomalies:state.doubleStampCheck?.anomalies||[]};
    return state.doubleStampCheck;
  }
  return { hooks: { beforePrompt() {
    return '【历史与待答资格】双戳只记录实际已读与真实发送，待答资格另行判断。只有双戳窗口内 replyRequirement=required 且 needsReply=true 的消息必须按收件 seq 从小到大回应；相关连续片段可合并，并可结合紧挨其后的普通补充一并回复；一次发送须明确绑定全部所答seq，不得跳过更早的必答消息去答更晚的必答消息。群聊以首条实际触发唤醒的消息作为本次输入，后来的消息不替换它；初始回查窗为空，后续只由必答消息占位置，普通自由消息不计数。自主概率增长、定时冒泡与日常唤醒可自行决定是否回应历史。私聊新来信默认全部必答；窗口内普通消息、replyDisposition=history 的上文、未压缩的近期历史都可自由选择是否回复，不形成逐条补答义务；久远内容按需参考摘要。群聊已读但决定不参与的普通消息可报 context 并说明原因，不写回复戳；不能用 context 跳过窗口内的必答消息。私聊最多保留最近 '+privateReplyLimit+' 条旧未处理消息可答。所有聊天历史只能从 bridge 或 SnowLuma 本地缓存获得；缓存缺失即如实说明，不调用 QQ 历史、漫游或远程消息详情 API。';
  } }, services: { historyContext: {
    policy() { return { privateReplyLimit, historyLimit, localHistoryEnabled: ctx.config?.localHistoryEnabled !== false }; },
    refreshWindow,
    retain({state,limit}={}) {
      if(!state)return null;
      const count=Math.max(1,Math.floor(Number(limit)||40)),rows=state.unread||[];
      const required=rows.filter(m=>m.replyRequirement==='required'&&pending(m)).slice(-count),kept=new Set(required.map(m=>m.seq));
      const space=count-required.length,other=space?rows.filter(m=>!kept.has(m.seq)).slice(-space):[];
      return [...required,...(required.length<count?other:[])].sort((a,b)=>a.seq-b.seq);
    },
    beginWake({key,state,triggerSeq,now=Date.now()}={}) {
      if(!state)return null;
      const rows=rowsOf(state);
      if(state.replyWindowOpen===true)return {triggerMessage:rows.find(m=>m.seq===state.wakeTriggerSeq)||wakeHeads.get(key),wakeTriggerSeq:state.wakeTriggerSeq};
      const first=rows.find(m=>m.seq===triggerSeq)||rows.at(-1);if(!first)return null;
      if(String(key).startsWith('group:'))for(const row of rows)if(row.seq<first.seq&&!row.repliedAt)asHistory(state,row.seq,'before_current_wake',now);
      wakeHeads.set(key,first);
      state.replyWindowStartSeq=first.seq;state.wakeTriggerSeq=first.seq;state.replyWindowOpen=true;state.replyWindowStarted=false;
      refreshWindow({key,state,triggerSeq:first.seq,now});
      return {triggerMessage:first,wakeTriggerSeq:first.seq};
    },
    snapshotGuidance() { return '【消息处理】收件索引不替代正文。仅窗口内明确 required 的待答消息须按收件 seq 升序处理；普通消息和未压缩历史可自由参与。缺少所选回复来源的完整正文时，从本地缓存补读。未回复不冒充已完成，普通群消息可报 context 回执保留为上文。'; },
    classifyIncoming({key,state,message,wakeAccepted,requiresResponse=false,windowSeqs}={}) {
      if(!message||message.isSelf||message.repliedAt)return {changed:false};
      const group=String(key).startsWith('group:');
      const required=!group||wakeAccepted===true&&requiresResponse===true;
      message.replyRequirement=required?'required':'optional';
      if(!required){message.replyDisposition='history';message.replyDispositionReason=wakeAccepted===false?'group_not_participating':'ordinary_optional_context';message.replyDispositionAt=Date.now();}
      if(state)refreshWindow({key,state,triggerSeq:message.seq});
      return {changed:true,required};
    },
    async sync({ key, excludeMessageId } = {}) {
      if (ctx.config?.localHistoryEnabled === false || !historyLimit || typeof ctx.capabilities?.readLocalConversationHistory !== 'function') return { ok: true, skipped: true };
      if (synced.has(key)) return synced.get(key);
      const pending = (async () => {
        const history = await ctx.capabilities.readLocalConversationHistory({ key, limit: historyLimit });
        if (!history?.ok) return { ok: false, reason: history?.reason || 'cache_unavailable' };
        return await ctx.capabilities.importLocalConversationHistory?.({ key, messages: history.messages, excludeMessageId, privateReplyLimit }) || { ok: false, reason: 'import_unavailable' };
      })().catch(() => ({ ok: false, reason: 'cache_unavailable' }));
      synced.set(key, pending);
      return pending;
    },
    recover({ key, state, throughSeq = state?.lastUnreadSeq, now = Date.now(), resetBoundary=false } = {}) {
      if (!state || !/^(private|group):[1-9]\d*$/.test(String(key))) return { ok: false };
      if(resetBoundary){
        state.replyWindowOpen=false;state.replyWindowStarted=false;wakeHeads.delete(key);
        state.doubleStampCheck={...(state.doubleStampCheck||{}),windowSeqs:[],receipts:[],pendingCount:0};
      }
      // Freeze the startup boundary across delayed imports and plugin reloads.
      // Live arrivals never consume the recovered-private window.
      if (resetBoundary || !boundaries.has(key)) boundaries.set(key, Number(throughSeq) || 0);
      const eligible = m => valid(m?.seq) && (m.seq <= boundaries.get(key) || m.historySource === 'snowluma-local');
      const candidates = (state.unread || []).filter(m => eligible(m) && !m.isSelf
        && !m.repliedAt && !m.resolvedAt && m.replyDisposition !== 'history');
      const kept = new Set(String(key).startsWith('private:') ? candidates.slice().sort((a,b) => b.seq-a.seq).slice(0, privateReplyLimit).map(m => m.seq) : []);
      let changed = 0;
      for (const list of [state.unread, state.recentMessages]) for (const m of list || []) {
        if (!eligible(m) || m.isSelf || m.repliedAt || m.resolvedAt) continue;
        if(kept.has(m.seq)){m.replyRequirement='required';continue;}
        if (m.replyDisposition !== 'history') changed++;
        m.replyDisposition = 'history';
        m.replyDispositionReason = String(key).startsWith('group:') ? 'recovered_group_context' : 'outside_private_recovery_window';
        m.replyDispositionAt ||= now;
      }
      return { ok: true, changed, privateReplyLimit, historyLimit, pendingSeqs: [...kept].sort((a,b) => a-b) };
    },
  } } };
}
