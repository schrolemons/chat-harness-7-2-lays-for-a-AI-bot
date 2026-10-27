// 环境管理插件（E 层）：桥接本体的能力声明。
//
// 定位：桥接 = 环境。它不负责「说什么、怎么聊」（那是 C 层插件），
// 只负责把 QQ、DSH、MCP、本机串起来，并保证传输/状态/调度/鉴权/自愈可用。
// 这个插件把它的职责写清楚，供 AI 与 UI 查询。

const CAPABILITIES = [
  { id: 'transport', name: '传输', detail: 'SnowLuma OneBot v11 WS（127.0.0.1:3001）；DSH events.mux 事件流' },
  { id: 'state', name: '会话状态', detail: 'state/social-v2.json：未读/最近/唤醒配置/心情/记忆/驱动冷却' },
  { id: 'wake', name: '唤醒调度', detail: '社交循环 5s tick；定时/主动/回复检查/沉睡前观察闸门' },
  { id: 'send', name: '发送队列', detail: '顺序发送、拟人间隔、每分钟/每小时限频、分条上限' },
  { id: 'auth', name: '鉴权', detail: '控制台令牌 + 会话令牌 + 白名单；Host/Origin 校验' },
  { id: 'watchdog', name: '看门狗', detail: '回合 20 分钟按事件判死、WS 90s 假死重连、mux 10 分钟重连' },
  { id: 'console', name: '控制台', detail: '127.0.0.1:3100：状态/插件/配置/日志/发送调试' },
  { id: 'plugins', name: '插件宿主', detail: 'plugins/qq-components/<id>：加载、钩子、工具、热重载、七层注册表' }
];

export function createPlugin(ctx) {
  ctx.registerTool('env_bridge_capabilities', {
    description: '查询桥接（环境层）提供哪些能力、分别负责什么',
    handler: () => ({ ok: true, role: '环境管理', capabilities: CAPABILITIES })
  });
  return { hooks: {} };
}
