export const name = 'summary-tool-restrict';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.restrict({ allow: [] });
  ctx.tools.guard(() => '网页整理会话只能阅读本轮输入，不能调用工具。');
}
