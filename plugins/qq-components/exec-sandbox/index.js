// 执行后端声明（E 层，最小可用版）
//
// 桥接本身不负责执行，执行发生在三处：DSH 沙箱（workspace-write / danger-full-access）、
// 管理端开发模式（owner 私聊，自动放行）、真实浏览器（Edge CDP 9227）。
// 这个插件把三者与边界声明出来，让 AI 动手前能查「该走哪条路、要不要审批、允许碰什么」。

const BACKENDS = [
  {
    id: 'dsh-workspace',
    name: 'DSH 工作区沙箱',
    defaultMode: 'workspace-write',
    approval: '按策略询问（当前 ask）',
    scope: '仅会话工作区可写；系统目录/仓库外只读',
    when: '默认执行环境：读写当前工作区、跑 node --check、本地测试'
  },
  {
    id: 'dsh-full',
    name: 'DSH 危险模式',
    defaultMode: 'danger-full-access',
    approval: '每次升级需说明理由（owner 会话自动通过）',
    scope: '仓库外写入、读取 state/、重启进程',
    when: '改桥接仓库/state/、需要真实文件系统访问时；先备份再动'
  },
  {
    id: 'admin-dev',
    name: '管理端开发模式',
    defaultMode: 'owner 私聊专用',
    approval: '自动通过（受治理规则约束）',
    scope: '本机 pwsh、文件读写、浏览器、发文件、GitHub',
    when: '管理员要求的本机运维/开发；仍拒绝凭据外发与越权'
  },
  {
    id: 'browser-cdp',
    name: '浏览器（真实 Edge）',
    defaultMode: 'CDP 9227',
    approval: '不弹审批，但禁止支付/银行/身份验证操作',
    scope: '用户当前登录态；只做阅读与常规点击',
    when: '查网页/看作业/需要登录态的页面'
  }
];

export function createPlugin(ctx) {
  ctx.registerTool('exec_backends', {
    description: '列出可用执行后端、权限边界与审批要求',
    handler: () => ({ ok: true, total: BACKENDS.length, backends: BACKENDS })
  });
  ctx.registerTool('exec_pick', {
    description: '按任务类型推荐执行后端：{ task: "write-repo" | "read-web" | "run-local" | "send" }',
    handler: ({ task } = {}) => {
      const t = String(task || '');
      const map = {
        'write-repo': 'dsh-full',
        'run-local': 'dsh-full',
        'read-web': 'browser-cdp',
        'send': 'dsh-workspace'
      };
      const id = map[t];
      if (!id) return { ok: false, error: '未知任务类型：' + t, known: Object.keys(map) };
      return { ok: true, backend: BACKENDS.find((b) => b.id === id) };
    }
  });
  return { hooks: {} };
}
