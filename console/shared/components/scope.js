// These are plugin configuration scopes, not the scope of the data editors below them.
const LOCAL = new Set(['exec-browser-manager','exec-image-generation','life-campus-watch','tool-user-checking','tool-codex-chat']);
const NOTES = {
  'tool-user-checking':'所有会话共用这一份桌面txt，不按群拆分，也不把内容发送到QQ。',
  'obs-session-recovery':'失败次数、冷却和24小时上限按群分别记录。仅归档并重建故障群的模型会话，记忆、心情、日程与消息收据保留。',
  'ctx-user-mood':'心情分数、每日恢复和回应等待按会话分别记录。',
  'ctx-memory-profile-store':'下方档案正文按 QQ 号单独保存。',
  'ctx-knowledge-quota':'实际用量按设定的会话或发言人分别累计。',
  'life-proactive-time-bubble':'上方具体时段按选中的会话单独保存。',
  'ctx-chat-topic-drive':'下方可为某个私聊设置更严格的限制。',
  'life-schedule-reminder':'单条日程的收件会话和覆盖值单独保存。',
  'life-campus-watch':'本机监控与脚本配置；消息只投递到配置中的目标会话。',
  'exec-image-generation':'本机 API 服务、额度与密钥；密钥单独保存，普通参数按钮不修改密钥。',
  'obs-cost-policy':'AI助手会话、主动处理及独立任务共用的唯一调用策略。保存后同步已有会话与未完成任务；正在生成的请求不追溯切换，后续请求使用新档位。复杂或明确指定的任务按本面板升级规则执行。DSH 自动上下文压缩摘要保持独立档位。'
};
export function componentScope(id, label) {
  const prefix = LOCAL.has(id) ? '本机' : '全局';
  const action = label || '保存功能设置';
  return { label: prefix === '本机' ? '本机配置' : '全局规则',
    description: id==='life-campus-watch'&&action.includes('脚本')?'本机脚本地址与逐项启停；执行和搜索细节按开发者与 AI 的约定处理。':id==='life-campus-watch'?'本机网页监控配置；通知发送到配置的目标会话。':NOTES[id] || (prefix === '本机' ? '配置保存在本机，供此 bot 的相关功能使用。' : '适用于此 bot 符合条件的会话；不修改下方单个会话或人物的内容。'),
    saveLabel: action.includes(prefix) ? action : action.replace(/^保存/, '保存' + prefix)
  };
}
