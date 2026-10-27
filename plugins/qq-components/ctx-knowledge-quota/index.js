// ctx-knowledge-quota（C 层｜上下文管理：专业问答配额）
//
// 机主诉求：对**非管理员**的「专业知识提问」设每日上限，问够次数后不硬答，
// 而是用符合当前人设的借口自然带过；计数与判定结果落插件 state，重启不丢。
//
// 判定策略（宁可漏限，不误封）：
//   · 只在「本轮最新一条不是自己发的消息」里找关键词；
//   · 命中关键词 + 出现问句特征（问号 / 怎么 / 为什么 / 如何 / 能不能 / 帮我…）才算专业提问；
//   · 关键词可配置，命中不稳时以「不是专业提问」放行。
//
// 每次用量：默认按会话计（config.countBy = "session"），也可设 "user"（群聊里按发言人计）。

const QMARK = /[?？]|怎么|怎样|为什么|为啥|如何|能不能|可不可以|帮我|求|解释|讲讲|说说|区别/;

function pad2(n) { return String(n).padStart(2, '0'); }

/** 按 resetHour 切日：凌晨 N 点之前仍算前一天，避免"刚过零点就重置"。 */
function dayKey(nowMs, resetHour) {
  const d = new Date(nowMs);
  const h = Number(resetHour) || 0;
  if (h > 0 && d.getHours() < h) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function lastPeerMessage(st) {
  const pools = [Array.isArray(st?.unread) ? st.unread : [], Array.isArray(st?.recentMessages) ? st.recentMessages : []];
  for (const pool of pools) {
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      const m = pool[i];
      if (!m || m.isSelf) continue;
      const text = String(m.text || m.plain || '').trim();
      if (text) return { text, userId: m.userId || m.sender || '' };
    }
  }
  return null;
}

function hitKeywords(text, keywords) {
  const lower = String(text || '').toLowerCase();
  for (const kw of keywords) {
    const k = String(kw || '').trim();
    if (!k) continue;
    if (lower.includes(k.toLowerCase())) return k;
  }
  return '';
}

export function createPlugin(ctx) {
  const config = () => ctx.config || {};

  const stateOf = () => {
    const s = ctx.state.get() || {};
    return {
      day: String(s.day || ''),
      used: s.used && typeof s.used === 'object' ? { ...s.used } : {},
      hits: s.hits && typeof s.hits === 'object' ? { ...s.hits } : {}
    };
  };

  /** 读当前用量（不改状态） */
  function usage(key, nowMs = Date.now()) {
    const cfg = config();
    const day = dayKey(nowMs, cfg.resetHour);
    const st = stateOf();
    const limit = Math.max(0, Number(cfg.dailyLimit) || 0);
    const fresh = st.day === day;
    const used = fresh ? Number(st.used[key] || 0) : 0;
    return { day, limit, used, remaining: Math.max(0, limit - used) };
  }

  /** 控制台/工具用：查全部或某个 key 的用量 */
  function report(key) {
    const cfg = config();
    const st = stateOf();
    const day = dayKey(Date.now(), cfg.resetHour);
    const limit = Math.max(0, Number(cfg.dailyLimit) || 0);
    const fresh = st.day === day;
    if (key) {
      const used = fresh ? Number(st.used[key] || 0) : 0;
      return { ok: true, day, limit, key, used, remaining: Math.max(0, limit - used), enabled: cfg.enabled !== false };
    }
    const entries = Object.entries(fresh ? st.used : {}).map(([k, v]) => ({
      key: k, used: Number(v) || 0, remaining: Math.max(0, limit - (Number(v) || 0))
    }));
    return { ok: true, day, limit, enabled: cfg.enabled !== false, countBy: String(cfg.countBy || 'session'), entries };
  }

  /** 控制台/工具用：清掉今天（或全部）计数 */
  function reset(key) {
    const st = stateOf();
    if (key) {
      const used = { ...st.used };
      delete used[key];
      ctx.state.set({ used });
      return { ok: true, cleared: key };
    }
    ctx.state.set({ day: '', used: {}, hits: {} });
    return { ok: true, cleared: 'all' };
  }

  // 控制台可用 /api/plugins/call 调：{ tool: "knowledge_quota", input: { action, key } }
  if (typeof ctx.registerTool === 'function') {
    ctx.registerTool('knowledge_quota', {
      description: '查看或清空「非管理员专业问答配额」用量（C 层）。action=query 看用量，action=reset 清空。',
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'query（默认）或 reset' },
          key: { type: 'string', description: '私聊 private:QQ号 / 群 group:群号；不传则汇总' }
        }
      },
      handler: (input = {}) => {
        const action = String(input.action || 'query');
        const key = input.key ? String(input.key).trim() : '';
        return action === 'reset' ? reset(key) : report(key);
      }
    });
  }

  return {
    services: {
      knowledgeQuota: { report, reset, usage }
    },
    canWake() { return true; },
    hooks: {
      beforePrompt(payload = {}) {
        const cfg = config();
        if (cfg.enabled === false) return '';
        const key = String(payload.key || '');
        if (!key) return '';
        // 管理员不受限
        if (payload.isOwnerKey && cfg.exemptOwner !== false) return '';

        const last = lastPeerMessage(payload.st);
        if (!last) return '';
        const kw = hitKeywords(last.text, Array.isArray(cfg.keywords) ? cfg.keywords : []);
        if (!kw) return '';
        if (!QMARK.test(last.text)) return ''; // 只是提到术语，不算提问

        const bucketKey = String(cfg.countBy || 'session') === 'user' && last.userId ? `${key}#${last.userId}` : key;
        const now = Date.now();
        const { day, limit, used, remaining } = usage(bucketKey, now);
        const st = stateOf();
        const fresh = st.day === day;
        const usedNow = fresh ? used : 0;

        if (usedNow >= limit) {
          const reason = String(cfg.deflectStyle || '').slice(0, 300);
          return [
            '【专业问答配额已用完｜C 层上下文管理】',
            `本轮对方问的是专业问题（命中「${kw}」），但这个会话今天已经用掉 ${usedNow}/${limit} 次专业回答额度了。`,
            '所以：**不要给出这道题的技术答案**，不要给代码、公式、步骤、链接或半个结论。',
            reason,
            '一条短句带过就好，别解释额度规则、别提"限制/配额/系统"，也别答应"明天再说"这种具体承诺。'
          ].join('\n');
        }

        // 还有额度：记账（同一会话同一句只记一次，靠去重签名）
        const sig = `${bucketKey}|${day}|${String(last.text).slice(0, 80)}`;
        if (st.hits[sig]) return '';
        const nextUsed = { ...(fresh ? st.used : {}) };
        nextUsed[bucketKey] = usedNow + 1;
        const hits = { ...st.hits };
        hits[sig] = now;
        // 只保留最近 200 条签名，避免无限增长
        const sigKeys = Object.keys(hits);
        if (sigKeys.length > 200) {
          for (const k of sigKeys.sort((a, b) => (hits[a] || 0) - (hits[b] || 0)).slice(0, sigKeys.length - 200)) delete hits[k];
        }
        ctx.state.set({ day, used: nextUsed, hits });

        const left = Math.max(0, limit - nextUsed[bucketKey]);
        // 额度快用完时轻带一句，避免下一次突然翻脸
        if (left === 0) return '【专业问答配额｜提示】这是今天最后一次专业问答额度了，讲完这道就别再展开新的。';
        if (left === 1) return '【专业问答配额｜提示】今天还剩 1 次专业问答额度，按需要分配着用。';
        return '';
      }
    }
  };
}
