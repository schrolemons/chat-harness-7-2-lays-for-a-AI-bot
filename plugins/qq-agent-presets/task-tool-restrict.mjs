// Scope-only worker boundary; local execution tools remain available.
export const name = 'task-tool-restrict';
export const inject = ['tools'];
const blocked = name => name === 'ask_user_question' || /^mcp__(?:snowluma(?:-host)?|codex-peer|chatgpt-relay)__/.test(name);

export function apply(ctx) {
  const hidden = new Set();
  const hide = () => {
    for (const tool of ctx.tools.schemas()) {
      if (!blocked(tool.name) || hidden.has(tool.name)) continue;
      hidden.add(tool.name);
      // Scoped registrations cannot be named in a global restriction; the guard
      // also covers those and any newly registered tool before its next schema read.
      try { ctx.tools.restrict({deny:[tool.name]}); } catch { /* guarded below */ }
    }
  };
  ctx.tools.guard(exec => blocked(String(exec?.name || '')) ? '任务会话的用户输入输出由聊天协调器管理，请按任务状态协议返回。' : undefined);
  ctx.on('tools/change', hide);
  hide();
}
