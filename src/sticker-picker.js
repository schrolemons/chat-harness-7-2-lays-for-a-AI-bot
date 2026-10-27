// 表情挑选组件（sticker picker）
//
// 以前「发哪张表情」完全靠模型在一长串备注里自己挑，结果经常在同一个语境反复发同一张，
// 或者挑一张完全不搭的。这里按语境关键词给收藏表情打分排序，直接给出本轮 top 3
// （带一句为什么合适），模型只需在候选里选或全部不用。
//
// 只排序、不发送；不改变「这轮要不要发表情」的开关（那在 bridge.js 里按概率掷）。

const CONTEXT_RULES = [
  { re: /(吃|饭|饿|馋|鸡腿|奶茶|夜宵|外卖|午饭|晚饭|早饭)/, tags: ['吃', '馋', '饭'], weight: 3 },
  { re: /(牛奶|大海|海洋|泡泡|浪花)/, tags: ['牛奶', '鲸鱼', '海洋', '泡泡'], weight: 2 },
  { re: /(没钱|穷|贵|花钱|涨|账单|工资)/, tags: ['钱', '心疼', '要米'], weight: 3 },
  { re: /(哈哈|笑死|草|离谱|乐|绷不住|难绷)/, tags: ['笑', '乐', '吃瓜'], weight: 2 },
  { re: /(累|困|睡|摸鱼|躺|加班|熬夜)/, tags: ['睡', '累', '摸鱼', '躺'], weight: 3 },
  { re: /(生气|气死|烦|讨厌|滚|哼)/, tags: ['生气', '摇头', '哼'], weight: 3 },
  { re: /(不对|错|不是|哪有|怎么可能|真的假的)/, tags: ['摇头', '问号', '不对'], weight: 2 },
  { re: /(夸|厉害|牛|赞|可以啊|行啊)/, tags: ['点赞', '害羞', '夸'], weight: 2 },
  { re: /(哭|难受|委屈|呜呜|😭|🥹)/, tags: ['哭', '委屈', '心疼'], weight: 3 },
  { re: /(在吗|早|晚安|来了|你好|上线)/, tags: ['招呼', '到达', '在'], weight: 2 },
  { re: /(期待|等|想要|求|许愿)/, tags: ['期待', '许愿'], weight: 2 },
  { re: /(干杯|庆祝|生日|成功|成了|耶)/, tags: ['干杯', '耶', '庆祝'], weight: 3 },
  { re: /(问号|离谱|啥|啊?？)/, tags: ['问号'], weight: 1 }
];

function normalize(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((e) => (e && typeof e === 'object' ? e : null))
    .filter(Boolean)
    .map((e) => ({
      id: e.id,
      desc: String(e.desc || ''),
      localNote: String(e.localNote || ''),
      tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
      usage: String(e.usage || ''),
      useCount: Number(e.useCount) || 0,
      lastUsedAt: Number(e.lastUsedAt) || 0
    }));
}

function haystack(entry) {
  return [entry.desc, entry.localNote, entry.usage, ...entry.tags].join(' ');
}

/**
 * @param {{ entries: object[], incomingText?: string, recentStickerIds?: string[], now?: number, serious?: boolean, limit?: number }} opts
 * @returns {{ picks: {entry: object, score: number, reason: string}[], line: string }}
 */
export function pickStickers(opts = {}) {
  const entries = normalize(opts.entries);
  if (!entries.length) return { picks: [], line: '' };
  const text = String(opts.incomingText ?? '');
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const recentIds = (Array.isArray(opts.recentStickerIds) ? opts.recentStickerIds : []).map(String);
  const limit = Math.max(1, Math.min(5, Number(opts.limit) || 3));
  if (opts.serious) {
    return { picks: [], line: '【表情候选】本轮是正事/情绪话题，不建议发表情。' };
  }

  const scored = [];
  for (const e of entries) {
    const hay = haystack(e);
    let score = 0;
    const reasons = [];
    for (const rule of CONTEXT_RULES) {
      if (!rule.re.test(text)) continue;
      const tagHit = rule.tags.some((t) => hay.includes(t));
      if (tagHit) { score += rule.weight; reasons.push('语境贴合'); break; }
    }
    // 本体系列优先（默认形象）
    if (/^大肥鱼/.test(e.desc)) continue; // 旧人设系列只在明确点名时手动选择
    if (/^(?:正太小肥鱼|小鲸鱼)/.test(e.desc)) score += 1;
    // 越久没用越靠前；用得太多的轻微降权
    const ageMin = e.lastUsedAt ? (now - e.lastUsedAt) / 60000 : 100000;
    score += Math.min(2, ageMin / 1440);
    score -= Math.min(1.5, e.useCount * 0.05);
    // 最近发过的明显降权（30 分钟内）
    if (recentIds.includes(String(e.id))) score -= 3;
    // 没备注的降权（模型不一定认得）
    if (!e.desc && !e.localNote) score -= 1;
    scored.push({ entry: e, score: Math.round(score * 100) / 100, reason: reasons.join('、') || '通用' });
  }
  scored.sort((a, b) => b.score - a.score);
  const picks = scored.slice(0, limit);
  if (!picks.length) return { picks: [], line: '' };
  const lines = picks.map((p) => `- ${p.entry.desc || p.entry.localNote || '（无备注）'}（${p.reason}）`);
  const line = '【表情候选（按语境排好，挑一张或不发）】\n' + lines.join('\n') + '\n（只能从这里挑；都不合适就别发，别硬凑。）';
  return { picks, line };
}
