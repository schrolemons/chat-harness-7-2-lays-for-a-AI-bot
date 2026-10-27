// 共享的敏感信息审计正则：桥接回复、MCP 发送、审批/提问文本等统一使用，避免两处维护不一致。
// 拦截本机路径/凭据特征；凭据关键词需带赋值关系才判定，避免误伤正常聊天。
// UNC 的主机/共享名之间只有一个反斜杠；JSON 键名可能带引号。
// 这是内容审计的启发式规则，不能代替会话权限控制或对已知令牌的精确拦截。
//
// 两道内容闸门是**有意互补**的，不是重复实现：
//   ① 这里（启发式）：抓"长得像路径 / 像凭据赋值"的文本，任何一条出站文本都能过；
//   ② KNOWN_AGENT_TOKENS 精确名单（bridge.js）：抓**已知的**会话令牌原文，
//      覆盖 onebotSend / redactKnownTokensOnly 这类刻意不跑 SENSITIVE_RE 的发送路径。
// 为什么第二条不可省：32 位十六进制的裸会话令牌**不匹配**下面的正则（它既不是路径，
// 也没有 token= 这种赋值形态），只有精确名单能拦住它。
// 反过来，**不要**为了让这条正则"顺带"覆盖裸 32-hex 而往里加 [0-9a-f]{32}：
// 表情 md5、图片 URL、消息里的十六进制串本身就是 32-hex，加进去会把正常的表情包与消息
// 整条拦掉/打码（误伤面远大于收益）。要收紧令牌泄漏，请走精确名单那条路。
export const SENSITIVE_RE = /((?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>|]+|\\\\[^\\\s"'<>|]+\\[^\s"'<>|]+|(?<![A-Za-z0-9])(?:\/home\/|\/Users\/|\/etc\/|\/var\/|\/root\/)[^\s"'<>|]*|(?:token|密码|密钥|口令|password|passwd|secret|api[_-]?key|authorization|bearer|access[_-]?key|credential)["']?(?:\s*(?:[:=：]|是|为)\s*["']?[^\s，。；、"']{3,}|\s+[A-Za-z0-9_\-./]{3,}))/i;

export const DEFAULT_SENSITIVE_RULES = Object.freeze([
  /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>|]+/i,
  /\\\\[^\\\s"'<>|]+\\[^\s"'<>|]+/i,
  /(?<![A-Za-z0-9])(?:\/home\/|\/Users\/|\/etc\/|\/var\/|\/root\/)[^\s"'<>|]*/i,
  /(?:token|密码|密钥|口令|password|passwd|secret|api[_-]?key|authorization|bearer|access[_-]?key|credential)["']?(?:\s*(?:[:=：]|是|为)\s*["']?[^\s，。；、"']{3,}|\s+[A-Za-z0-9_\-./]{3,})/i
].map((re, index) => Object.freeze({
  id: ['windows-path', 'unc-path', 'unix-path', 'credential-assignment'][index],
  label: ['Windows 本机路径', 'UNC 网络路径', 'Unix 本机路径', '凭据赋值'][index],
  pattern: re.source,
  flags: re.flags,
  enabled: true
})));

const RULE_FLAGS = new Set(['i', 'm', 's', 'u']);
const sensitiveRuleCache = new Map();

function normalizeSensitiveRules(rules) {
  if (!Array.isArray(rules)) throw new Error('出站规则必须是列表');
  if (rules.length > 100) throw new Error('出站规则最多 100 条');
  const ids = new Set();
  return rules.map((rule, index) => {
    const id = String(rule?.id || `outbound-${index + 1}`).trim();
    const label = String(rule?.label || '').trim();
    const pattern = String(rule?.pattern ?? '');
    const flags = String(rule?.flags || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) || ids.has(id)) throw new Error('出站规则 ID 无效或重复');
    ids.add(id);
    if (!label || label.length > 80) throw new Error(`出站规则 ${id} 的名称须为 1–80 字`);
    if (!pattern || pattern.length > 1500) throw new Error(`出站规则「${label}」的正则须为 1–1500 字`);
    if ([...flags].some(flag => !RULE_FLAGS.has(flag)) || new Set(flags).size !== flags.length) throw new Error(`出站规则「${label}」的 flags 只允许 i、m、s、u 且不能重复`);
    try { new RegExp(pattern, flags); } catch (error) { throw new Error(`出站规则「${label}」正则无效：${error.message}`); }
    return { id, label, pattern, flags, enabled: rule.enabled !== false };
  });
}

export function validateSensitiveRules(rules) {
  return normalizeSensitiveRules(rules);
}

export function resolveSensitiveRules(rules) {
  if (rules === undefined || rules === null) return DEFAULT_SENSITIVE_RULES.map(rule => ({ ...rule }));
  try { return normalizeSensitiveRules(rules); }
  catch { return DEFAULT_SENSITIVE_RULES.map(rule => ({ ...rule })); }
}

function compileSensitiveRules(rules) {
  const definitions = resolveSensitiveRules(rules).filter(rule => rule.enabled);
  const key = JSON.stringify(definitions);
  if (sensitiveRuleCache.has(key)) return sensitiveRuleCache.get(key);
  const compiled = definitions.map(rule => ({ ...rule, re: new RegExp(rule.pattern, rule.flags) }));
  if (sensitiveRuleCache.size >= 32) sensitiveRuleCache.clear();
  sensitiveRuleCache.set(key, compiled);
  return compiled;
}

/** 检测内置路径/凭据特征与管理员追加的出站敏感词。 */
export function isSensitiveText(text, extraTerms = [], rules = undefined) {
  const source = String(text ?? '');
  if (rules === undefined ? SENSITIVE_RE.test(source) : compileSensitiveRules(rules).some(rule => rule.re.test(source))) return true;
  const lower = source.toLocaleLowerCase();
  return (Array.isArray(extraTerms) ? extraTerms : []).some((term) => {
    const value = String(term ?? '').trim();
    return value.length >= 2 && lower.includes(value.toLocaleLowerCase());
  });
}
