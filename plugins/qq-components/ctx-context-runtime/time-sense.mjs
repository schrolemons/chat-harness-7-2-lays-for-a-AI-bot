// Message age informs wording; admission, topic choice and round closure have other owners.
import {describeAge} from '../../../src/qq-model-view.js';
const clock = ms => new Date(Number(ms)).toLocaleTimeString('zh-CN', {timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
const timeOf = message => Number(message?.time) || 0;
export function buildTimeSense(st, wake = {}, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const messages = [...(Array.isArray(st?.unread) ? st.unread : []), ...(Array.isArray(st?.recentMessages) ? st.recentMessages : [])];
  const newest = messages.filter(m => m && !m.isSelf && timeOf(m) > 0).reduce((last,m) => !last || timeOf(m) > timeOf(last) ? m : last, null);
  if (!newest) return '';
  const ageText = options.ageText || describeAge(newest.time, now);
  if (!ageText) return '';
  const bounded = (value,fallback,min,max) => Number.isFinite(Number(value)) && Number(value) >= min ? Math.min(max,Math.round(Number(value))) : fallback;
  const chatMin = bounded(wake.staleChatMinutes,10,1,600), silentMin = Math.max(chatMin,bounded(wake.staleSilentMinutes,120,5,2880));
  const ageMin = Math.max(0,Math.floor((now-timeOf(newest))/60000));
  const lines = [
    `【时间感】现在是 ${clock(now)}，最近一条来自「${String(newest.sender || '未知')}」，是 ${ageText} 之前发的（${clock(newest.time)}）。最新来信在近期原文与未完成队列中按时间选取，不让旧队列盖过新消息。`,
    '- 消息里的at是北京时间，ago是实际经过时间；历史不当成刚来信，不把自己的起床、睡眠或在线时间当成用户的作息。',
    `- ${chatMin} 分钟内：按实时对话理解。`,
    `- ${chatMin}~${silentMin} 分钟：先核对话题是否仍相关，不冒充刚发生，不必机械询问“还在吗”。`,
    `- 超过 ${silentMin} 分钟：只表示需要谨慎核对时效；仍相关的待答问题按真实需求处理。已获主动机会时，可以自然延续今天或上一段尚有意义的话题，也可按话题选择换题。`,
    '- 时间阈值不授予主动机会，也不自动结束聊天；结束服从公共等待工具的endRound。收据按真实处理凭据报告，不因时间过去就伪报完成或已回复。'
  ];
  if (ageMin >= chatMin) lines.push(`⚠️ 缓存过期提醒：最近来信是 ${ageText} 前；不当成“刚刚”的消息，也不据此丢弃仍有效的问题或禁止本轮获准的主动接续。`);
  return lines.join('\n');
}
