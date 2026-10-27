// 失败转回归用例（V 层，最小可用版）
//
// 评估五阶段里最缺的是「反馈与回归」：真实失败要能变成可重复的用例。
// 这里提供记录/查询用例的工具，把用例存进插件自己的 state（state/plugins/eval-regression.json），
// 后续可以接 npm test 的离线跑批（下一迭代：导出成 scripts/test-*.mjs 的输入）。

export function createPlugin(ctx) {
  const maxCases = Math.max(5, Number((ctx.config || {}).maxCases) || 50);

  function cases() {
    const st = ctx.state.get();
    return Array.isArray(st.cases) ? st.cases : [];
  }

  ctx.registerTool('eval_record_case', {
    description: '把一次真实失败记成回归用例：{ title, input, expected, actual, note }',
    handler: (input = {}) => {
      const title = String(input.title || '').trim().slice(0, 60);
      if (!title) return { ok: false, error: 'title 必填' };
      const list = cases();
      if (list.some((c) => c.title === title)) return { ok: true, duplicated: true, total: list.length };
      list.push({
        id: 'case-' + (Math.max(0,...list.map(c=>Number(String(c.id||'').replace('case-',''))||0))+1),
        title,
        input: String(input.input || '').slice(0, 300),
        expected: String(input.expected || '').slice(0, 300),
        actual: String(input.actual || '').slice(0, 300),
        note: String(input.note || '').slice(0, 200),
        at: Date.now()
      });
      const trimmed = list.slice(-maxCases);
      ctx.state.set({ cases: trimmed });
      return { ok: true, total: trimmed.length };
    }
  });

  ctx.registerTool('eval_list_cases', {
    description: '列出已记录的回归用例（最多 50 条）',
    handler: () => ({ ok: true, total: cases().length, cases: cases() })
  });

  ctx.registerTool('eval_clear_cases', {
    description: '清空回归用例（谨慎）',
    handler: () => { ctx.state.set({ cases: [] }); return { ok: true, total: 0 }; }
  });

  return { hooks: {} };
}
