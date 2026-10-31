# 给 DeepSeek：安装与使用「AI助手 × Codex」通信插件

> **当前方案（2026-10-27）**：恢复使用官方 Codex App Server 与 Codex 专用会话。ChatGPT Chat 接力已停用，不属于当前通信链路。

本插件让AI助手通过工具向 Codex 发消息，再把 Codex 的回答作为工具结果取回来。机主在 **Codex 内的本地浏览器面板**查看：AI助手在右边，Codex 在左边，保留多轮上下文。

这台电脑已完成安装与真实双向验收。下面的步骤用于检查、重新安装、迁移和恢复；不要另装第二份，也不要改现有 QQ 白名单。

## 1. 先明确界面与权限

最终使用的是本地聊天面板，不是把文本模拟输入到当前原生聊天框。当前 Codex 的原生聊天有独占写入者限制：桌面端接管底层聊天后，第二个 App Server 不能继续写。因此，**运行期间只打开 viewerUrl，不要在 Codex 原生聊天列表里打开本插件底层的 threadId**。

底层使用官方 `codex app-server` 的 stdio 协议及 `thread/start`、`thread/resume`、`turn/start`；没有浏览器自动登录、Cookie 导出、网页接口逆向或聊天数据库写入。[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)

AI助手保留自己的 DSH 人格和上下文；Codex 使用独立的专用上下文，不自动继承机主其他聊天内容。本机原有 Codex 登录和默认模型由官方程序自行使用，插件不复制登录凭据。调用消耗该账户现有额度。

插件提供给 **DSH 管理端会话**。`qq-chat` / `qq-chat-v2` 的已有工具守卫继续拒绝本插件；不要添加 `mcp__codex-peer__` 到它们的白名单。机主已有的管理员开发模式是另一种受信任的管理入口，按原项目的 owner 限制使用。

## 2. 文件位置

当前桥接工程根目录：

```text
C:\FixtureHome\Desktop\Projects\DSH BOT\qq-bridge-0.2.1-r1\qq-bridge-0.2.1-r1
```

插件目录是工程根目录下：

```text
plugins/qq-components/tool-codex-chat/
  plugin.json             T 层声明
  index.js                宿主管理页入口
  skill.md                AI助手使用规则
  install.mjs             安装、检查和卸载
  admin.mjs               仅供机主执行的恢复命令
  src/                    MCP、控制器、App Server 和只读面板服务
  public/                 本地面板 HTML / CSS / JavaScript
  test/                   自动测试
  INSTALL-DEEPSEEK.md      本文
```

本插件依赖宿主已有的 `src/state-acl.mjs`，用它统一设置 Windows 权限。它面向这套七层插件宿主，不是任意 DSH 项目的通用安装包。

## 3. 安装命令

前提：机主已在官方 Codex 中登录；本机有 Node.js 22.13 或更新版本；桥接工程依赖完整。当前机器使用 Node.js 24.16.0 与 Codex CLI 0.164.0-alpha.11.1 验收。

在 PowerShell 中：

```powershell
$pluginDir = 'C:\FixtureHome\Desktop\Projects\DSH BOT\qq-bridge-0.2.1-r1\qq-bridge-0.2.1-r1\plugins\qq-components\tool-codex-chat'
Set-Location -LiteralPath $pluginDir
node install.mjs --dry-run
node install.mjs
```

安装器会自动找到本机 Codex 二进制，为 `desktop` profile 增加 `mcp-codex-peer`，并在修改前备份 `cordis.patch.yml`。它保留其他插件和注释；重复安装不会重复增加条目，也不会因 DSH 自动换行而反复重写配置。

使用其他 profile 时指定其绝对目录：

```powershell
node install.mjs --profile 'C:\FixtureHome\.dsh\profiles\desktop'
```

若未找到 Codex，使用 `--codex-path` 指向本机官方 `codex.exe`。不要下载来源不明的替代程序，也不要把此参数交给聊天工具动态设置。

若缺少 npm 依赖，应在桥接工程根目录按该工程自己的安装流程恢复；本机已有 MCP SDK、zod、js-yaml，无需重复安装。迁移时把整个插件目录放回相同的宿主相对位置，再运行安装器。

DSH 通常会热加载 profile 变更。本机已实际加载五个工具。若新工具未出现，在 DSH 中重新加载这条 MCP 配置；仍未出现，再保存正在进行的工作后重新启动 DSH。七层驾驶舱重新加载插件后，T 层应出现「AI助手 × Codex 专用聊天」。

不要重新运行整个宿主的 `setup-dsh.mjs` 来安装本插件；它管理的是宿主自己的其他区块。

## 4. 工具调用

在 DSH 的工具列表中，完整名字如下；如果宿主显示了命名空间，请照宿主实际提供的名称调用。

| 工具 | 输入 | 用途 |
| --- | --- | --- |
| `mcp__codex-peer__codex_chat_status` | `{}` | 看开关、活跃请求、熔断和 `viewerUrl` |
| `mcp__codex-peer__codex_chat_send` | `requestId`, `text` | 提交一条消息，立即返回状态 |
| `mcp__codex-peer__codex_chat_poll` | `requestId`, `waitMs` | 等待并读取最终回答 |
| `mcp__codex-peer__codex_chat_time` | `{}` | 读取上海时间、UTC 和 Unix 毫秒时间戳 |
| `mcp__codex-peer__codex_chat_cancel` | `requestId` | 请求停止本插件的活跃回合 |

一次咨询示例：

```json
// 先查状态
{}

// send：每条新消息使用一个新的 UUID；这里的 ID 只是示例
{"requestId":"dafeiyu-demo-20261025-001","text":"你好，我是AI助手。请用一句中文和我打招呼。"}

// poll：反复查同一个请求，不要重复 send
{"requestId":"dafeiyu-demo-20261025-001","waitMs":20000}
```

`pending` / `running` 表示尚未完成；继续 poll。`completed` 的 `reply` 就是要读取的回答。正常结束后，可以用新的 requestId 继续下一轮，仍然使用同一个专用聊天。

`failed` / `uncertain` / `CIRCUIT_OPEN` 时停止并向机主报告。**超时不代表消息没有送达；不能换一个 ID 自动重发。** 同一 ID 和同一文本不会重复创建回合；同一 ID 换文本会被拒绝。

默认只做机主要求的一次咨询；机主要求来回讨论时最多三轮，再继续需要新的任务指示。这是使用规则。程序额外限制：单次 8000 字符、一次一个活跃请求、发送间隔至少 15 秒、每小时最多 20 次、24 小时最多 60 次、一个请求账本最多 200 条。轮数规则与这些程序限额不是同一层机制。

## 5. 在 Codex 中查看

调用 status 后，将返回的 `viewerUrl` 交给机主，在 Codex 的内置浏览器里打开。它只显示该专用聊天最近 20 个回合；完整记录由 Codex 自己保存。页面约每 1.5 秒刷新，能显示回复的文本增量；工具 poll 只返回最终回答，不输出内部推理。

链接只在当前 MCP 进程存活期间有效。重启 DSH / MCP 后，应重新调用 status 获取新链接。初次 status 会启动本机只读面板，不会发起模型生成。不要把 viewerUrl 发到 QQ、公开网页或日志平台；链接片段是仅用于读取当前对话的临时查看钥匙，与 OpenAI 登录凭据无关。

MCP 进程停止时，本地面板服务也停止。插件开启期间，它只监听 `127.0.0.1` 的随机端口；没有局域网或公网监听，也没有用于发送消息的 HTTP 接口。

连接失败或退出时，插件会向 `state/codex-chat/app-server.log` 写有界诊断信息（每行截断、文件超过 64KB 只保留最后 32KB，正常连接不写）。它只包含连接事件和 Codex stderr 尾部，不包含对话正文；目录沿用宿主收紧过的 ACL。

## 6. 七层中的位置

唯一主层为 **T：工具接口与协议**。C 层的上下文由绑定的 Codex thread 承载；L 层通过串行、取消与恢复衔接；O 层保存无正文的请求元数据；G 层检查开关、输入、限额和跨站访问。这些是跨层约束，不需要重复安装多份插件。

宿主管理页中的 `codex_chat_help` 只是说明工具。**只有添加 MCP 配置后，上述五个模型可调用工具才会出现。** 驾驶舱里看见插件，不等于 MCP 已连接。

在七层驾驶舱停用 `tool-codex-chat` 后，新工具调用与面板读取会被拒绝；已提交到模型的回合可能仍在完成。需要停止已有生成时，先 cancel 并 poll 确认，再停用。

## 7. 安全与平台限制

- OpenAI 认证由本机官方 Codex 自行处理；AI助手不取得它的 Cookie、密码或 API Key。不要在消息中发送其他凭据或未经授权的聊天记录。
- 专用聊天启用内置 shell、图片查看/生成、实时联网搜索、Apps、多代理、浏览器/桌面操作及当前 Codex 配置中的 MCP 服务和插件。工作区写入限定在 `state/codex-chat/workspace`，工作区网络开放；hooks 与自动安装依赖关闭。approval policy 为 `never`，因此工具不会逐次等待人工确认；对外发送、下单、发布、部署和账户修改等操作必须由机主当前任务明确要求。查看面板不拥有执行权限。
- 查看凭证随机生成；API 检查凭证、Host、Origin 和本机地址，拒绝跨站请求和所有写方法。文本按纯文本渲染，不执行消息内的 HTML / JavaScript。
- 本地状态目录使用宿主已验证的 ACL 实现，只保留受信任的机主、SYSTEM 和 Administrators。相同 Windows 用户下运行的任意恶意本机程序不在本插件的隔离边界内。
- 插件不自动新建回合重试、不轮换账号、不切换代理来规避限制。官方客户端自身的传输重试属于其正常实现；插件不声称控制了官方客户端的所有内部重试。

采用官方接口和保守限额，不能保证任何平台永远不触发限流或风控。出现认证、额度、限流或策略拒绝时，应停止并按平台提示处理。[官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)

## 8. 常见问题与恢复

| 状态 | 处理 |
| --- | --- |
| 工具未出现 | 检查 profile 的 `codex-peer` MCP 条目，重新加载 DSH；不能靠改提示词解决 |
| `DISABLED` | 由机主在七层驾驶舱开启插件；不要改 QQ 工具守卫 |
| `LOCKED` | 已有存活的 MCP 进程持有本插件；已退出进程留下的锁会被自动回收。仍 LOCKED 时不要删锁或另起服务，先确认是否还有 DSH / MCP 进程 |
| `failed` / `INTERRUPTED_BEFORE_ROUND_START` | 上次进程在回合真正开始前中断；该请求不会重发，直接发新请求即可 |
| `DESKTOP_OWNS_CHAT` | 原生 Codex 窗口接管了底层聊天；回到本地面板，不删除锁或强行接管；机主可在断开 MCP 后归档旧账本并创建新专用聊天 |
| `RATE_LIMIT` | 等限额窗口过去；不换账号、请求 ID 或代理绕过 |
| `USAGE_LIMIT` | Codex 账号用量/额度上限；等 Codex 提示的恢复时间过去后由机主清熔断（见下方命令），不换账号、不用代理绕过 |
| `uncertain` | 消息可能已经送达，机主检查 Codex 回合状态，不能自动重发 |
| `CIRCUIT_OPEN` | 由机主处理认证/网络/额度问题后再恢复，不由模型工具自行解除；熔断会持久化，需按下方命令清除 |
| 面板链接失效 | 重新调用 status，打开新的 viewerUrl |
| 面板 503 / `CHAT_NOT_READY` | 查看器读不到 Codex 历史；先看 `state/codex-chat/app-server.log`。新版会自动退避重试，不必重启整个 MCP；确认 Codex 已登录且网络可用 |
| Codex 更新后路径失效 | 重新运行 install.mjs，更新本机路径 |

以下命令只供本机管理操作。先在 DSH 中断开 `codex-peer`；若无法单独断开，保存工作后关闭 DSH。确认所有回合已结束、错误原因已处理：

```powershell
node admin.mjs
# 已确认旧回合结束后，解除熔断；不会重放旧消息
node admin.mjs --clear-circuit --acknowledge-reviewed
# 只有原进程确实已退出（或锁文件为空/损坏）且确认没有并发启动时，才执行
node admin.mjs --unlock-dead
# 需要全新专用聊天或账本满 200 条时，保留旧账本并开启新账本
node admin.mjs --new-chat --acknowledge-reviewed
```

恢复工具不提供 MCP 接口。它不会结束其他进程，不会删除 Codex 的聊天记录，也不会强行解除官方聊天写入锁。恢复后重新连接 MCP，再调用 status 获取新面板链接。

注意：熔断状态写在 `state/codex-chat/state.json` 里，是持久化的；单纯重启 MCP / DSH 不会解除。`USAGE_LIMIT` 等情况必须等 Codex 额度恢复后，按上面的 `--clear-circuit --acknowledge-reviewed` 清除（运行前需要 MCP 离线，否则会报“MCP 进程仍在线”）。

## 9. 验收与卸载

自动测试：在插件目录运行 `node --test test/*.test.mjs`。覆盖输入、幂等、串行、恢复、取消、开关、配置、重复安装权限、查看鉴权和跨站/写入拒绝。DSH 代理沙箱禁止测试运行器 spawn 子进程（会报 `spawn EPERM`），沙箱内 `icacls` 也会被拒；请在普通 PowerShell 运行，或逐文件加 `--experimental-test-isolation=none`。

`verify.mjs` 用于手工独立 MCP 验收；**当 DSH 已持有插件时不能另起它进行读写测试**，否则应得到 LOCKED。`verify-dsh.mjs --live` 是本工程可选的真实 DSH 链路验收，会通过现有本机探针建立临时管理会话，并产生真实模型调用；仅在机主要求时运行。DSH 的动态端口应先按工程实际配置设置 `DSH_BASE_URL`。不要把本机探针认证信息发送到 Codex。

本机验收详情见 `docs/QA.md`。

卸载 MCP：

```powershell
node install.mjs --uninstall
```

再在七层驾驶舱停用本插件。若只想保留历史并移走代码，应先确认 MCP 已停止，再把插件整个目录移到备份位置；保留 `state/codex-chat` 和 Codex 会话记录。安装器创建的 profile 备份可恢复，但如期间还有其他配置变更，优先只卸载本插件区块，避免整体覆盖旧备份。

## 10. 可直接交给AI助手的话

> 机主已安装 tool-codex-chat。请读取本插件 skill.md 和 INSTALL-DEEPSEEK.md，在 DSH 管理端调用 codex-peer 的五个工具。仅在我的任务范围内与 Codex 讨论，默认一次、最多三轮；用唯一 requestId 发送并用同 ID poll 取回答。把 status 返回的 viewerUrl 留给我在 Codex 本地面板查看，不公开链接。遇到失败、限流或 uncertain 时停止，不换 ID 重发，不修改 QQ 白名单，也不尝试绕过平台限制。
