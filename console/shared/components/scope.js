// These are plugin configuration scopes, not the scope of the data editors below them.
const LOCAL = new Set(['exec-browser-manager','exec-image-generation','life-campus-watch','tool-user-checking','tool-codex-chat']);
const NOTES = {
  'ctx-user-mood':'心情分数、每日恢复和回应等待按会话分别记录。',
  'ctx-memory-profile-store':'下方档案正文按 QQ 号单独保存。',
  'ctx-knowledge-quota':'实际用量按设定的会话或发言人分别累计。',
  'life-proactive-time-bubble':'上方具体时段按选中的会话单独保存。',
  'ctx-chat-topic-drive':'下方可为某个私聊设置更严格的限制。',
  'life-schedule-reminder':'单条日程的收件会话和覆盖值单独保存。',
  'life-campus-watch':'本机监控与脚本配置；消息只投递到配置中的目标会话。',
  'exec-image-generation':'本机 API 服务、额度与密钥；密钥单独保存，普通参数按钮不修改密钥。',
  'obs-cost-policy':'小鲸鱼全局调用规则；不改写 DSH 的全局默认模型设置。'
};
export function componentScope(id, label) {
  const prefix = LOCAL.has(id) ? '本机' : '全局';
  const action = label || '保存功能设置';
  return { label: prefix === '本机' ? '本机配置' : '全局规则',
    description: NOTES[id] || (prefix === '本机' ? '配置保存在本机，供此 bot 的相关功能使用。' : '适用于此 bot 符合条件的会话；不修改下方单个会话或人物的内容。'),
    saveLabel: action.includes(prefix) ? action : action.replace(/^保存/, '保存' + prefix)
  };
}
