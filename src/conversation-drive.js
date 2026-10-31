// Semantic guidance shared by replies and already-authorized proactive turns.
// Timing belongs to life-wake-reasons. This pure selector never spends quota or draws a lottery.
export const DEFAULT_CONVERSATION_DRIVE = { enabled: true, followUpCooldownMinutes: 8, newTopicCooldownMinutes: 45, newTopicMaxPerHour: 2, deadEndShortChars: 8, seeds: [] };
const BUILTIN_SEEDS = ['最近在忙的一件具体小事', '最近喜欢的作品或游戏', '想开始但还没开始的一个小计划'];
const ACK = /^(嗯+|噢+|哦+|好+|行|收到|知道了|懂了|没事|算了|不用了?|晚安|睡(觉)?了?|先这样|拜拜|再见|ok|okay|谢谢|感谢)[\s。.!！~～]*$/i;
const CLOSING = /先别(发|问|说)|别再(发|问|说)|等我|等一下|稍后再|待会再|不想聊|不聊了|先这样|晚安|睡觉了|再见|拜拜/;
const textOf = m => String(m?.plain ?? m?.text ?? m?.tail ?? '').replace(/\s+/g, ' ').trim();
const timeOf = m => Number(m?.at ?? m?.time ?? m?.timestamp) || 0;
const minutes = (v, d) => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d;
export function normalizeConversationDriveConfig(raw = {}) {
  const d = DEFAULT_CONVERSATION_DRIVE;
  return { enabled: raw.enabled !== false, followUpCooldownMinutes: minutes(raw.followUpCooldownMinutes, d.followUpCooldownMinutes),
    newTopicCooldownMinutes: minutes(raw.newTopicCooldownMinutes, d.newTopicCooldownMinutes), newTopicMaxPerHour: Math.round(minutes(raw.newTopicMaxPerHour, d.newTopicMaxPerHour)),
    deadEndShortChars: Math.max(1, Math.round(minutes(raw.deadEndShortChars, d.deadEndShortChars))),
    seeds: Array.isArray(raw.seeds) ? raw.seeds.map(String).map(s => s.trim().slice(0, 60)).filter(Boolean).slice(0, 20) : [] };
}
export function planConversationDrive(opts = {}) {
  const none = { kind: 'none', line: '', patch: {}, reason: '' }, cfg = normalizeConversationDriveConfig(opts.config);
  if (!cfg.enabled) return none;
  const st = opts.state || {}, now = opts.now ?? Date.now();
  const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
  const unread = Array.isArray(st.unread) ? st.unread.filter(m => m && !m.isSelf) : [];
  const incoming = unread.at(-1) || [...recent].reverse().find(m => m && !m.isSelf);
  const lastSelf = [...recent].reverse().find(m => m?.isSelf), text = textOf(incoming);
  if (CLOSING.test(text) || (text.length <= cfg.deadEndShortChars && ACK.test(text))) return none;
  const style = opts.mood?.styleInstruction ? `遵循系统中当前形态「${String(opts.mood.modeName || '')}」与完整示范；不在这里另附一套风格。` : '';
  if (opts.needsClarification === true && incoming) return { kind: 'followup', reason: 'clarification', patch: {}, line: `【任务澄清】${style}先回答已确定部分，只询问完成用户实际请求所缺的必要信息；这不要求附加社交问题。` };
  const unanswered = (lastSelf && /[?？]/.test(textOf(lastSelf)) && (!incoming || timeOf(lastSelf) >= timeOf(incoming)))
    || (st.lastQuestionAt && (!incoming || st.lastQuestionAt >= timeOf(incoming)));
  if (unanswered || opts.waiting === true) return none;
  const followAllowed = !st.driveFollowUpAt || now - st.driveFollowUpAt >= cfg.followUpCooldownMinutes * 60000;
  const newTopicTimes = (st.driveNewTopicTimes || []).filter(t => t > now - 3600000);
  const newTopicAllowed = (!st.driveNewTopicAt || now - st.driveNewTopicAt >= cfg.newTopicCooldownMinutes * 60000)
    && newTopicTimes.length < cfg.newTopicMaxPerHour;
  const answeredOurQuestion = lastSelf && incoming && /[?？]/.test(textOf(lastSelf)) && timeOf(lastSelf) < timeOf(incoming);
  if (incoming && followAllowed && !answeredOurQuestion && opts.topicIntent !== 'newTopic') return { kind: 'followup', reason: 'reply', patch: {}, line: `【会话推进｜可选追问】${style}先正常回应当前内容，再由你判断是否值得自然追问一个具体细节${newTopicAllowed ? '，或顺着当前内容换一个相关新话题' : ''}；收尾、等待、已经回答的问题不再追问。任务澄清按真实需要进行，不受社交追问冷却影响。不要每轮强塞问题。` };
  if (opts.proactive !== true && !(incoming && opts.topicIntent === 'newTopic')) return none;
  if (!newTopicAllowed) return none;
  const topics = (st.activeTopics || []).filter(t => t?.text && !t.pendingQuestion).map(t => String(t.text).slice(0, 60));
  const pool = [...topics, ...(cfg.seeds.length ? cfg.seeds : BUILTIN_SEEDS)].filter(t => t !== st.lastTopicId);
  if (!pool.length) return none;
  const selected = typeof opts.selectTopic === 'function' ? opts.selectTopic(pool, { state: st, now }) : pool[(Number(st.driveCount) || 0) % pool.length];
  if (!pool.includes(selected)) return none;
  return { kind: 'newTopic', topicId: selected, reason: 'authorized', patch: {}, line: `【会话推进｜起个新话题】${style}${opts.proactive ? '本轮已经获得主动机会。' : '先回应用户当前内容，再自然衔接。'}结合当前QQ本人档案、作息和近期语境，从「${selected}」选一个具体切入点，邀请对方轻松回应。不要重复未回答的问题，不假装刚发生旧事；存在探索只是可选内容。` };
}
