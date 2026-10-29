// 专业问题配额：可配置领域词 + 明确问答/任务意图，保守识别，不调用模型分类。
// preflight 在模型投递前机械处理超额请求；beforePrompt 复用同一消息决定。
import { createHash } from 'node:crypto';

const NON_REQUEST_REASONS = new Set([
  'memoryWrite', 'selfReview', 'selfOptimize', 'userFeedbackReview', 'slangLearn',
  'maintenance', 'dailyDiary', 'taskDone', 'reminder', 'timeBubble',
  'startupGreeting', 'careCheck', 'newsShare', 'idleRescue', 'proactiveCheck', 'scheduledContact'
]);
const KNOWLEDGE_QUESTION = /怎么|怎样|为什么|为啥|如何|为何|什么是|什么叫|是什么|是啥|什么意思|有什么(?:作用|区别|关系|意义)|有何|区别|原理|含义|优缺点|是否|多少|多大|(?:成立|正确|对|适用|一样|有问题|有误|合理)(?:吗|么)|能(?:用于|用来|证明|解释|实现|计算).{0,30}吗|\b(?:how|why|what|which)\b/i;
const DIRECT_REQUEST = /^(?:(?:请(?:你|帮我)?|麻烦(?:你)?|帮我|帮忙|能不能|可不可以|能否|可以|给我|求|想请教|我想了解|我想知道|继续|再)\s*)?(?:写|实现|设计|分析|比较|推导|证明|求解|计算|讲解|解释|介绍|总结|综述|翻译|润色|排查|修复|调试|优化|审阅|评估|检查|改写|看一下|看看)|^(?:请|麻烦|帮我|帮忙|给我|能不能|可不可以|能否)\s*|\b(?:explain|implement|debug|fix|derive|prove|calculate|analyze|summarize|compare)\b/i;
const NOT_A_REQUEST = /(?:不需要|不用|别|不要|不必).{0,8}(?:解释|讲解|分析|写|聊|讨论)|(?:提醒|记得提醒|闹钟|备忘).{0,20}(?:论文|代码|科研|实验)|(?:论文|代码|实验).{0,8}(?:写完|读完|做完|完成|提交|交了).{0,4}(?:吗|没|了没)|(?:你|您|大家).{0,10}(?:今天|最近|还在).{0,8}(?:写代码|读论文|写论文|做实验).{0,4}(?:吗|没)|(?:写代码|写论文|做实验).{0,5}(?:好累|真累|累死|好烦)/;
const DEFLECT_TEXT = '唔，这个专业问题我现在有点说不清，你先自己查查资料，好不好？';
const MAX_DECISIONS = 2000;
const pad2 = n => String(n).padStart(2, '0');
function dayKey(nowMs, resetHour) {
  const d = new Date(nowMs), h = Math.max(0, Math.min(23, Math.floor(Number(resetHour) || 0)));
  if (h > 0 && d.getHours() < h) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function normalizedMessage(message = {}) {
  return { text: String(message.plain ?? message.text ?? message.plainContent ?? '').trim(),
    userId: String(message.userId ?? message.user_id ?? ''), isOwner: message.isOwner === true,
    messageId: String(message.messageId ?? message.message_id ?? ''), seq: message.seq, at: message.at ?? message.time };
}
function currentMessage(payload) {
  if (payload.plainContent != null || payload.text != null) return normalizedMessage(payload);
  for (const pool of [payload.st?.unread, payload.st?.recentMessages]) {
    if (!Array.isArray(pool)) continue;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (pool[i]?.isSelf) continue;
      const m = normalizedMessage(pool[i]); if (m.text) return m;
    }
  }
  return null;
}
export function classifyProfessionalRequest(text, keywords = []) {
  // QQ @ segments can be immediately adjacent to Chinese text. A generic
  // non-space match would eat the entire question up to its next space.
  const body = String(text || '').trim().replace(/^(?:@(?:\d+|[A-Za-z_][A-Za-z0-9_.-]*)\s*)+/, '');
  const keyword = keywords.map(k => String(k || '').trim()).filter(Boolean)
    .find(k => body.toLocaleLowerCase().includes(k.toLocaleLowerCase())) || '';
  if (!keyword) return { professional: false, reason: 'no_domain_keyword', keyword: '' };
  if (NOT_A_REQUEST.test(body)) return { professional: false, reason: 'casual_or_nonanswer_request', keyword };
  const professional = KNOWLEDGE_QUESTION.test(body) || DIRECT_REQUEST.test(body);
  return { professional, reason: professional ? 'explicit_professional_request' : 'mention_without_request', keyword };
}

export function createPlugin(ctx) {
  const config = () => ctx.config || {};
  const deflectText = () => String(config().deflectText || DEFLECT_TEXT).replace(/\s+/g, ' ').trim().slice(0, 120) || DEFLECT_TEXT;
  const stateOf = () => { const s = ctx.state.get() || {}; return { day: String(s.day || ''), used: { ...(s.used || {}) }, hits: { ...(s.hits || {}) } }; };
  function usage(key, nowMs = Date.now()) {
    const c = config(), s = stateOf(), day = dayKey(nowMs, c.resetHour), limit = Math.max(0, Math.floor(Number(c.dailyLimit) || 0));
    const used = s.day === day ? Math.max(0, Number(s.used[key]) || 0) : 0;
    return { day, limit, used, remaining: Math.max(0, limit - used) };
  }
  function report(key) {
    const c = config(), s = stateOf(), status = usage(key);
    if (key) return { ok: true, ...status, key, enabled: c.enabled !== false };
    return { ok: true, day: status.day, limit: status.limit, enabled: c.enabled !== false, countBy: String(c.countBy || 'session'),
      enforcement: 'preflight-for-recognized-requests', entries: Object.entries(s.day === status.day ? s.used : {}).map(([bucket, used]) => ({ key: bucket, used, remaining: Math.max(0, status.limit - used) })) };
  }
  function reset(key) {
    if (!key) {
      const receipts = Object.fromEntries(Object.entries(stateOf().hits).filter(([, hit]) => hit?.deflection));
      ctx.state.set({ day: '', used: {}, hits: receipts }); return { ok: true, cleared: 'all' };
    }
    const s = stateOf(), matches = bucket => bucket === key || bucket.startsWith(key + '#');
    const used = Object.fromEntries(Object.entries(s.used).filter(([bucket]) => !matches(bucket)));
    const hits = Object.fromEntries(Object.entries(s.hits).filter(([id, hit]) => hit?.deflection || (!matches(String(hit?.bucketKey || '')) && !id.startsWith(key + '|') && !id.startsWith(key + '#'))));
    ctx.state.set({ used, hits }); return { ok: true, cleared: key };
  }
  function classify(payload = {}) {
    const c = config(), key = String(payload.key || ''), ignore = reason => ({ action: 'ignore', professional: false, reason, key });
    if (c.enabled === false) return ignore('disabled');
    if (NON_REQUEST_REASONS.has(String(payload.reason || '').split(':')[0])) return ignore('nonrequest_round');
    if (!/^(private|group):\d+$/.test(key)) return ignore('invalid_session');
    const message = currentMessage(payload); if (!message?.text) return ignore('no_message');
    if (c.exemptOwner !== false && (payload.isOwnerKey || payload.isOwner === true || message.isOwner)) return ignore('owner_exempt');
    const bucketKey = c.countBy === 'user' && key.startsWith('group:') && /^\d+$/.test(message.userId) ? `${key}#${message.userId}` : key;
    const identity = message.messageId ? ['messageId', message.messageId] : Number.isSafeInteger(message.seq) ? ['seq', message.seq] : ['fallback', message.userId, message.at || '', message.text];
    // Real message IDs and session-local sequence numbers already identify the
    // author. Different trusted call contexts must reuse the same admission.
    const signature = createHash('sha256').update(JSON.stringify([key, identity])).digest('hex');
    return { ...classifyProfessionalRequest(message.text, Array.isArray(c.keywords) ? c.keywords : []), key, bucketKey, signature, messageId: message.messageId };
  }
  function promptFor(decision) {
    if (decision.action === 'ignore') return '';
    if (decision.action === 'deflect') return ['【专业问答配额已用完｜C 层上下文管理】',
      `本轮专业问题（命中「${decision.keyword}」）的计数对象今天已用掉 ${decision.used}/${decision.limit} 次额度。`,
      '不要给出这道题的技术答案、代码、公式、步骤、链接或半个结论。', '只按这句自然带过：' + deflectText(), '不解释额度、不承诺明天回答。'].join('\n');
    if (decision.originalDay && decision.originalDay !== dayKey(Date.now(), config().resetHour)) return '';
    if (decision.remaining === 0) return '【专业问答配额｜提示】这是今天最后一次专业问答额度了，讲完这道就别再展开新的。';
    if (decision.remaining === 1) return '【专业问答配额｜提示】今天还剩 1 次专业问答额度，按需要分配着用。';
    return '';
  }
  function evaluate(payload = {}) {
    const classified = classify(payload); if (classified.action === 'ignore') return { ...classified, prompt: '' };
    const s = stateOf(), old = s.hits[classified.signature];
    // A provisional prompt-only denial can be reconsidered when an admin
    // increases allowance. A claimed/sent/uncertain refusal is terminal.
    const current = usage(classified.bucketKey);
    const reconsider = old?.action === 'deflect' && !old.deflection && current.used < current.limit;
    if (old && typeof old === 'object' && old.action && !reconsider) {
      const decision = { ...classified, ...old, signature: classified.signature, duplicate: true, originalDay: old.day };
      return { ...decision, prompt: promptFor(decision) };
    }
    // The bridge initializes a group's first session even when the discussion
    // never triggered a bot reply. Only an existing explicit admission may carry
    // a professional quota decision into that bootstrap prompt.
    if (classified.key.startsWith('group:') && String(payload.reason || '').split(':')[0] === 'bootstrap' && !old?.action) {
      return { ...classified, action: 'ignore', reason: 'unadmitted_group_bootstrap', prompt: '' };
    }
    if (!classified.professional) return { ...classified, action: 'ignore', prompt: '' };
    const now = Date.now(), status = usage(classified.bucketKey, now), action = status.used < status.limit ? 'allow' : 'deflect';
    const used = status.used + (action === 'allow' ? 1 : 0), decision = { ...classified, ...status, action, used, remaining: Math.max(0, status.limit - used), at: now };
    const hits = { ...s.hits, [classified.signature]: decision }, ids = Object.keys(hits);
    // Outbound claims/receipts are not ordinary dedup entries. Retain them even
    // when history is bounded; trimming must never revive an uncertain send.
    if (ids.length > MAX_DECISIONS) for (const id of ids.filter(id => id !== classified.signature && !hits[id]?.deflection).sort((a, b) => Number(hits[a]?.at || hits[a] || 0) - Number(hits[b]?.at || hits[b] || 0)).slice(0, ids.length - MAX_DECISIONS)) delete hits[id];
    const nextUsed = s.day === status.day ? { ...s.used } : {}; if (action === 'allow') nextUsed[classified.bucketKey] = used;
    ctx.state.set({ day: status.day, used: nextUsed, hits }); return { ...decision, prompt: promptFor(decision) };
  }
  async function preflight(payload = {}) {
    if (payload.allowed === false) return { handled: false, action: 'ignore', reason: 'session_not_allowed' };
    const markHandled = () => { try { payload.onHandled?.(); } catch (error) { ctx.warn?.('配额入站标记失败：' + (error?.message || error)); } };
    let decision;
    try { decision = evaluate(payload); }
    catch (error) { markHandled(); ctx.warn?.('配额决定持久化失败：' + (error?.message || error)); return { handled: true, action: 'deflect', delivered: false, receiptStatus: 'persist_failed' }; }
    if (decision.action !== 'deflect') return { handled: false, action: decision.action, decision };
    // Claim before external IO. Uncertain/failed sends remain handled: neither
    // model fallthrough nor automatic resend is allowed for the same decision.
    const s = stateOf(), stored = s.hits[decision.signature];
    if (stored?.deflection) { markHandled(); return { handled: true, action: 'deflect', decision, duplicate: true, receiptStatus: stored.deflection.status, delivered: stored.deflection.status === 'sent' }; }
    const claim = { status: 'claimed', at: Date.now() };
    try { ctx.state.set({ hits: { ...s.hits, [decision.signature]: { ...stored, deflection: claim } } }); }
    catch (error) { markHandled(); ctx.warn?.('配额拒答凭据持久化失败：' + (error?.message || error)); return { handled: true, action: 'deflect', decision, delivered: false, receiptStatus: 'persist_failed' }; }
    // Close the bridge's pending-message receipt before awaiting external IO;
    // an already running round must not fetch this refused request meanwhile.
    markHandled();
    let delivered = false;
    try { delivered = await ctx.capabilities?.sendSessionText?.(decision.key, deflectText()) === true; }
    catch (error) { ctx.warn?.('配额带过消息未确认送达：' + (error?.message || error)); }
    const latest = stateOf();
    try { ctx.state.set({ hits: { ...latest.hits, [decision.signature]: { ...latest.hits[decision.signature], deflection: { ...claim, status: delivered ? 'sent' : 'uncertain' } } } }); }
    catch (error) { ctx.warn?.('配额拒答回执持久化失败：' + (error?.message || error)); }
    return { handled: true, action: 'deflect', decision, delivered, receiptStatus: delivered ? 'sent' : 'uncertain' };
  }
  function isMessageBlocked({ key, messageId } = {}) {
    if (!key || messageId == null || messageId === '') return false;
    const signature = createHash('sha256').update(JSON.stringify([String(key), ['messageId', String(messageId)]])).digest('hex');
    return stateOf().hits[signature]?.action === 'deflect';
  }
  ctx.registerTool?.('knowledge_quota', {
    description: '查看或清空专业问答配额用量。action=query（默认）或 reset；key 可为会话或群聊#用户计数对象。',
    schema: { type: 'object', properties: { action: { type: 'string' }, key: { type: 'string' } } },
    handler: (input = {}) => String(input.action || 'query') === 'reset' ? reset(String(input.key || '')) : report(String(input.key || ''))
  });
  return { services: { knowledgeQuota: { report, reset, usage, classify, evaluate, preflight, isMessageBlocked } }, canWake() { return true; },
    hooks: { beforePrompt: payload => evaluate(payload).prompt } };
}
