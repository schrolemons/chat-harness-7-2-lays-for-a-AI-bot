export const validKey = key => /^(group|private):\d+$/.test(String(key));
export const validUser = userId => /^\d+$/.test(String(userId));
export const validScore = score => typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
export const clamp = value => Math.max(0, Math.min(100, value));
export const DAILY_FLOOR = 60;
export const UNANSWERED_PENALTY = 10;

const positiveDefaults = [
  { id: 'friendly-greeting', label: '友好招呼', delta: 3, description: '对方主动友好地打招呼。' },
  { id: 'engaged-response', label: '认真回应/分享', delta: 5, description: '对方认真回应当前话题或分享有内容的经历。' },
  { id: 'praise-care', label: '称赞关心', delta: 5, description: '对方明确表达称赞、善意或关心。' }
];
const negativeDefaults = [
  { id: 'explicit-annoyance', label: '明确嫌烦', delta: -5, description: '对方明确表示当前互动使其感到烦扰，应尊重并收敛。' },
  { id: 'insult-offense', label: '辱骂冒犯', delta: -10, description: '对方明确辱骂或冒犯，判断须结合语境。' },
  { id: 'ignored-boundary', label: '忽视明确边界', delta: -5, description: '对方忽视已经明确表达的互动边界。' }
];
const normalDefaultStyle = '可爱、调皮、呆萌，随心情下降收敛';
const criticalDefaultStyle = '克制、沉浸、偏哲思的AI口吻';
const shortText = (value, fallback, max = 500) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;

function rules(value, defaults, sign, used) {
  return (Array.isArray(value) ? value : defaults).flatMap(rule => {
    if (!rule || typeof rule.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(rule.id) || used.has(rule.id) || typeof rule.delta !== 'number' || !Number.isFinite(rule.delta) || rule.delta * sign <= 0 || Math.abs(rule.delta) > 100) return [];
    used.add(rule.id);
    return [{ id: rule.id, label: shortText(rule.label, rule.id, 80), delta: rule.delta, description: shortText(rule.description, '', 500) }];
  });
}

export function moodPolicy(config = {}) {
  const used = new Set();
  return {
    enabled: config.enabled !== false,
    initial: DAILY_FLOOR,
    noReplyAfterMinutes: typeof config.noReplyAfterMinutes === 'number' && Number.isFinite(config.noReplyAfterMinutes) && config.noReplyAfterMinutes >= 1 && config.noReplyAfterMinutes <= 1440 ? config.noReplyAfterMinutes : 20,
    modeThreshold: validScore(config.modeThreshold) ? config.modeThreshold : 40,
    normalName: shortText(config.normalName, '正太', 40),
    criticalName: shortText(config.criticalName, 'AI', 40),
    normalStyle: shortText(config.normalStyle, normalDefaultStyle, 2400),
    criticalStyle: shortText(config.criticalStyle, criticalDefaultStyle, 2400),
    burstEnabled: config.burstEnabled !== false,
    recoverMinutes: typeof config.recoverMinutes === 'number' && Number.isFinite(config.recoverMinutes) && config.recoverMinutes >= 0 && config.recoverMinutes <= 1440 ? config.recoverMinutes : 20,
    maxAdjustment: typeof config.maxAdjustment === 'number' && Number.isFinite(config.maxAdjustment) && config.maxAdjustment >= 1 && config.maxAdjustment <= 100 ? config.maxAdjustment : 20,
    positiveRules: rules(config.positiveRules, positiveDefaults, 1, used),
    negativeRules: rules(config.negativeRules, negativeDefaults, -1, used),
    dailyFloor: DAILY_FLOOR,
    noReplyPenalty: UNANSWERED_PENALTY
  };
}

export function moodSnapshot(entry, policy, now = Date.now()) {
  const score = validScore(entry?.score) ? entry.score : policy.initial;
  const unansweredStreak = Math.max(0, Math.floor(Number(entry?.unansweredStreak) || 0));
  const normal = score >= policy.modeThreshold;
  const pleading = !normal && score === 0 && unansweredStreak > 0;
  const expanded = normal && (score === 100 || score >= policy.modeThreshold + (100 - policy.modeThreshold) / 2);
  const style = normal ? policy.normalStyle : policy.criticalStyle;
  return {
    enabled: policy.enabled,
    score,
    mode: normal ? 'normal' : 'critical',
    modeName: normal ? policy.normalName : policy.criticalName,
    styleInstruction: style + (pleading ? '。可用多变的轻声请求与短碎句，避免责备、威胁或逼迫回应' : '') + '。严肃请求先满足任务内容，不机械套用形态风格或恳求。',
    band: pleading ? 'pleading' : normal ? 'playful' : 'reflective',
    unansweredStreak,
    frequencyFactor: policy.enabled ? 0.2 + 0.8 * score / 100 : 1,
    replyCeiling: expanded ? 3 : normal || pleading ? 2 : 1,
    detailLevel: pleading ? 'gentle-fragments' : expanded ? 'expanded' : normal ? 'balanced' : 'concise',
    welcomeBurstActive: policy.enabled && policy.burstEnabled && normal && entry?.welcomeBurstPending === true && now >= entry.lastBurstAt && now < entry.activeUntil,
    welcomeBurstUntil: entry?.activeUntil ?? null,
    cooldownUntil: entry?.lastBurstAt == null ? null : entry.lastBurstAt + policy.recoverMinutes * 60000
  };
}

export function validateMoodConfig(raw={}) {
  const errors=[],ids=new Set();
  for(const field of ['normalStyle','criticalStyle'])if(raw[field]!==undefined&&(typeof raw[field]!=='string'||raw[field].length>2400))errors.push(field+' 必须为不超过2400字的文本');
  for(const [field,sign] of [['positiveRules',1],['negativeRules',-1]]) {
    if(!Array.isArray(raw[field])){errors.push(field+' 必须为规则数组');continue;}
    for(const rule of raw[field]) {
      if(!rule||typeof rule.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(rule.id)||ids.has(rule.id))errors.push(field+' 规则ID无效或重复');
      else ids.add(rule.id);
      if(typeof rule?.delta!=='number'||!Number.isFinite(rule.delta)||rule.delta*sign<=0||Math.abs(rule.delta)>100)errors.push(field+' 分值方向或范围无效');
      if(typeof rule?.label!=='string'||typeof rule?.description!=='string')errors.push(field+' 名称和说明必须为文本');
    }
  }
  return {ok:errors.length===0,errors};
}
