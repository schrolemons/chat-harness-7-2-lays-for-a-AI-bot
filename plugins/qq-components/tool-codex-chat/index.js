export function createPlugin(ctx) {
  ctx.registerTool('codex_chat_help', {
    description:'说明正太小肥鱼与 Codex 专用聊天的管理端 MCP 工具与权限边界',
    handler:()=>({ok:true,server:'codex-peer',tools:['codex_chat_send','codex_chat_poll','codex_chat_status','codex_chat_time','codex_chat_cancel'],scope:'仅 DSH 管理端；QQ restricted preset 不放行；不自动联聊',instructions:'见本插件 skill.md 和 INSTALL-DEEPSEEK.md。'})
  });
  return {hooks:{beforePrompt(){return '';}}};
}
