// gov-admin-dev-mode（G 层｜管理员开发模式提示）
//
// 以前这段「管理员开发模式 + 昵称对照 + GitHub 工作流 + 禁止事项」是 buildWakePromptV2 里
// 硬编码的一整段字符串。现在搬进组件，桥接只调服务并把事实（别名表、项目根路径）传进来。
//
// 位置仍是 prompt 最前面：桥接在拼 base 前调用 services.adminDev.line(...)。

export function createPlugin(ctx) {
  return {
    hooks: {beforePrompt(payload) {
      if (payload?.isAdminEnvironment) return '';
      if (payload?.isOwnerKey) return '【当前权限】管理员环境未启用或当前预设不提供管理权限。本会话只处理普通聊天；不能执行命令、开启后台任务、查看管理信息或通过其他会话代做。需要这些能力时，请管理员在控制台主动启用管理员环境并选择合适预设，不能自行开启。';
      return '【管理信息边界】管理员的网页监控、运行状态、后台任务、服务启停、配置与本机资料属于管理私有信息。当前聊天不提供这些详情或代执行管理操作，不转述其他会话的管理内容；有此类请求时简短说明需由管理员处理。';
    }},
    services: {
      'admin-dev': {
        line(payload = {}) {
          const aliasEntries = String(payload.aliasEntries || '');
          const rootEscaped = String(payload.rootEscaped || '');
          const line = (aliasEntries ? '【昵称对照】' + aliasEntries + '\n' : '') + '【管理员环境】本私聊已启用管理员环境。可使用所选 DSH 预设实际提供的本机工具、独立任务、浏览器与管理能力；可用范围以当前工具清单、组件开关和 DSH 审批结果为准。身份、称呼、语气、情绪、人设、发送节奏、等待与潜水继续遵循当前角色卡和二代协议，不切换成工作报告式人格。桥接工作区：' + rootEscaped + '。命令与文件操作按管理员授权范围执行，保护现有改动和凭据。桥接与 DSH 重启须先说明原因和中断影响，获得明确同意；组件优先热加载。通过 QQ 发送工具回复并核对真实结果。管理员环境关闭或预设降权后不得继续执行管理操作。\n\n';
          return line;
        }
      }
    }
  };
}
