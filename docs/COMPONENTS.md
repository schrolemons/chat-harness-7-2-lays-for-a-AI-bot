# 文件与工具清单

本仓库是带 DSH profile 安装器的桥接宿主，不能把单个人设 Markdown 当作完整插件安装。

| 位置 | 必需内容 |
|---|---|
| `src/` | 桥接内核、DSH 客户端、OneBot 连接、权限与发送机制 |
| `plugins/qq-components/` | 七层组件、S 参考实现及横切注册中心 |
| `dsh/agent-presets/` | 四套 QQ/任务预设的源定义 |
| `plugins/qq-agent-presets/` | 生成的 preset patch、QQ/任务/摘要工具守卫 |
| `plugins/qq-mode-console/` | DSH 与桥接共享的模式设置 |
| `plugins/qq-launcher/` | DSH 桌面端按钮、红黄绿状态及后台启动 |
| `src/mcp-snowluma-safe.js` | 安全 QQ 工具与桥接调用接口 |
| `src/mcp-host-server.js` | 只读 QQ 网关状态 |
| `src/mcp-web-search-safe.js` | 通用搜索/网页工具 |
| `src/mcp-bridge-health.mjs` | 当前连接健康检查 |
| `plugins/qq-components/tool-codex-chat/` | 完整 Codex Peer MCP、控制器和 viewer |
| `plugins/qq-components/schnie-core/` | 通用本地目录读取机制，只有一个公开示例 |
| `scripts/` | 配置、安装、启动、诊断、通用网页监控及必要测试 |
| `public/` | 统一管理控制台 |
| `roles/小鲸鱼.md` | 可编辑的人设卡，未携带个人群聊和成员资料 |

`@playwright/mcp`、`@snowluma/sdk`、MCP SDK 等通过 `npm ci` 根据锁文件安装，不把 `node_modules` 上传。DSH、QQ、SnowLuma、Codex 本体由使用者另行安装。

跨层服务与注册沿用源码的 `plugin.json + index.js + skill.md` 契约；使用者扩展应放在自己的插件目录或 `user-scripts/`，不要把个人数据写进通用插件代码。
