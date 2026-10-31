// 参与度统计。时间感策略的唯一拥有源是 ctx-context-runtime/time-sense.mjs。

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
