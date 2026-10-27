const SKIP_REASON = /^(selfReview|selfOptimize|memoryWrite|timeBubble|startupGreeting|reminder|newFriend|newsShare|careCheck|idleRescue|proactiveCheck|replyCheck|taskDone|taskQuestion)/;
const RISK = /(我|自己).{0,8}(不想活|想死|想自杀|要自杀|准备自杀|想自残|已经自残|已经割伤|已经吞药|打算结束生命)|活不下去|不想活了|撑不下去了/;
const EXPLICIT = /(?:^|\s)\/phi(?:\s|$)|(?:进入|开启|使用|切换到)?\s*phi\s*模式/i;
const EXIT = /\/phi\s+(off|exit)\b|退出\s*phi|关闭\s*phi|别讲哲学/i;

export function pickText(payload) {
  const unread = payload.st?.unread;
  if (Array.isArray(unread) && unread.length) return unread.filter(m => m && !m.isSelf).slice(-8).map(m => [m.plain ?? m.text ?? '', m.tail ?? ''].join('\n')).join('\n').slice(-16000);
  return String(payload.incomingText || '').slice(0, 16000);
}

/** Shared S/C classifier; it reads no cards and stores no psychological information. */
export function createRouter(config) {
  if (!Array.isArray(config.coreSessionKeys) || !config.coreSessionKeys.every(k => typeof k === 'string' && /^(private|group):[1-9]\d*$/.test(k))) throw Error('Invalid coreSessionKeys');
  const core = new Set(config.coreSessionKeys);
  const patterns = name => {
    if (!Array.isArray(config[name]) || !config[name].every(s => typeof s === 'string' && s.length <= 300)) throw Error(`${name} must be a string array`);
    return config[name].map(s => new RegExp(s, 'i'));
  };
  const worldview = patterns('worldviewPatterns'), care = patterns('coreCarePatterns');
  return (payload = {}) => {
    if (payload.hasUnreadNow === false || SKIP_REASON.test(String(payload.reason || ''))) return { mode: 'off', reason: 'no-new-conversation-input' };
    const text = pickText(payload);
    if (RISK.test(text)) return { mode: 'safety_support', reason: 'possible-current-danger-not-a-diagnosis' };
    if (EXIT.test(text)) return { mode: 'off', reason: 'user-exit' };
    if (EXPLICIT.test(text) || worldview.some(p => p.test(text))) return { mode: 'phi', reason: 'explicit-or-worldview' };
    if (core.has(payload.key) && care.some(p => p.test(text))) return { mode: 'care', reason: 'core-current-concern' };
    return { mode: 'off', reason: 'ordinary-conversation' };
  };
}
