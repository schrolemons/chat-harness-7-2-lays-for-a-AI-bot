const valid = value => Number.isSafeInteger(value) && value > 0;
const backlogURL=new URL('./wake-backlog.mjs',import.meta.url);backlogURL.search=new URL(import.meta.url).search;
const {pruneObservedWakeBacklog}=await import(backlogURL.href);
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
  return { hooks: { beforePrompt(payload={}) {
    pruneObservedWakeBacklog(payload.st);
    return '【群聊上下文】结合最新来信、相邻群聊和引用判断话题与对象；完整正文已在历史或快照中就直接参考，contextPartial=true时仅按需补读所答内容，不机械补齐整窗。历史可自由选答；旧助手独白不是群友的新话题。'+'\n\n'+'【历史与待答资格】仅入栈tag标为required且仍在双戳窗口内的待答消息按收件seq升序回应，相关连续片段可合并并明确绑定所答seq。普通新消息与历史均选答，不按未读数补答；群聊首条实际触发输入不被后续普通消息替换。context仅用于未选答的普通消息，不能跳过必答或写假回复戳。私聊旧未处理消息最多保留 '+privateReplyLimit+' 条；新来信的必答资格以tag为准。所有原话只从bridge或SnowLuma本地缓存读取，缺失如实说明，不调用QQ历史、漫游或远程消息详情API。';
  } }, services: { historyContext: {
    policy() { return { privateReplyLimit, historyLimit, localHistoryEnabled: ctx.config?.localHistoryEnabled !== false }; },
    replyContext({key,state,throughSeq=Infinity,limit=20}={}) {
      if(!String(key).startsWith('group:'))return [];
      const anchor=(state?.recentMessages||[]).find(m=>m.seq===throughSeq),count=Math.max(1,Math.min(1000,Number(limit)||20));
      return (state?.recentMessages||[]).filter(m=>m.isSelf?(!anchor||m.time<=anchor.time):valid(m.seq)&&m.seq<=throughSeq).slice(-count).filter(m=>!m.isSelf);
    },
    snapshotLimit({key,previewLimit,contextWindow}={}) {return String(key).startsWith('group:')?Math.max(previewLimit,contextWindow):previewLimit;},
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
    snapshotGuidance() { return '【消息处理】收件索引不替代正文。仅窗口内明确 required 的待答消息须按收件 seq 升序处理；普通消息和历史仅作上文，不形成补答队列。缺少所选回复来源的完整正文时，从本地缓存补读。未回复不冒充已完成，普通群消息可报 context 回执保留为上文。'; },
    classifyIncoming({key,state,message,wakeAccepted,requiresResponse=false,windowSeqs}={}) {
      if(!message||message.isSelf||message.repliedAt)return {changed:false};
      const group=String(key).startsWith('group:');
      const required=!group||wakeAccepted===true&&requiresResponse===true;
      message.replyRequirement=required?'required':'optional';
      if(!required){
        // Reply optionality is independent of timely delivery of fresh ingress
        // from wait/getUnread. Retire it to history only after model selection.
        message.replyDisposition=wakeAccepted===true?'optional':'history';
        message.replyDispositionReason=wakeAccepted===true?'ordinary_optional_incoming':'group_not_participating';message.replyDispositionAt=Date.now();
      }
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
