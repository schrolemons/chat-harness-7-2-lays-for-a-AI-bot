# Codex Peer：完整文件与本机配置

代码在 `plugins/qq-components/tool-codex-chat/`，不是外部缺失附件：

- `install.mjs`：发现本机 Codex，为指定 DSH profile 安装 MCP 配置。
- `src/mcp-server.mjs`、`runtime.mjs`：MCP 入口与本地初始化。
- `src/app-server.mjs`：通过官方 Codex App Server 的 stdio JSONL 协议连接。
- `src/controller.mjs`：独立会话、请求 ID、串行执行、限频、超时与失败状态。
- `src/viewer.mjs`、`public/`：本机对话查看界面。
- `src/state-acl.mjs`（仓库根 `src/`）：共用的数据目录权限辅助代码。

不要只复制这个插件子目录；它有明确的宿主相对依赖，应下载完整仓库。第三方运行时、官方 Codex 本体和登录凭据不包含在本仓库。

## 安装

1. 在本机官方 Codex 客户端或 CLI 完成自己的登录，确认可用。
2. 先完成根 README 的 DSH、SnowLuma、npm 依赖和本地配置步骤。
3. 运行 `npm run setup -- --profile desktop --with-codex`。
4. 如果自动发现失败，增加 `--codex-path` 指向本机官方可执行文件。
5. 刷新 DSH 工具列表，用状态工具验证，不以“文件存在”代替通信验证。

安装器只在自己的 `state/codex-chat/settings.json` 写入本机可执行文件位置。首次真实咨询时创建专用工作区和新会话；不会继承作者的任何聊天、thread ID、请求账本或 App 配置。

| MCP 工具 | 用途 |
|---|---|
| `codex_chat_status` | 当前状态、可用性和本地 viewer 地址 |
| `codex_chat_send` | 使用唯一 requestId 提交授权咨询 |
| `codex_chat_poll` | 等待该请求的结果 |
| `codex_chat_time` | 当前时间 |
| `codex_chat_cancel` | 取消活跃请求 |

同一请求重试保留原 requestId；结果未知时先看状态，不生成新 ID 自动重发。这个 MCP 面向管理端，QQ 群聊的受限预设不会因此获得 Codex 或本地工具。

## 让 AI 帮助配置

可以把以下任务交给自己的本地 AI 助手：

> 请先读本仓库 README 和 docs/CODEX_PEER.md，检查 Node、DSH profile、完整插件文件及我自己的官方 Codex 是否可用。使用仓库安装器安装 Codex Peer，保留现有 DSH 配置和会话。不要向我索取或粘贴登录令牌，不复制别人的 config/state/browser profile，不读取其他聊天。安装后先用状态工具检查，再在我授权的范围内做一次无外部副作用的咨询并展示结果。若缺登录或操作授权，说明我需要完成的具体步骤。不要承诺我未配置的工具或账号能力。

宿主默认模型、可用工具、Apps/MCP 和权限来自使用者自己的 Codex 配置。本项目不保证所有机器的工具集完全一致。协议参考：[官方 App Server](https://developers.openai.com/codex/app-server)。
