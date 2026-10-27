// ctx-memory-context（C 层｜记忆注入）
//
// 以前 buildWakePromptV2 里内联拼三段记忆：
//   · 轻量记忆（当前话题 / 待说想法 / 未发言成员临时印象）
//   · 长期记忆（state/memory/<会话>.md 整段）
//   · 中期记忆（state/memory/tasks-*.md 尾部）
// 现在由本组件产出；桥接只负责读文件/取 st，把数据放进 beforePrompt payload。
//
// 存储（写记忆、<MEMORY> 捕获、定时重写、22:00 日记）仍在桥接，下一批再搬。

function formatLightMemory(st, now = Date.now()) {
  if (!st) return '';
  const lines = [];
  const topics = Array.isArray(st.activeTopics) ? st.activeTopics.filter((t) => t && t.text) : [];
  if (topics.length) {
    lines.push('【进行中的话题】');
    for (const t of topics.slice(-10)) {
      if (/^\s*日程\s*[｜|]/.test(String(t.text || ''))) { lines.push('- [日程] ' + t.text); continue; }
      const ago = t.lastMentionAt ? Math.round((now - t.lastMentionAt) / 60000) : 0;
      const stale = t.lastMentionAt && now - Number(t.lastMentionAt) > 2 * 60 * 60 * 1000 ? '（已很久，仅供参考）' : '';
      lines.push(`- ${t.text}${stale}（${ago > 0 ? ago + ' 分钟前' : '刚刚'}）${t.pendingQuestion ? `（想追问：${t.pendingQuestion}）` : ''}`);
    }
  }
  const thoughts = Array.isArray(st.pendingThoughts) ? st.pendingThoughts.filter((t) => t && t.text && (!t.expiresAt || now < t.expiresAt)) : [];
  if (thoughts.length) {
    lines.push('【想说还没说的】');
    for (const t of thoughts.slice(-10)) {
      lines.push(`- ${t.text}${t.motivation ? `（${t.motivation}）` : ''}`);
    }
  }
  const impressions = st.memberImpressions && typeof st.memberImpressions === 'object' ? st.memberImpressions : {};
  const recentSpeakers = new Set();
  for (const messages of [st.unread, st.recentMessages]) {
    if (!Array.isArray(messages)) continue;
    for (const message of messages) {
      if (!message || message.isSelf) continue;
      for (const value of [message.userId, message.user_id, message.sender]) {
        const name = String(value || '').trim().toLocaleLowerCase();
        if (name) recentSpeakers.add(name);
      }
    }
  }
  const names = Object.keys(impressions).filter((name) => !recentSpeakers.has(String(name).trim().toLocaleLowerCase()));
  if (names.length) {
    lines.push('【对本会话未发言成员的临时印象】');
    for (const name of names.slice(-10)) {
      const im = impressions[name] || {};
      const traits = Array.isArray(im.traits) ? im.traits : [];
      lines.push(`- ${name}：${traits.length ? traits.join('、') : '（暂无记录）'}（互动 ${Number(im.interactionCount) || 0} 次）`);
    }
  }
  return lines.join('\n');
}

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const maxChars = Math.max(500, Number(cfg.maxChars) || 4000);
  const midTermSlice = Math.max(200, Number(cfg.midTermSlice) || 1500);

  return {
    hooks: {
      beforePrompt(payload = {}) {
        const now = Date.now();

        const light = formatLightMemory(payload.st, now);
        if (light) ctx.addPromptBlock(light);

        const pm = payload.persistentMemory && typeof payload.persistentMemory === 'object' ? payload.persistentMemory : null;
        if (pm && pm.text) {
          const when = pm.updatedAt ? '（更新于 ' + new Date(pm.updatedAt).toLocaleString('zh-CN', { hour12: false }) + '）' : '';
          ctx.addPromptBlock('【持久化记忆（长期）】' + when + '\n' + String(pm.text).slice(0, Math.max(500, Number(payload.maxChars) || maxChars)));
        }

        const mid = String(payload.midTermText || '').trim();
        if (mid) {
          ctx.addPromptBlock('【中期记忆·任务进度（跨上下文/多次运行）】\n' + mid.slice(-midTermSlice) + '\n（有新的完成项/待办/重要发现，用 qq_task_note 追加；跨上下文重置后先读这里接上进度）');
        }
        return '';
      }
    }
  };
}
