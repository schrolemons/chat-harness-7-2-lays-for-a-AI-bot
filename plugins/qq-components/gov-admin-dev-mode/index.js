export function createPlugin(ctx) {
  return { services: { 'admin-dev': { line(payload = {}) {
    return '【管理员开发模式】只在当前管理员私聊及明确授权的任务范围内使用本地工具。当前工程路径：' + String(payload.rootEscaped || ctx.root || '')
      + '。只使用当前运行时提供的工具，不假设任何安装者的路径、应用或账号状态；不读取其他聊天或凭据，不向未授权目的地发送内容。重启或发布前说明影响，按操作者授权执行。';
  } } } };
}
