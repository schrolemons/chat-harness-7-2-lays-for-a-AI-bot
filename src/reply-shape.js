// 回复形态组件（reply shape）
//
// 「这一轮回几条、是合并成一条还是分条、要不要克制」以前全靠模型临场决定，
// 结果同一话题时而一整段小作文、时而三连碎句。这里把它变成确定性判定：
// 根据话题性质（严肃/普通/调侃）、对方消息长度、心情、最近是否刚连发，
// 直接给出这一轮的条数上限与写法要求，由桥接写进唤醒提示词。

const SERIOUS_RE = /(报错|异常|崩溃|崩溃了|bug|修复|代码|部署|配置|token|密钥|密码|隐私|权限|日志|数据库|接口|服务器|作业|论文|考试|课程|讲座|面试|合同|医院|生病|发烧|法律|借钱|退款|赔偿)/i;
const LOW_MOOD_RE = /(难受|难过|好累|累死|烦死|崩溃|想哭|压力好大|不想活|失眠|焦虑|心情不好)/;

export const DEFAULT_REPLY_SHAPE = {
  enabled: true,
  maxMessagesNormal: 2,
  maxMessagesCasual: 3,
  maxMessagesSerious: 1,
  longIncomingChars: 60
};

function pickConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_REPLY_SHAPE;
  const num = (v, f, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : f;
  };
  return {
    enabled: src.enabled !== false,
    maxMessagesNormal: num(src.maxMessagesNormal, d.maxMessagesNormal, 1, 3),
    maxMessagesCasual: num(src.maxMessagesCasual, d.maxMessagesCasual, 1, 3),
    maxMessagesSerious: num(src.maxMessagesSerious, d.maxMessagesSerious, 1, 3),
    longIncomingChars: num(src.longIncomingChars, d.longIncomingChars, 20, 500)
  };
}

/**
 * @param {{ state: object, incomingText?: string, mood?: number, moodLowThreshold?: number, config?: object }} opts
 * @returns {{ kind: 'serious'|'casual'|'normal', maxMessages: number, line: string }}
 */
export function planReplyShape(opts = {}) {
  const cfg = pickConfig(opts.config);
  const st = opts.state && typeof opts.state === 'object' ? opts.state : {};
  const text = String(opts.incomingText ?? '').trim();
  const mood = Number(opts.mood);
  const moodLow = Number.isFinite(Number(opts.moodLowThreshold)) ? Number(opts.moodLowThreshold) : 40;
  const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const aiBurst2m = recent.filter((m) => m && m.isSelf && now - (Number(m.time) || 0) < 2 * 60 * 1000).length;

  if (!cfg.enabled) return { kind: 'normal', maxMessages: cfg.maxMessagesNormal, line: '' };

  const serious = SERIOUS_RE.test(text) || text.length > cfg.longIncomingChars || LOW_MOOD_RE.test(text);
  const casual = !serious && (/(哈哈|嘿嘿|草|笑死|梗|大肥鱼|肥鱼|白饭|token|贴贴|好耶|🐟|🍚)/i.test(text) || text.length <= 6);

  let kind = serious ? 'serious' : casual ? 'casual' : 'normal';
  let max = kind === 'serious' ? cfg.maxMessagesSerious : kind === 'casual' ? cfg.maxMessagesCasual : cfg.maxMessagesNormal;

  // 心情低 / 刚连发过：这一轮压到 1 条，别刷屏。
  if ((Number.isFinite(mood) && mood < moodLow) || aiBurst2m >= 2) max = Math.min(max, 1);

  const moodLowNow = Number.isFinite(mood) && mood < moodLow;
  const why = moodLowNow ? '心情偏低' : aiBurst2m >= 2 ? '你刚才已经连发好几条' : kind === 'serious' ? '对方在说正事/情绪明显不好' : kind === 'casual' ? '轻松闲聊' : '普通话题';
  const how = max === 1
    ? '合并成一条说完，别拆碎句'
    : max === 2
      ? '一条一个意群，长句先砍短'
      : '短句分条，别写小作文';
  const line = `【本轮节奏】${why}，这一轮最多 ${max} 条，${how}。超过就砍，宁短勿全。`;
  return { kind, maxMessages: max, line };
}
