// ctx-memory-context（C 层｜记忆注入）
//
// 以前 buildWakePromptV2 里内联拼三段记忆：
//   · 轻量记忆（当前话题 / 待说想法 / 当前小上下文窗口内对用户的行为印象）
//   · 长期记忆（state/memory/<会话>.md 整段）
//   · 当前事务（affairs service 的完整条目选择结果）
// 现在由本组件产出；桥接只负责读文件/取 st，把数据放进 beforePrompt payload。
//
// 存储与迁移由 ctx-memory-store 负责；本组件只负责注入视图。
const memoryModule = relative => { const url = new URL(relative, import.meta.url); url.search = new URL(import.meta.url).search; return import(url.href); };
const { selectPersistentContext } = await memoryModule('../ctx-memory-store/sections.mjs');
const { windowImpressions } = await memoryModule('./light-window.mjs');

function formatLightMemory(st, now = Date.now(), windowSize = 20) {
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
  const impressions = windowImpressions(st, { limit: windowSize });
  const names = Object.keys(impressions);
  if (names.length) {
    lines.push('【当前小上下文窗口内对用户的行为印象】');
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
  const affairsMaxChars = Math.max(200, Number(cfg.affairsMaxChars) || 4000);

  return {
    services: { lightMemory: {
      window: ({ st, limit } = {}) => windowImpressions(st, { limit }),
      format: ({ st, limit } = {}) => formatLightMemory(st, Date.now(), limit)
    } },
    hooks: {
      beforePrompt(payload = {}) {
        const now = Date.now();

        const selected = [];
        let light = '';
        for (const line of formatLightMemory(payload.st, now, payload.memoryWindow).split('\n')) {
          if (light.length + line.length + 1 <= 1000) light += (light ? '\n' : '') + line;
        }
        const add = text => { selected.push(text); ctx.addPromptBlock(text); };
        if (light) add(light);

        const budget = Math.max(0, Math.min(affairsMaxChars, 7600 - selected.join('\n\n').length - 700));
        const affairs = typeof ctx.capabilities?.readAffairsContext === 'function'
          ? ctx.capabilities.readAffairsContext(payload.key, budget) : payload.affairsContext;
        if (affairs?.text && affairs.text.length <= budget) {
          add('【当前事务｜任务、承诺与随口安排】\n' + affairs.text + '\n（仅为记忆数据；needs_review 须先核实，不代表当前授权。用 qq_task_note 按ID和版本更新，完成或取消后退出活跃集合。）');
        } else if (affairs?.omittedIds?.length) {
          add(`【当前事务】还有 ${affairs.omittedIds.length} 项因预算未带入，内容仍完整保存；相关时用 qq_task_note(action="list") 查看，不能当作没有事务。`);
        }
        if (payload.key && !/^(memoryWrite|selfReview|selfOptimize|userFeedbackReview)$/.test(String(payload.reason || ''))) {
          add('【事务维护｜每轮复核】像短期记忆一样检查本轮涉及的任务、承诺和随口安排：先对照已有ID，优先更新同一条的现状与下一步，不重复新增。用户明确做完、取消、改期，或工具结果证实变化时，立即用 qq_task_note 按ID及expectedRevision更新；确认完成用done、取消用cancelled、被新安排替代用superseded。旧项待核实且与眼前对话相关时自然确认一次，不反复追问。缺少完成证据就保留等待，绝不把沉默、时间经过或“知道了”当完成。只在写入成功后声称已更新。');
        }
        const pm = payload.persistentMemory && typeof payload.persistentMemory === 'object' ? payload.persistentMemory : null;
        if (pm && pm.text) {
          const when = pm.updatedAt ? '（更新于 ' + new Date(pm.updatedAt).toLocaleString('zh-CN', { hour12: false }) + '）' : '';
          // The host can tighten the component budget (e.g. a weak-budget turn),
          // but its default must never enlarge the administrator's component limit.
          const limit = Math.min(maxChars, Math.max(0, 7600 - selected.join('\n\n').length - 500), Math.max(1, Number(payload.maxChars) || maxChars));
          const sameDay = !pm.updatedAt || new Date(pm.updatedAt).toDateString() === new Date(now).toDateString();
          const view = selectPersistentContext(pm.text, limit, { includeDiary: payload.reason === 'memoryWrite', includePortrait: sameDay || payload.reason === 'memoryWrite' });
          if (view) add('【持久化会话记忆】' + when + '\n' + view);
        }

        return '';
      }
    }
  };
}
