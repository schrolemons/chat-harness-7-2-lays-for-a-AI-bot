const defaults = { followupWeight: .5, newTopicWeight: .2, followUpCooldownMinutes: 8, newTopicCooldownMinutes: 45, newTopicMaxPerHour: 2 };
const NUDGE = /(?:还在[吗嘛么]?|在不在|怎么不说话|怎么不回|回我一下|说句话|人呢|有人吗)/;
const validKey = key => /^(private|group):\d+$/.test(String(key || ''));
export function createTopicActions(ctx, raw = {}) {
  const cfg = { ...defaults, ...raw }, get = () => ctx.state.get();
  function validateConfig(patch = {}) {
    const c = { ...cfg, ...patch }, errors = [];
    if (![c.followupWeight, c.newTopicWeight].every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1)
      || c.followupWeight + c.newTopicWeight > 1 + 1e-10) errors.push('a、b 必须在 0–1 之间，且 a+b 不超过1');
    for (const k of ['followUpCooldownMinutes', 'newTopicCooldownMinutes', 'newTopicMaxPerHour']) if (!Number.isFinite(c[k]) || c[k] < 0) errors.push(k + ' 必须为非负数');
    return { ok: errors.length === 0, errors };
  }
  const generation = key => get().topicGenerations?.[key] || 0;
  const drive = key => get().driveByKey?.[key] || {};
  const topic = key => String(drive(key).currentTopicId || drive(key).lastTopicId || 'current');
  function allowed(key, kind, topicId, episodeId, now) {
    const d = drive(key);
    if (d.episodes?.[episodeId]?.[kind]) return '';
    if (kind === 'followup') {
      const last = d.followupByTopic ? d.followupByTopic[topicId] : d.driveFollowUpAt;
      return last && now - last < cfg.followUpCooldownMinutes * 60000 ? 'followup_cooldown' : '';
    }
    if (d.driveNewTopicAt && now - d.driveNewTopicAt < cfg.newTopicCooldownMinutes * 60000) return 'new_topic_cooldown';
    if ((d.driveNewTopicTimes || []).filter(t => t > now - 3600000).length >= cfg.newTopicMaxPerHour) return 'new_topic_hour_limit';
    return '';
  }
  function afterWait({ key, scope, seq = 0, emptyWaits, endRound, now = Date.now(), random = Math.random } = {}) {
    if (!validKey(key) || !scope || endRound !== false || !validateConfig().ok) return { action: 'wait' };
    const id = `${scope}:${seq}:${emptyWaits}`, previous = get().topicChoices?.[key];
    if (previous?.id === id && previous.generation === generation(key)) return previous;
    const r = random();
    let action = r < cfg.followupWeight ? 'followup' : r < cfg.followupWeight + cfg.newTopicWeight ? 'newTopic' : 'wait';
    const topicId = topic(key), reason = action === 'wait' ? '' : allowed(key, action, topicId, id, now);
    if (reason) action = 'wait';
    const guidance = action === 'followup' ? '本轮不结束：可围绕当前旧话题追问一次，也可简短询问是否还在。用 conversationIntent="followup"，不要另起话题；真实发送受冷却和发送计划限制。'
      : action === 'newTopic' ? '本轮不结束：结合当前会话上下文和已确认近况，自行发起一个新话题。用 conversationIntent="newTopic" 并给出稳定 topicId；不凭空补充事实。'
      : '本轮不结束，但现在应继续等待，不追加追问或新话题。';
    const choice = { id, scope, seq, action, topicId, generation: generation(key), reason, guidance, at: now };
    ctx.state.set({ topicChoices: { ...(get().topicChoices || {}), [key]: choice } });
    return choice;
  }
  function reserve({ key, scope, operationId, kind, text = '', topicId, episodeId, originReason, now = Date.now() } = {}) {
    if (!validKey(key) || !operationId) return { ok: false, reason: 'invalid_topic_send' };
    const choice = get().topicChoices?.[key];
    const bound = !!choice && choice.scope === scope && choice.generation === generation(key);
    const cross = originReason === 'privateFollowup';
    if (!cross && bound && choice.action === 'wait') return { ok: false, reason: 'continue_waiting' };
    const semantic = cross ? 'privateFollowup' : bound ? choice.action : ['followup', 'newTopic'].includes(kind) ? kind : (String(text).length <= 40 && NUDGE.test(text)) ? 'followup' : '';
    if (!semantic) return { ok: true, ordinary: true };
    const actionId = cross ? episodeId || operationId : bound ? choice.id : String(episodeId || operationId) + ':topic';
    const selectedTopic = String(topicId || choice?.topicId || topic(key));
    const reason = cross ? '' : allowed(key, semantic, selectedTopic, actionId, now);
    if (reason) return { ok: false, reason };
    const lease = { ok: true, id: operationId, key, generation: generation(key), kind: semantic, topicId: selectedTopic, episodeId: actionId, isProactive: true, timeoutAction: !cross && bound };
    ctx.state.set({ topicLeases: { ...(get().topicLeases || {}), [operationId]: lease } });
    return lease;
  }
  function authorize({ key, lease } = {}) {
    if (!lease || lease.ordinary) return { ok: true };
    return { ok: !!get().topicLeases?.[lease.id] && lease.key === key && lease.generation === generation(key) };
  }
  function release({ lease } = {}) {
    if (!lease?.id) return;
    const leases = { ...(get().topicLeases || {}) }; delete leases[lease.id]; ctx.state.set({ topicLeases: leases });
  }
  function delivered({ key, success, topicLease, kind, text = '', episodeId, originReason } = {}) {
    if (success !== true) return { isProactive: false };
    release({ lease: topicLease });
    if (topicLease && !topicLease.ordinary) return { ...topicLease, independentPrivateFollowup: topicLease.kind === 'privateFollowup' };
    if (originReason === 'privateFollowup') return { kind: 'privateFollowup', episodeId, isProactive: true, independentPrivateFollowup: true };
    const semantic = ['followup', 'newTopic'].includes(kind) ? kind : (String(text).length <= 40 && NUDGE.test(text)) ? 'followup' : kind;
    return { kind: semantic, episodeId, isProactive: ['followup', 'newTopic'].includes(semantic) };
  }
  function incoming({ key, isSelf } = {}) {
    if (!validKey(key) || isSelf) return;
    const choices = { ...(get().topicChoices || {}) }; delete choices[key];
    const leases = Object.fromEntries(Object.entries(get().topicLeases || {}).filter(([, lease]) => lease.key !== key));
    ctx.state.set({ topicLeases: leases, topicChoices: choices, topicGenerations: { ...(get().topicGenerations || {}), [key]: generation(key) + 1 } });
  }
  function endWait({key,scope,seq=0}={}) {
    const closed={action:'wait',guidance:'本轮已结束，等待新来信；不得继续追加追问或新话题。'};
    if(!validKey(key)||!scope)return closed;
    incoming({key});
    ctx.state.set({topicChoices:{...(get().topicChoices||{}),[key]:{...closed,id:scope+':ended',scope,seq,generation:generation(key),reason:'round_ended',at:Date.now()}}});
    return closed;
  }
  return { validateConfig, afterWait, endWait, reserve, authorize, release, delivered, incoming };
}
