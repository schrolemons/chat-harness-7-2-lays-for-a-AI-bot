# 文件与工具清单

本仓库是带 DSH profile 安装器的桥接宿主，不能把单个人设 Markdown 当作完整插件安装。

| 位置 | 必需内容 |
|---|---|
| `src/` | 桥接内核、DSH 客户端、OneBot 连接、权限与发送机制 |
| `src/bridge-core/` | 模式设置、媒体消息段与双戳缓冲操作的独立模块 |
| `plugins/qq-components/` | 七层组件、S · SCHNIE 思维模式-介入层及横切注册中心 |
| `dsh/agent-presets/` | QQ 聊天、管理员、任务与独立学习预设的源定义 |
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
| `scripts/source-workspace.mjs` | 只读源码快照、基线核验和跨目录哈希比较 |
| `roles/小鲸鱼.md` | 可编辑的人设卡，未携带个人群聊和成员资料 |

`@playwright/mcp`、`@snowluma/sdk`、MCP SDK 等通过 `npm ci` 根据锁文件安装，不把 `node_modules` 上传。DSH、QQ、SnowLuma、Codex 本体由使用者另行安装。

跨层服务与注册沿用源码的 `plugin.json + index.js + skill.md` 契约；使用者扩展应放在自己的插件目录或 `user-scripts/`，不要把个人数据写进通用插件代码。

## 图片生成

`exec-image-generation` 属于 E 层，提供 OpenAI 兼容生图与编辑、火山方舟 Seedream 生图与参考图、每日额度和生成图片本地保存。QQ MCP 工具 `qq_make_meme`、`qq_get_meme_job`、`qq_send_image` 由 `src/mcp-snowluma-safe.js` 注册，接口源文件与插件均包含在仓库中。生图结果以会话绑定的图片编号交给发图工具，不接收任意本机路径。控制台分别保存 OpenAI 和火山方舟密钥于忽略的 `state/image-generation/secret.json`，个人图片位于同目录的 `assets/`。选择火山方舟后，填入有可用额度的 Seedream 模型 ID，并在当前服务的密码框保存方舟 API Key；切换服务不会把另一家的密钥发送过去。

入站图片与工具返回图片可暂存到当前会话，再由图像工具查看、发送或按传话白名单转交；本机路径导入限管理员私聊。

## 生命周期与会话记忆

`life-message-ack` 是 L 层未回复补话组件，四组话术各自启停、配置延迟和固定话术表。双时间戳以 `seenAt`/`repliedAt` 分别记录模型已看和成功回复，并在重启后继续处理未完成消息。

`ctx-memory-profile-store` 统一管理按 QQ 号保存的 JSON 人物档案、工具与本人私聊注入；旧 `ctx-member-card` 仅保留兼容入口。档案、显示名与会话关系元数据保存在本机 `state/person-profiles.json`，群聊只按明确回复对象查询，不自动携带成员档案。

`life-user-availability` 保留语义免打扰与到期联系。`qq_availability(action="returned", planId)` 由模型确认用户已回来后撤销匹配的稍后联系；不另设最近联系保护期。内部任务过期界限仅防止重启后补发过时联系，与语义返回判断分开。

`ctx-interest-terms` 按群聊批次整理可公开查证的共同兴趣知识。候选在管理员确认前不会注入提示词；来源会话权限会在后台学习开始和结束时复核，词条及过程状态只保存在本机运行目录。

## Bilibili 视频工具

`tool-bilibili` 只访问公开内容，提供搜索、视频信息、字幕、受控 FFmpeg 抽帧和分析入口；MCP 工具通过当前会话令牌调用插件。插件不登录、不执行社交写操作，也不接受任意下载 URL、路径或系统命令。
