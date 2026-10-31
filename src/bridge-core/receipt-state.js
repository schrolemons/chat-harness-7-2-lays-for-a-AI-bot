export function stampMsV2(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : 0;
}

export function messageFullyProcessedV2(msg) {
  return !!msg && ['complete','resolved'].includes(receiptStateV2(msg));
}

// Admission is separate from QQ receipt stamps. A message can be stored for the
// console while still being unavailable to a running model round.
export function isModelVisibleMessageV2(msg) {
  return !!msg && !['pending', 'rejected'].includes(msg.quotaAdmission)
    && msg.budgetDisposition !== 'outside-cold-window';
}

export function modelStateViewV2(st, { allowedSeqs } = {}) {
  // Message reads are constrained, but business hooks must still clear pending
  // bubble/task flags on the real state rather than on a disposable copy.
  return new Proxy(st, {
    get(target, field) {
      const value = Reflect.get(target, field);
      if (field === 'unread' || field === 'recentMessages') return (value || []).filter(message =>
        isModelVisibleMessageV2(message) && (!allowedSeqs || allowedSeqs.has(message.seq))
        && (field==='unread'||!stampMsV2(target.modelContextSince)||Number(message.time)>=target.modelContextSince||(target.unread||[]).some(m=>Number.isSafeInteger(m.seq)&&m.seq===message.seq&&!messageFullyProcessedV2(m))));
      return value;
    },
    set(target, field, value) { return Reflect.set(target, field, value); }
  });
}

/** 窗口内还没双戳齐全的消息（按 seq 升序；unread 本身就是入站顺序）。 */
export function pendingMessagesV2(st) {
  return (Array.isArray(st?.unread) ? st.unread : [])
    .filter((m) => isModelVisibleMessageV2(m) && Number.isSafeInteger(m.seq) && m.seq > 0 && !messageFullyProcessedV2(m));
}

/** 重启后/新回合从哪一条开始：窗口内第一个无双戳的消息；没有就 null。 */
export function firstPendingMessageV2(st) {
  const pending = pendingMessagesV2(st);
  return pending.length ? pending[0] : null;
}

// Confirmed delivery only: a resolved quote can bind a message received during
// a running turn before its separate seen callback. Never writes receipt stamps.
export function registerSuccessfulReplyV2(st, {replyToMessageId, at = Date.now()} = {}) {
  const pending = new Set(Array.isArray(st.receiptSendPendingSeqs) ? st.receiptSendPendingSeqs : []);
  const quoted = replyToMessageId == null ? '' : String(replyToMessageId).trim();
  for (const msg of Array.isArray(st.unread) ? st.unread : []) {
    if (!isModelVisibleMessageV2(msg) || msg.isSelf || !Number.isSafeInteger(msg.seq) || msg.seq <= 0 || stampMsV2(msg.repliedAt)) continue;
    if (stampMsV2(msg.seenAt) || (quoted && msg.messageId != null && String(msg.messageId) === quoted)) pending.add(msg.seq);
  }
  st.receiptSendPendingSeqs = [...pending].sort((a,b) => a-b).slice(-200);
  st.receiptSendPendingAt = st.receiptSendPendingSeqs.length ? at : 0;
}

/** 已接收未回复（seenAt 有、repliedAt 没有）的条数——提示词/状态接口共用。 */
export function awaitingReplyCountV2(st) {
  return (Array.isArray(st?.unread) ? st.unread : [])
    .filter((m) => m && stampMsV2(m.seenAt) > 0 && !messageFullyProcessedV2(m)).length;
}

/**
 * 对外返回的未读消息带上双戳与 awaitingReply（只加在响应副本上，不往存储里写计算字段）。
 * awaitingReply=true 表示「已接收未回复」：这条必须被真正处理（回复或 qq_mark_read）。
 */
export function serializeUnreadMessageV2(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  const seenAt = stampMsV2(msg.seenAt);
  const repliedAt = stampMsV2(msg.repliedAt);
  return {
    ...msg,
    ...(seenAt ? { seenAt } : {}),
    ...(repliedAt ? { repliedAt } : {}),
    awaitingReply: seenAt > 0 && !messageFullyProcessedV2(msg)
  };
}

// 双戳只写在窗口内的入站消息上（unread / recent 里同 seq 的副本也同步一份），
// 持久化天然跟着消息缓冲一起裁剪，不需要额外账本文件。
export function stampSeenAtV2(st, seq, at = Date.now()) {
  if (!st || !Number.isSafeInteger(seq) || seq <= 0) return 0;
  if (!(Array.isArray(st.unread) && st.unread.some((m) => m && m.seq === seq))) return 0;
  let changed = 0;
  for (const list of [st.unread, st.recentMessages]) {
    for (const msg of Array.isArray(list) ? list : []) {
      if (!msg || msg.seq !== seq || stampMsV2(msg.seenAt)) continue;
      msg.seenAt = at;
      changed += 1;
    }
  }
  return changed;
}

/**
 * throughSeq 及之前、**已经有 seenAt** 的消息补 repliedAt。
 * 没有 seenAt 的消息一律不动：它们可能是被水位顺手盖掉的漏条，必须留着继续展示。
 * 返回 { stamped, blocked }，blocked = 因缺 seenAt 而拒绝盖章的条数（日志/排查用）。
 */
export function stampRepliedThroughV2(st, throughSeq, at = Date.now()) {
  if (!st || !Number.isSafeInteger(throughSeq) || throughSeq < 0) return { stamped: 0, blocked: 0 };
  let stamped = 0;
  let blocked = 0;
  for (const msg of Array.isArray(st.unread) ? st.unread : []) {
    if (!msg || !Number.isSafeInteger(msg.seq) || msg.seq <= 0 || msg.seq > throughSeq) continue;
    if (stampMsV2(msg.repliedAt)) continue;
    if (!stampMsV2(msg.seenAt)) { blocked += 1; continue; }
    msg.repliedAt = at;
    for (const twin of Array.isArray(st.recentMessages) ? st.recentMessages : []) {
      if (twin && twin !== msg && twin.seq === msg.seq && !stampMsV2(twin.repliedAt)) twin.repliedAt = at;
    }
    stamped += 1;
  }
  return { stamped, blocked };
}

/**
 * 从 unread 摘除双戳齐全的消息，并把水位前推到「连续处理完成」的位置。
 * 关键点：水位只能越过**已经不在缓冲区里**的 seq；一旦撞上仍待处理的消息就停下，
 * 否则正是旧实现「水位把漏条一起盖掉」的病根。
 */
export function advanceReadWatermarkV2(st, limitSeq) {
  const pending = new Set(st.unread.map((m) => m.seq));
  let through = Number.isSafeInteger(st.lastReadThroughSeq) ? st.lastReadThroughSeq : 0;
  while (through < limitSeq && !pending.has(through + 1)) through += 1;
  st.lastReadThroughSeq = Math.max(st.lastReadThroughSeq || 0, through);
  return st.lastReadThroughSeq;
}

export function pruneProcessedMessagesV2(st) {
  if (!st) return 0;
  const before = st.unread.length;
  let maxPruned = 0;
  st.unread = st.unread.filter((msg) => {
    if (messageFullyProcessedV2(msg)) {
      maxPruned = Math.max(maxPruned, msg.seq);
      return false;
    }
    return true;
  });
  if (maxPruned > 0) advanceReadWatermarkV2(st, maxPruned);
  if (st.unread.length !== before) {
    const unread = new Set(st.unread.map((m) => m.seq));
    st.modelSeenSeqs = new Set([...st.modelSeenSeqs || []].filter((seq) => unread.has(seq)));
  }
  return before - st.unread.length;
}

/** 一批消息回复成功后：把这一轮真正看过的消息统一打 repliedAt 并摘除。 */
export function markReplyBatchV2(st, limitSeq) {
  if (!st) return 0;
  const limit = Number.isSafeInteger(limitSeq)
    ? limitSeq
    : (Number.isSafeInteger(st.lastWakeReadThroughSeq) ? st.lastWakeReadThroughSeq : 0);
  if (limit <= 0) return 0;
  const { stamped } = stampRepliedThroughV2(st, limit);
  pruneProcessedMessagesV2(st);
  return stamped;
}


export function receiptStateV2(msg) {
  const seenRaw = msg?.seenAt;
  const repliedRaw = msg?.repliedAt;
  const malformed = (seenRaw != null && seenRaw !== 0 && !stampMsV2(seenRaw))
    || (repliedRaw != null && repliedRaw !== 0 && !stampMsV2(repliedRaw));
  const seen = stampMsV2(seenRaw) > 0;
  const replied = stampMsV2(repliedRaw) > 0;
  if (malformed || (replied && (!seen || stampMsV2(repliedRaw) < stampMsV2(seenRaw)))) return 'anomaly';
  if (seen && replied) return 'complete';
  if (seen && stampMsV2(msg.resolvedAt)>=stampMsV2(seenRaw) && String(msg.resolutionReason||'').trim()) return 'resolved';
  if (seen) return 'seen';
  return 'unseen';
}

// Administrative historical reconciliation, separate from physical delivery.
// Validate the whole batch before changing any row; retain raw message history.
export function resolveReceiptsV2(st,{seqs=[],reason='',at=Date.now(),dryRun=false}={}) {
  if(!Array.isArray(seqs)||seqs.length>100||new Set(seqs).size!==seqs.length||seqs.some(s=>!Number.isSafeInteger(s)||s<=0))return {ok:false,status:400,error:'归档必须指定唯一的消息 seq'};
  if(seqs.length&&String(reason).trim().length<4)return {ok:false,status:400,error:'归档须说明人工核对原因'};
  const rows=seqs.map(seq=>(st.unread||[]).find(m=>m.seq===seq)||(st.recentMessages||[]).find(m=>m.seq===seq));
  if(rows.some(m=>!m||m.isSelf||!['seen','resolved'].includes(receiptStateV2(m))))return {ok:false,status:409,error:'只能归档已查看的历史记录，未读或异常消息必须保留处理'};
  if(!dryRun){for(const seq of seqs)for(const list of [st.unread,st.recentMessages])for(const m of list||[])if(m.seq===seq&&!m.resolvedAt){m.resolvedAt=at;m.resolutionReason=String(reason).trim().slice(0,500);}
    pruneProcessedMessagesV2(st);
    st.receiptSendPendingSeqs=(st.receiptSendPendingSeqs||[]).filter(seq=>!seqs.includes(seq));
  }
  return {ok:true,resolved:seqs};
}
