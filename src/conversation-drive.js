// 会话推进组件（conversation drive）
//
// 把「接住话题并反问」「冷场时主动起新话题」从模型的临场发挥，变成桥接层的确定性组件：
//   · 每轮唤醒时由桥接判定这一轮该不该「往下追」或「抛新话题」，并把具体要求写进 prompt；
//   · 判定带冷却/频率上限，避免每轮都反问、每句话都开新话题（那样更像客服话术）。
//
// 只做判定与提示词文本，不发消息；状态补丁由调用方合并进 socialV2 会话状态后落盘。

export const DEFAULT_CONVERSATION_DRIVE = {
  enabled: true,
  // 回复时追加一句具体追问的概率（0~1）
  followUpProbability: 0.5,
  // 冷场/无未读时主动起新话题的概率（0~1）
  newTopicProbability: 0.35,
  // 两次「追问」引导之间的最小间隔
  followUpCooldownMinutes: 8,
  // 两次「起新话题」引导之间的最小间隔 / 每小时上限
  newTopicCooldownMinutes: 45,
  newTopicMaxPerHour: 2,
  // 短到只算「收尾」的回复（嗯/噢/好的/睡了…）≤ 这个字数时，最容易聊死
  deadEndShortChars: 8,
  // 自定义话题种子（留空则用内置池）
  seeds: []
};

const ACK_RE = /^(嗯+|噢+|哦+|好+|行|可以|收到|知道了|懂了|草+|哈哈+|笑死|确实|是|对|没事|算了|不用了?|晚安|睡(觉)?了?|先这样|拜拜|再见|ok|okay|thx|谢谢|感谢|1|11|111)[\s。.!！~～]*$/i;

const BUILTIN_SEEDS = [
  '今天吃了什么／谁请客',
  '最近在忙的一件事里最烦的那一步',
  '刚看到的一条离谱新闻或热梗',
  '最近有没有什么一直在拖、一直没做的事',
  '天气/季节变化带来的具体小事（比如突然要穿外套）',
  '在追的剧/番/游戏，最好具体到某一集或某个卡关',
  '最近花得最值的一笔小钱',
  '有没有那种「早就想学但一直没开始」的技能'
];

function clampProb(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function minutes(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/** 合并默认值 + 用户配置，输出安全的驱动配置。 */
export function normalizeConversationDriveConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_CONVERSATION_DRIVE;
  return {
    enabled: src.enabled !== false,
    followUpProbability: clampProb(src.followUpProbability, d.followUpProbability),
    newTopicProbability: clampProb(src.newTopicProbability, d.newTopicProbability),
    followUpCooldownMinutes: minutes(src.followUpCooldownMinutes, d.followUpCooldownMinutes),
    newTopicCooldownMinutes: minutes(src.newTopicCooldownMinutes, d.newTopicCooldownMinutes),
    newTopicMaxPerHour: Math.max(0, Math.round(minutes(src.newTopicMaxPerHour, d.newTopicMaxPerHour))),
    deadEndShortChars: Math.max(1, Math.round(Number(src.deadEndShortChars) || d.deadEndShortChars)),
    seeds: Array.isArray(src.seeds) ? src.seeds.filter((s) => s && String(s).trim()).map((s) => String(s).trim().slice(0, 60)).slice(0, 20) : []
  };
}

function textOf(msg) {
  return String(msg?.plain ?? msg?.text ?? msg?.tail ?? '').replace(/\s+/g, ' ').trim();
}

function isAckLike(text, maxChars) {
  const t = String(text || '').trim();
  if (!t) return false;
  // 纯表情/纯标点也算收尾
  if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(t)) return true;
  if (t.length <= maxChars && ACK_RE.test(t)) return true;
  return false;
}

function hasQuestion(text) {
  return /[?？]/.test(String(text || ''));
}

function pickSeed(seeds, st, now) {
  const pool = seeds.length ? seeds : BUILTIN_SEEDS;
  // 优先接上次没聊完的话题，其次是按时间轮换的种子，避免每次都同一句。
  const topics = Array.isArray(st?.activeTopics) ? st.activeTopics.filter((t) => t && t.text) : [];
  if (topics.length) {
    const t = topics[topics.length - 1];
    const pending = t.pendingQuestion ? `（记得把上次没问出口的「${String(t.pendingQuestion).slice(0, 40)}」问出来）` : '';
    return { text: String(t.text).slice(0, 60), source: 'activeTopic', suffix: pending };
  }
  const idx = Math.abs(Math.floor(now / 60000) + (Number(st?.driveCount) || 0)) % pool.length;
  return { text: pool[idx], source: 'seed', suffix: '' };
}

/**
 * 判定这一轮要不要「往下追」/「起新话题」。
 * @param {{ state: object, config?: object, now?: number, isGroup?: boolean }} opts
 * @returns {{ kind: 'none'|'followup'|'newTopic', line: string, patch: object, reason: string }}
 */
export function planConversationDrive(opts = {}) {
  const none = { kind: 'none', line: '', patch: {}, reason: '' };
  try {
    const cfg = normalizeConversationDriveConfig(opts.config);
    if (!cfg.enabled) return none;
    const st = opts.state && typeof opts.state === 'object' ? opts.state : {};
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();

    const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
    const unread = Array.isArray(st.unread) ? st.unread.filter((m) => m && !m.isSelf) : [];
    const incoming = unread.length ? unread[unread.length - 1] : [...recent].reverse().find((m) => m && !m.isSelf);
    const lastSelf = [...recent].reverse().find((m) => m && m.isSelf);
    const lastIncomingText = textOf(incoming);

    const lastDriveAt = Number(st.driveFollowUpAt) || 0;
    const lastNewTopicAt = Number(st.driveNewTopicAt) || 0;
    const lastKind = String(st.driveLastKind || '');
    const newTopicTimes = Array.isArray(st.driveNewTopicTimes) ? st.driveNewTopicTimes.filter((t) => Number.isFinite(Number(t))) : [];
    const hourAgo = now - 60 * 60 * 1000;
    const newTopicsLastHour = newTopicTimes.filter((t) => Number(t) > hourAgo).length;

    const aiAskedLast = lastSelf && lastSelf.time && incoming?.time
      ? hasQuestion(textOf(lastSelf)) && Number(lastSelf.time) < Number(incoming.time)
      : false;
    const incomingIsQuestion = hasQuestion(lastIncomingText);
    const ackLike = isAckLike(lastIncomingText, cfg.deadEndShortChars);
    const cold = !incoming; // 没有任何来信：要么主动开口，要么这轮只是观察

    // ① 起新话题：冷场或对方明显在收尾时，且冷却/频率都允许。
    const newTopicAllowed = now - lastNewTopicAt >= cfg.newTopicCooldownMinutes * 60000
      && newTopicsLastHour < cfg.newTopicMaxPerHour
      && lastKind !== 'newTopic';
    if ((cold || ackLike) && newTopicAllowed && Math.random() < cfg.newTopicProbability) {
      const seed = pickSeed(cfg.seeds, st, now);
      const line = '【会话推进｜起个新话题】' + (cold ? '这会儿没人说话，' : '对方这句基本是收尾（«' + lastIncomingText.slice(0, 16) + '»），')
        + '你这轮自然抛一个新话题（可以接着对方的意思想像，也别硬掰）：' + seed.text + (seed.suffix ? seed.suffix : '')
        + '。要求：用陈述句起头、具体到一个细节，不要问「有人吗/在聊什么」，不要一次抛两个话题。';
      return {
        kind: 'newTopic',
        line,
        reason: cold ? 'cold' : 'ack',
        patch: { driveNewTopicAt: now, driveLastKind: 'newTopic', driveCount: (Number(st.driveCount) || 0) + 1, driveNewTopicTimes: [...newTopicTimes, now].slice(-10) }
      };
    }

    // ② 往下追：有来信、不是纯收尾，且这句不是刚回答我的问题（别连着追问像审讯）。
    const followAllowed = now - lastDriveAt >= cfg.followUpCooldownMinutes * 60000
      && !aiAskedLast
      && lastKind !== 'followup';
    if (incoming && followAllowed && Math.random() < cfg.followUpProbability) {
      const line = '【会话推进｜往下追一句】这一轮回完对方之后，顺带接一个**具体**的追问：问细节、问后来怎样、问对方的看法都行，'
        + (incomingIsQuestion ? '（他刚问了你什么，答完再反问一句他那边的情况）' : '')
        + '别用「然后呢/还有呢」这种空追问，也别把话题绕回你自己。追问最多一句，不能变成审问。';
      return {
        kind: 'followup',
        line,
        reason: incomingIsQuestion ? 'question' : 'reply',
        patch: { driveFollowUpAt: now, driveLastKind: 'followup', driveCount: (Number(st.driveCount) || 0) + 1 }
      };
    }

    return none;
  } catch {
    return none;
  }
}
