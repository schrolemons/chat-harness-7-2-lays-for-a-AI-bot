// 运行时上下文（纯函数）：参与度提示 + 时间感提示。
// 从 bridge.js 的 formatParticipationV2 / buildTimeSenseLine 抽出，供 ctx-context-runtime 组件调用；
// 桥接只负责传 st、directUnread（说了“你/AI”的未读数）和 wake 配置。

const pad2 = (n) => String(n).padStart(2, '0');

import { describeAge } from './qq-model-view.js';

export function localClockText(ms) {
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function timeSenseConfig(wake = {}) {
  const boundedMin = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min ? Math.min(max, Math.round(n)) : fallback;
  };
  const chatMin = boundedMin(wake.staleChatMinutes, 10, 1, 600);
  const silentMin = Math.max(chatMin, boundedMin(wake.staleSilentMinutes, 120, 5, 2880));
  return { chatMin, silentMin };
}

/** 参与度提示：这一小时我说了多少、群友说了多少、最近热度如何。 */
export function buildParticipation(st, directUnread = 0, now = Date.now()) {
  if (!st) return '';
  const hour = 60 * 60 * 1000;
  const fiveMin = 5 * 60 * 1000;
  const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
  const aiCount = recent.filter((m) => m && m.isSelf && now - (Number(m.time) || 0) < hour).length;
  const otherCount = recent.filter((m) => m && !m.isSelf && now - (Number(m.time) || 0) < hour).length;
  if (!aiCount && !otherCount) return '';
  const fiveMinOthers = recent.filter((m) => m && !m.isSelf && now - (Number(m.time) || 0) < fiveMin);
  const activeSenders = new Set(fiveMinOthers.map((m) => m && (m.sender || m.user_id || '?'))).size;
  const lastAiGap = now - (Number(st.lastAiReplyAt) || 0);
  const recentAi2m = recent.filter((m) => m && m.isSelf && now - (Number(m.time) || 0) < 2 * 60 * 1000).length;

  let hint = '';
  if (directUnread > 0) hint = '有人直接找你，优先回应，其他话题想接再接。';
  else if (recentAi2m >= 2) hint = '你刚已经连发过几句了，别继续刷屏；直接潜水也不亏，值得接才补一句。';
  else if (lastAiGap < 120000) hint = '别人说了一句，上一句如果有能接住的话就自然接；别硬凑第二句。';
  else if (aiCount >= 5) hint = '你最近说得偏多，这次可以少说两句或干脆不说，把话留给别人说。';
  else if (fiveMinOthers.length >= 10 || (fiveMinOthers.length >= 6 && activeSenders >= 3)) hint = `群里很热（最近5分钟${fiveMinOthers.length}条${activeSenders ? `/${activeSenders}人` : ''}在聊），不用急着插话；有值得接的一句再进，插不进就潜水。`;
  else if (otherCount >= 10 && aiCount === 0) hint = '群里好像没人等你，可以插一句有趣的，或者只挑一句说。';
  else if (otherCount < 3 && aiCount > 0) hint = '群里有点冷，需要一个人撑场；有新想法时可以开口补一句。';
  else if (aiCount <= 1 && otherCount >= 10) hint = '你可以只探一句，或潜水接下一轮话题。';

  const burstText = fiveMinOthers.length ? `，最近5分钟群友 ${fiveMinOthers.length} 条${activeSenders ? `/${activeSenders}人` : ''}` : '';
  return `【参与度参考】你最近 1 小时说了 ${aiCount} 次，群友发了 ${otherCount} 条${burstText}。${hint}`;
}

/** 时间感：最近一条来信多久前、什么钟点，以及不同时效下该怎么接。 */
export function buildTimeSense(st, wake = {}, options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const newest = [...(Array.isArray(st?.unread) ? st.unread : [])].reverse().find((m) => m && !m.isSelf)
    || [...(Array.isArray(st?.recentMessages) ? st.recentMessages : [])].reverse().find((m) => m && !m.isSelf)
    || null;
  if (!newest) return '';
  const ageText = options.ageText || describeAge(newest.time, now);
  if (!ageText) return '';
  const { chatMin, silentMin } = timeSenseConfig(wake);
  const sender = String(newest.sender || '未知');
  const ageMin = Math.max(0, Math.floor((now - Number(newest.time)) / 60000));
  const staleNow = ageMin >= chatMin;
  const tooOld = ageMin >= silentMin;
  const lines = [
    `【时间感】先看消息多久前，再决定怎么接：现在是 ${localClockText(now)}，最近一条来自「${sender}」，是 ${ageText} 之前发的（${localClockText(newest.time)}）。`,
    '- 消息里的 at 是北京时间、ago 是相对现在多久，判断前先确认现在几点、消息的 ago，不要凭感觉当成“刚刚”。',
    `- ${chatMin} 分钟内（尤其几分钟内）：按实时对话接。`
  ];
  if (silentMin > chatMin) {
    lines.push(`- ${chatMin}~${silentMin} 分钟：可以接，但别用“刚”“今天刚看到”这类实时口吻；先确认对方还在不在、这个话题还在不在。`);
  }
  lines.push(`- 超过 ${silentMin} 分钟：默认不接，直接 qq_mark_read 收尾；只有对方明确在等你/在叫你、或最后一轮提到你时才回，并且开头要有时效感（“刚看到”“刚忙完才看到”）。`);
  if (staleNow) {
    lines.push(`⚠️ 缓存过期提醒：最近一条消息已经是 ${ageText} 前（${tooOld ? `超过 ${silentMin} 分钟` : `超过 ${chatMin} 分钟`}），不要当新鲜消息接，也不要把别人的旧话题当成现在的新接。`);
  }
  return lines.join('\n');
}
