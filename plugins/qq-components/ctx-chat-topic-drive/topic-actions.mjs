const openingURL = new URL('./opening-topic.mjs', import.meta.url); openingURL.search = new URL(import.meta.url).search;
const {openingGuidance} = await import(openingURL.href);
const defaults = { followupWeight: .5, newTopicWeight: .2, followUpCooldownMinutes: 8, newTopicCooldownMinutes: 45, newTopicMaxPerHour: 2 };
const NUDGE = /(?:还在[吗嘛么]?|在不在|怎么不说话|怎么不回|回我一下|说句话|人呢|有人吗)/;
const validKey = key => /^(private|group):\d+$/.test(String(key || ''));
const directQuestion = text => /[?？]|(?:吗|么|呢)[呀啊嘛]?[。！!]*$/.test(String(text || '').trim());
const reject = reason => ({ok:false,reason,...(reason==='question_already_asked'?{hint:'本次主动开口已经问过一个问题；不要改写重试、换话题或换发送工具，等用户真实回应后再接。'}:reason==='new_topic_already_chosen'?{hint:'本次主动开口已经选定一个话题；不要改话题ID重试，也不追加另一个开场问题。'}:{})});
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
    if (d.episodes?.[episodeId]?.[kind]) {
      const chosenTopic = d.episodes[episodeId].topicId || d.lastTopicId;
      return kind === 'newTopic' && chosenTopic && chosenTopic !== topicId ? 'new_topic_already_chosen' : '';
    }
    if (kind === 'followup') {
      const last = d.followupByTopic ? d.followupByTopic[topicId] : d.driveFollowUpAt;
      return last && now - last < cfg.followUpCooldownMinutes * 60000 ? 'followup_cooldown' : '';
    }
    if (d.driveNewTopicAt && now - d.driveNewTopicAt < cfg.newTopicCooldownMinutes * 60000) return 'new_topic_cooldown';
    if ((d.driveNewTopicTimes || []).filter(t => t > now - 3600000).length >= cfg.newTopicMaxPerHour) return 'new_topic_hour_limit';
    return '';
  }
  function opening({ key, scope, hasContext = false, now = Date.now(), random = Math.random } = {}) {
    if (!validKey(key) || !scope || !validateConfig().ok) return { action: 'none', reason: 'invalid_opening' };
    const previous = get().openingChoices?.[key], currentGeneration = generation(key);
    if (previous?.scope === scope) return previous.generation === currentGeneration ? previous
      : { action: 'none', reason: 'incoming_superseded', guidance: '本轮已经收到新来信，原主动开聊选择不再执行；先回应最近消息，按公共等待机制继续，不重抽开聊话题。' };
    const episode = 'opening:' + scope;
    const a = hasContext && !allowed(key, 'followup', topic(key), episode, now) ? cfg.followupWeight : 0;
    const b = !allowed(key, 'newTopic', topic(key), episode, now) ? cfg.newTopicWeight : 0;
    const total = a + b, followupProbability = total ? a / total : 0, newTopicProbability = total ? b / total : 0;
    const action = !total ? 'none' : !a ? 'newTopic' : !b ? 'followup' : random() < followupProbability ? 'followup' : 'newTopic';
    const choice = { scope, generation: currentGeneration, action, followupProbability, newTopicProbability, at: now };
    choice.guidance = openingGuidance(choice);
    const choices = { ...(get().openingChoices || {}), [key]: choice };
    const keys = Object.keys(choices);
    if (keys.length > 1000) keys.sort((x,y) => choices[x].at - choices[y].at).slice(0, keys.length - 1000).forEach(k => delete choices[k]);
    ctx.state.set({ openingChoices: choices });
    return choice;
  }
  function afterWait({ key, scope, seq = 0, emptyWaits, endRound, now = Date.now(), random = Math.random } = {}) {
    if (!validKey(key) || !scope || endRound !== false || !validateConfig().ok) return { action: 'wait' };
    const id = `${scope}:${seq}:${emptyWaits}`, previous = get().topicChoices?.[key];
    if (previous?.id === id && previous.generation === generation(key)) return previous;
    const r = random();
    let action = r < cfg.followupWeight ? 'followup' : r < cfg.followupWeight + cfg.newTopicWeight ? 'newTopic' : 'wait';
    const topicId = topic(key), reason = action === 'wait' ? '' : allowed(key, action, topicId, id, now);
    if (reason) action = 'wait';
    const guidance = action === 'followup' ? '本轮不结束，已抽中旧话题追问：下一步优先实际发送一条具体、容易回答的问题，接着刚才尚未聊完的细节追问；尽量不要只说“还在吗”，也不要仅在内部计划追问后就直接再次等待。用 conversationIntent="followup"，保持当前形态与语气，不另起话题，不凭空补充用户经历；确认发送成功后再继续等待。若对方明确忙碌、拒绝或已结束话题，没有合适切入点，或冷却、免打扰、发送预算不允许，允许继续等待或正常收尾，不机械催问。'
      : action === 'newTopic' ? '本轮不结束，已抽中新话题：下一步优先实际发送一条简短、自然的新话题消息，结合当前会话上下文和已确认近况，留一个容易回应的具体切入点；不要仅在内部计划换题后直接再次等待。用 conversationIntent="newTopic" 并给出稳定 topicId；保持当前形态与语气，不凭空补充事实，确认发送成功后再继续等待。若对方明确忙碌、拒绝，缺少合适话题或发送受限，允许继续等待或正常收尾。'
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
    if (semantic === 'newTopic' && Object.values(get().topicLeases || {}).some(lease => lease.key === key
      && lease.generation === generation(key) && lease.episodeId === actionId && lease.kind === 'newTopic' && lease.topicId !== selectedTopic)) {
      return reject('new_topic_already_chosen');
    }
    const asksQuestion=semantic==='followup'||directQuestion(text),episode=drive(key).episodes?.[actionId];
    if(asksQuestion&&((episode?.questionSent&&episode.questionGeneration===generation(key))||Object.values(get().topicLeases||{}).some(lease=>lease.key===key&&lease.generation===generation(key)&&lease.episodeId===actionId&&lease.asksQuestion)))return reject('question_already_asked');
    const reason = cross ? '' : allowed(key, semantic, selectedTopic, actionId, now);
    if (reason) return reject(reason);
    const lease = { ok: true, id: operationId, key, generation: generation(key), kind: semantic, topicId: selectedTopic, episodeId: actionId, asksQuestion, isProactive: true, timeoutAction: !cross && bound };
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
  return { validateConfig, opening, afterWait, endWait, reserve, authorize, release, delivered, incoming };
}
