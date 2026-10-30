const { clamp, moodSnapshot, UNANSWERED_PENALTY, validKey, validScore, validUser } = await import((()=>{const u=new URL('./policy.mjs',import.meta.url);u.search=new URL(import.meta.url).search;return u.href;})());
const { recordHistory, replayHistory } = await import((()=>{const u=new URL('./history.mjs',import.meta.url);u.search=new URL(import.meta.url).search;return u.href;})());
const { recoveryDay, recoverDaily } = await import((()=>{const u=new URL('./daily-recovery.mjs',import.meta.url);u.search=new URL(import.meta.url).search;return u.href;})());

const conversationalReasons = new Set(['proactiveCheck', 'timeBubble', 'startupGreeting', 'privateFollowup']);
const normalReplyReasons = new Set(['message', 'reply']);
const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const stableId = value => (typeof value === 'string' || typeof value === 'number') && String(value).trim().length > 0;
const pair = (key, id) => JSON.stringify([key, String(id)]);

function loadLedger(raw) {
  return { version: 1, conversations: {}, waits: {}, deliveries: {}, incoming: {}, ...(raw || {}) };
}

function conversation(ledger, key, policy, now) {
  return ledger.conversations[key] ||= {
    score: policy.initial, baseScore: policy.initial, unansweredStreak: 0, updatedAt: now,
    lastRecoveryDay: recoveryDay(now), humanAt: null, directedAt: null, userAt: {}, lastUnansweredAt: null
  };
}

function incomingFacts(ledger, key) {
  return Object.entries(ledger.incoming).flatMap(([id, fact]) => {
    // Earlier ledger versions encoded key in the stable receipt ID.
    let factKey = fact.key;
    if (factKey == null) { try { factKey = JSON.parse(id)[0]; } catch { return []; } }
    return factKey === key ? [fact] : [];
  }).sort((a, b) => a.at - b.at);
}

function deriveStreak(ledger, key) {
  const entry = ledger.conversations[key];
  if (!entry) return false;
  const waits = Object.values(ledger.waits).filter(wait => wait.key === key);
  let latestReply = (key.startsWith('private:') ? entry.humanAt : entry.directedAt) ?? -1;
  for (const wait of waits) latestReply = Math.max(latestReply, wait.firstReplyAt ?? wait.answeredAt ?? -1);
  const streak = waits.filter(wait => wait.settledAt != null && wait.penalty > 0 && wait.dueAt > latestReply).length;
  const replyAt = latestReply < 0 ? null : latestReply;
  const changed = entry.unansweredStreak !== streak || entry.lastQualifyingReplyAt !== replyAt;
  entry.unansweredStreak = streak;
  entry.lastQualifyingReplyAt = replyAt;
  return changed;
}

// All facts and receipts belong to the same plugin state transaction. The host
// atomically replaces the JSON file; no in-memory mutation precedes that write.
export function createMoodLedger(ctx, getPolicy) {
  function transact(run) {
    const ledger = loadLedger(ctx.state.get().mood);
    const result = run(ledger, getPolicy());
    if (result.changed) ctx.state.set({ mood: ledger });
    return result.value;
  }

  function settleDue(ledger, policy, now) {
    let settled = 0;
    if (!policy.enabled) return { settled, changed: false, recoveredKeys: [] };
    const due = Object.values(ledger.waits).filter(wait => wait.settledAt == null && wait.answeredAt == null && wait.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt || a.sentAt - b.sentAt);
    for (const wait of due) {
      const entry = conversation(ledger, wait.key, policy, now);
      const before = entry.score;
      entry.score = clamp(entry.score - UNANSWERED_PENALTY);
      entry.updatedAt = now;
      wait.settledAt = now;
      wait.penalty = UNANSWERED_PENALTY;
      recordHistory(entry, { at: now, source: 'unanswered', before, reason: '会话型主动消息到期未获回应', proactiveId: wait.proactiveId, dueAt: wait.dueAt });
      if (wait.lateReplyAt != null) {
        wait.answeredAt = wait.lateReplyAt;
        wait.firstReplyAt ??= wait.lateReplyAt;
      }
      settled++;
    }
    let changed = settled > 0;
    for (const key of Object.keys(ledger.conversations)) changed = deriveStreak(ledger, key) || changed;
    const recoveredKeys=recoverDaily(ledger,policy,now);
    return { settled, changed:changed||recoveredKeys.length>0, recoveredKeys };
  }

  const api = {
    policy: getPolicy,
    initialize({ conversations = [], now = Date.now() } = {}) {
      if (!Array.isArray(conversations) || !timestamp(now)) return { ok: false, imported: 0 };
      return transact((ledger, policy) => {
        const recoveredKeys=recoverDaily(ledger,policy,now);
        let imported = 0;
        for (const legacy of conversations) {
          if (!validKey(legacy?.key) || !validScore(legacy?.score) || Object.hasOwn(ledger.conversations, legacy.key)) continue;
          const entry = conversation(ledger, legacy.key, policy, now);
          entry.score = entry.baseScore = legacy.score;
          imported++;
        }
        return { changed: imported > 0||recoveredKeys.length>0, value: { ok: true, imported, recovered:recoveredKeys.length } };
      });
    },
    read({ key, now = Date.now() } = {}) {
      if (!validKey(key)) return { ok: false, reason: 'invalid_key' };
      if (!timestamp(now)) return { ok: false, reason: 'invalid_time' };
      const ledger = loadLedger(ctx.state.get().mood);
      return moodSnapshot(ledger.conversations[key], getPolicy(), now);
    },
    history({ key, limit = 50 } = {}) {
      if (!validKey(key)) return { ok: false, items: [], reason: 'invalid_key' };
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) return { ok: false, items: [], reason: 'invalid_limit' };
      const entry = loadLedger(ctx.state.get().mood).conversations[key];
      return { ok: true, items: (entry?.history || []).slice(-limit).reverse() };
    },
    adjust({ key, action, value, reason = '', ruleId, now = Date.now() } = {}) {
      if (!validKey(key) || !['add', 'dec'].includes(action) || typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100 || !timestamp(now)) return { ok: false, reason: 'invalid_adjustment' };
      return transact((ledger, policy) => {
        if (!policy.enabled) return { value: { ok: false, reason: 'disabled' } };
        if (ruleId !== undefined) {
          const rule = [...policy.positiveRules, ...policy.negativeRules].find(item => item.id === ruleId);
          if (!rule || (rule.delta > 0 ? action !== 'add' : action !== 'dec') || value > Math.abs(rule.delta)) return { value: { ok: false, reason: 'invalid_rule_adjustment' } };
        } else if (value > policy.maxAdjustment) return { value: { ok: false, reason: 'adjustment_limit' } };
        settleDue(ledger, policy, now);
        const entry = conversation(ledger, key, policy, now);
        const before = entry.score;
        entry.score = clamp(before + (action === 'add' ? value : -value));
        entry.updatedAt = now;
        entry.lastAdjustment = { action, value, reason: String(reason), at: now, ...(ruleId === undefined ? {} : { ruleId }) };
        recordHistory(entry, { at: now, source: 'model-adjustment', before, reason: String(reason), action, value, ...(ruleId === undefined ? {} : { ruleId }) });
        return { changed: true, value: { ok: true, before, score: entry.score, reason: String(reason) } };
      });
    },
    sent({ key, deliveryId, proactiveId, wakeReason, originReason, targetUserId, sentAt = Date.now(), success, expectsReply } = {}) {
      if (!validKey(key) || !stableId(deliveryId) || !timestamp(sentAt)) return { ok: false, reason: 'invalid_receipt' };
      if (success === true && normalReplyReasons.has(wakeReason)) {
        return transact((ledger, policy) => {
          if (!policy.enabled) return { value: { ok: true, created: false, welcomeConsumed: false, reason: 'disabled' } };
          const receiptId = pair(key, deliveryId);
          if (Object.hasOwn(ledger.deliveries, receiptId)) return { value: { ok: true, created: false, welcomeConsumed: false, reason: 'duplicate_delivery' } };
          const entry = ledger.conversations[key];
          const welcomeConsumed = moodSnapshot(entry, policy, sentAt).welcomeBurstActive;
          ledger.deliveries[receiptId] = { wakeReason, ...(originReason == null ? {} : { originReason: String(originReason) }), sentAt, welcomeConsumed };
          if (welcomeConsumed) {
            entry.welcomeBurstPending = false;
            entry.welcomeConsumedAt = sentAt;
            entry.welcomeConsumedDeliveryId = String(deliveryId);
          }
          return { changed: true, value: { ok: true, created: false, welcomeConsumed } };
        });
      }
      if (success !== true || expectsReply !== true || !conversationalReasons.has(wakeReason)) return { ok: true, created: false, reason: 'not_conversational_delivery' };
      if (!stableId(proactiveId)) return { ok: false, reason: 'invalid_receipt' };
      if (targetUserId != null && !validUser(targetUserId)) return { ok: false, reason: 'invalid_target' };
      return transact((ledger, policy) => {
        if (!policy.enabled) return { value: { ok: true, created: false, reason: 'disabled' } };
        const receiptId = pair(key, deliveryId), waitId = pair(key, proactiveId);
        if (Object.hasOwn(ledger.deliveries, receiptId)) return { value: { ok: true, created: false, reason: 'duplicate_delivery' } };
        ledger.deliveries[receiptId] = { proactiveId: String(proactiveId), sentAt };
        const existing = ledger.waits[waitId];
        if (existing) {
          existing.deliveryIds.push(String(deliveryId));
          // The first explicitly targeted successful part may refine an untargeted round.
          // Earlier activity cannot acquire target eligibility retroactively.
          if(existing.targetUserId==null && existing.answeredAt==null && targetUserId!=null){
            existing.targetUserId=String(targetUserId);existing.targetFromAt=sentAt;
            const replies=incomingFacts(ledger,key).filter(fact=>fact.at>=Math.max(existing.sentAt,sentAt)&&fact.userId===existing.targetUserId);
            const reply=replies[0];
            if(reply){
              const entry=ledger.conversations[key];
              if(reply.at<existing.dueAt){
                existing.answeredAt=reply.at;existing.firstReplyAt??=reply.at;
                if(existing.penalty>0){
                  const event=entry?.history?.find(item=>item.source==='unanswered'&&item.proactiveId===existing.proactiveId);
                  if(event){
                    const evidence={deliveryId:String(deliveryId),targetFromAt:sentAt,replyAt:reply.at,recordedAt:Date.now()};
                    event.originalPenalty??=existing.penalty;
                    event.originalScoreEffect??={before:event.before,after:event.after,delta:event.delta};
                    event.voided=true;event.correction=evidence;
                    existing.originalPenalty??=existing.penalty;existing.penalty=0;existing.reconciliation=evidence;
                    replayHistory(entry);
                  }
                }
              }else{
                existing.lateReplyAt??=reply.at;
                if(existing.settledAt!=null){existing.answeredAt=reply.at;existing.firstReplyAt??=reply.at;}
                else settleDue(ledger,policy,Math.max(reply.at,entry?.updatedAt??reply.at));
              }
              deriveStreak(ledger,key);
            }
          }
          return { changed: true, value: { ok: true, created: false, reason: 'duplicate_proactive', dueAt: existing.dueAt } };
        }
        const entry = conversation(ledger, key, policy, sentAt);
        const target = targetUserId == null ? null : String(targetUserId);
        const dueAt = sentAt + policy.noReplyAfterMinutes * 60000;
        const facts = incomingFacts(ledger, key);
        const replies = facts.filter(fact => fact.at >= sentAt && (key.startsWith('private:') || fact.directedAtBot === true || (target != null && fact.userId === target)));
        const answeredAt = replies.find(fact => fact.at < dueAt)?.at ?? null;
        const lateReplyAt = answeredAt == null ? replies.find(fact => fact.at >= dueAt)?.at ?? null : null;
        const wait = { key, proactiveId: String(proactiveId), wakeReason, targetUserId: target, targetFromAt: target == null ? null : sentAt, deliveryIds: [String(deliveryId)], sentAt, dueAt, answeredAt, firstReplyAt: answeredAt, settledAt: null, ...(lateReplyAt == null ? {} : { lateReplyAt }) };
        ledger.waits[waitId] = wait;
        const knownAt = facts.reduce((latest, fact) => Math.max(latest, fact.at), Math.max(sentAt, entry.updatedAt ?? sentAt));
        settleDue(ledger, policy, knownAt);
        return { changed: true, value: { ok: true, created: true, dueAt: wait.dueAt, answeredAt: wait.answeredAt } };
      });
    },
    incoming({ key, messageId, userId, at = Date.now(), hasText, hasImage, isSelf, directedAtBot, reengaged } = {}) {
      if (!validKey(key) || !stableId(messageId) || !validUser(userId) || !timestamp(at)) return { ok: false, reason: 'invalid_incoming' };
      return transact((ledger, policy) => {
        const { settled, changed, recoveredKeys } = settleDue(ledger, policy, at);
        if (!policy.enabled || isSelf === true || (hasText !== true && hasImage !== true)) return { changed, value: { ok: true, accepted: false, settled } };
        const id = pair(key, messageId);
        if (Object.hasOwn(ledger.incoming, id)) return { changed, value: { ok: true, accepted: false, duplicate: true, settled } };
        ledger.incoming[id] = { key, at, userId: String(userId), directedAtBot: directedAtBot === true };
        const entry = conversation(ledger, key, policy, at);
        const floored=recoveredKeys.includes(key);
        entry.humanAt = Math.max(entry.humanAt ?? 0, at);
        entry.userAt ||= {};
        entry.userAt[String(userId)] = Math.max(entry.userAt[String(userId)] ?? 0, at);
        if (directedAtBot === true) entry.directedAt = Math.max(entry.directedAt ?? 0, at);
        let answered = 0;
        const directReply = key.startsWith('private:') || directedAtBot === true;
        for (const wait of Object.values(ledger.waits)) {
          if (wait.key !== key || wait.answeredAt != null || at < wait.sentAt || !(directReply || (wait.targetUserId === String(userId) && at >= (wait.targetFromAt ?? wait.sentAt)))) continue;
          wait.answeredAt = at;
          wait.firstReplyAt ??= at;
          answered++;
        }
        deriveStreak(ledger, key);
        if (entry.welcomeBurstPending && at >= entry.activeUntil) entry.welcomeBurstPending = false;
        const cooldownReady = entry.lastBurstAt == null || at >= entry.lastBurstAt + policy.recoverMinutes * 60000;
        if (reengaged === true && policy.burstEnabled && entry.score >= policy.modeThreshold && at >= entry.humanAt && cooldownReady && !entry.welcomeBurstPending) {
          entry.lastBurstAt = at;
          entry.welcomeBurstPending = true;
          entry.activeUntil = at + (policy.recoverMinutes > 0 ? policy.recoverMinutes : 5) * 60000;
        }
        entry.updatedAt = Math.max(entry.updatedAt ?? 0, at);
        return { changed: true, value: { ok: true, accepted: true, floored, settled, answered, ...moodSnapshot(entry, policy, at) } };
      });
    },
    settle({ now = Date.now() } = {}) {
      if (!timestamp(now)) return { ok: false, reason: 'invalid_time' };
      return transact((ledger, policy) => {
        const { settled, changed, recoveredKeys } = settleDue(ledger, policy, now);
        return { changed, value: { ok: true, settled, recovered:recoveredKeys.length } };
      });
    }
  };
  return api;
}
