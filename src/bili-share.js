// 每日 B 站视频推荐（原「每日新闻/热梗」）的纯逻辑。
//
// 这里只做数据处理：关键词轮换、候选去重与字段校验、失败退避、近推记录合并。
// 不联网、不读写文件、不碰 QQ —— 由定时唤醒提示 bot 调用 tool-bilibili 组件的
// bili_search 工具完成检索，发送仍走原来的唤醒流程。
//
// 搜索结果的标题 / UP 主 / BV 号必须来自 B 站接口原始返回；bot 不可编视频。

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_KEYWORDS = 12;
const MAX_RECENT_BVIDS = 80;
const MAX_TOPIC_UPLOADERS = 40;
const MAX_SESSIONS = 200;
// 取 B 站搜索接口的公开字段长度上限，避免把超长简介整段塞进提示词。
const MAX_TITLE_CHARS = 120;
const MAX_UPLOADER_CHARS = 60;
const MAX_DESC_CHARS = 120;

export const BILI_BV_RE = /^BV[0-9A-Za-z]{10}$/;

// 选题方向（机主 2026-10-28 确认）：海洋 / 正太·少年 / 鲸鱼相关。
// 按天轮换，保证同一天可复现，也不会天天用同一个词。
export const DEFAULT_BILI_KEYWORDS = [
  '鲸鱼',
  '海洋',
  '少年感',
  '海洋 纪录片',
  '大海 治愈',
  '少年 成长'
];

function cleanText(value, maxChars) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export function normalizeKeywords(list) {
  const out = [];
  const values = Array.isArray(list)
    ? list
    : (typeof list === 'string' ? list.split(/[,，\r\n]+/) : []);
  const seen = new Set();
  for (const raw of values) {
    for (const part of String(raw ?? '').split(/[,，\r\n]+/)) {
      const text = cleanText(part, 40);
      const key = text.toLocaleLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= MAX_KEYWORDS) return out;
    }
  }
  return out.length ? out : [...DEFAULT_BILI_KEYWORDS];
}

export function normalizeTopicUploaders(list, keywords = DEFAULT_BILI_KEYWORDS) {
  const topics = normalizeKeywords(keywords);
  const canonicalTopics = new Map(topics.map((topic) => [topic.toLocaleLowerCase(), topic]));
  const values = Array.isArray(list) ? list : (typeof list === 'string' ? list.split(/[\r\n]+/) : []);
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const fields = typeof raw === 'object' && raw !== null
      ? [raw.topic, raw.uploader, raw.weight]
      : String(raw ?? '').split('|').map((value) => value.trim());
    const topicKey = cleanText(fields[0], 40).toLocaleLowerCase();
    const topic = canonicalTopics.get(topicKey);
    const uploader = cleanText(fields[1], 80);
    const weightRaw = fields[2] === undefined || fields[2] === '' ? 1 : Number(fields[2]);
    if (!topic || !uploader || !Number.isFinite(weightRaw) || weightRaw <= 0) continue;
    const weight = Math.min(100, Math.max(0.1, weightRaw));
    const key = `${topic.toLocaleLowerCase()}\u0000${uploader.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ topic, uploader, weight });
    if (out.length >= MAX_TOPIC_UPLOADERS) break;
  }
  return out;
}

export function normalizeSessionWhitelist(list) {
  const values = Array.isArray(list) ? list : (typeof list === 'string' ? list.split(/[,，\r\n]+/) : []);
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const key = String(raw ?? '').trim();
    if (!/^(?:group|private):\d+$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_SESSIONS) break;
  }
  return out;
}

export function isWhitelistedSession(key, sessionWhitelist) {
  const session = String(key ?? '').trim();
  return /^(?:group|private):\d+$/.test(session) && normalizeSessionWhitelist(sessionWhitelist).includes(session);
}

function randomUnit(random) {
  const sample = Number(random());
  return Number.isFinite(sample) ? Math.max(0, Math.min(0.9999999999999999, sample)) : 0;
}

export function chooseWeightedTopic(keywords, topicUploaders = [], random = Math.random) {
  const list = normalizeKeywords(keywords);
  const uploaderWeights = new Map();
  for (const row of normalizeTopicUploaders(topicUploaders, list)) {
    uploaderWeights.set(row.topic, (uploaderWeights.get(row.topic) || 0) + row.weight);
  }
  const weights = list.map((topic) => 1 + (uploaderWeights.get(topic) || 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let target = randomUnit(random) * total;
  for (let index = 0; index < list.length; index += 1) {
    target -= weights[index];
    if (target < 0) return list[index];
  }
  return list[list.length - 1];
}

export function chooseTopicUploader(topic, topicUploaders = [], random = Math.random) {
  const matches = normalizeTopicUploaders(topicUploaders, [topic]).filter((row) => row.topic === topic);
  const total = 1 + matches.reduce((sum, row) => sum + row.weight, 0);
  // One base-weight bucket means discover a new creator; every remaining bucket
  // corresponds to a configured UP and is proportional to that UP's weight.
  let target = randomUnit(random) * total;
  if (target < 1) return '';
  target -= 1;
  for (const row of matches) {
    target -= row.weight;
    if (target < 0) return row.uploader;
  }
  return matches[matches.length - 1]?.uploader || '';
}

/** 从 socialV2.dailyNews 读推荐参数；开关与钟点仍由原来的 dailyNews 配置控制。 */
export function resolveShareConfig(dailyNews = {}) {
  const raw = dailyNews && typeof dailyNews === 'object' ? dailyNews : {};
  const n = Number(raw.maxItems);
  const keywords = normalizeKeywords(raw.keywords);
  return {
    keywords,
    topicUploaders: normalizeTopicUploaders(raw.topicUploaders, keywords),
    sessionWhitelist: normalizeSessionWhitelist(raw.sessionWhitelist),
    maxItems: Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : 2
  };
}

/** 按天轮换关键词顺序：同一天稳定（可测），第二天换下一组。 */
export function rotateKeywords(keywords, dayIndex = 0) {
  const list = normalizeKeywords(keywords);
  const days = Number.isFinite(Number(dayIndex)) ? Math.floor(Number(dayIndex)) : 0;
  const offset = ((days % list.length) + list.length) % list.length;
  return [...list.slice(offset), ...list.slice(0, offset)];
}

export function dayIndexFromTime(now = Date.now()) {
  return Math.floor(Number(now) / DAY_MS);
}

export function normalizeExcludeBvids(list) {
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const bvid = String(raw ?? '').trim();
    if (!BILI_BV_RE.test(bvid)) continue;
    seen.add(bvid.toUpperCase());
  }
  return [...seen];
}

/**
 * 从 bili_search 返回的 items 里挑出可推的视频：
 * - BV 号必须合法、标题必须非空（否则不推，绝不补编）；
 * - 排除最近推过的（excludeBvids）与本次已选的；
 * - 只保留提示词需要的字段，链接一律用接口给的 BV 号拼。
 */
export function pickVideos(items, { excludeBvids = [], maxItems = 2 } = {}) {
  const limit = Math.max(1, Math.min(5, Math.round(Number(maxItems) || 2)));
  const excluded = new Set(normalizeExcludeBvids(excludeBvids));
  const picked = [];
  for (const row of Array.isArray(items) ? items : []) {
    if (!row || typeof row !== 'object') continue;
    const bvid = String(row.bvid ?? '').trim();
    if (!BILI_BV_RE.test(bvid)) continue;
    const key = bvid.toUpperCase();
    if (excluded.has(key)) continue;
    const title = cleanText(row.title, MAX_TITLE_CHARS);
    const uploader = cleanText(row.uploader, MAX_UPLOADER_CHARS);
    const description = cleanText(row.description, MAX_DESC_CHARS);
    // 每条都要有来自搜索响应的标题、UP 主与简介，避免用模型或占位文案补造事实。
    if (!title || !uploader || !description) continue;
    excluded.add(key);
    picked.push({
      bvid,
      title,
      uploader,
      url: `https://www.bilibili.com/video/${bvid}`,
      description,
      durationSeconds: toCount(row.durationSeconds),
      publishTime: toCount(row.publishTime),
      playCount: toCount(row.playCount)
    });
    if (picked.length >= limit) break;
  }
  return picked;
}

/** 近推 BV 记录：新推的追加到末尾，超上限裁掉最旧的，写盘前统一大写去重。 */
export function mergeRecentBvids(previous, added, limit = MAX_RECENT_BVIDS) {
  const cap = Math.max(1, Math.round(Number(limit) || MAX_RECENT_BVIDS));
  const out = [];
  const push = (value) => {
    const bvid = String(value ?? '').trim();
    if (!BILI_BV_RE.test(bvid)) return;
    const key = bvid.toUpperCase();
    if (out.some((x) => x.toUpperCase() === key)) return;
    out.push(bvid);
  };
  for (const value of Array.isArray(previous) ? previous : []) push(value);
  for (const value of Array.isArray(added) ? added : []) push(value);
  return out.slice(-cap);
}

/** 失败退避：15 分钟起翻倍，上限 6 小时（连续失败不刷屏、也不放弃整天）。 */
export function computeBackoffMs(streak) {
  const n = Math.max(1, Math.floor(Number(streak) || 1));
  return Math.min(6 * 60 * 60 * 1000, 15 * 60 * 1000 * 2 ** (n - 1));
}

/** mm:ss / h:mm:ss，仅用于提示词里的「时长」事实。 */
export function formatDuration(seconds) {
  const total = toCount(seconds);
  if (!total) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
