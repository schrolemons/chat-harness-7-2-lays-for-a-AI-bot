# 组件与参数分层映射（统一控制台）

> 目标：把「插件页 + 二代仿真(social-v2) + 人格/黑话/访问安全」合并进主控制台，
> 左侧栏按九层展示；组件开关语义改为「参数未设置即用默认值，空文本/0 视为无该组件」。

## 一、九层（来自 src/plugin-host.js 的 HARNESS_LAYERS）

| 层 | 名称 | 说明 |
|---|---|---|
| C | 上下文与记忆 | 提示词装配、快照、记忆、画像、角色卡、黑话 |
| T | 工具接口与协议 | MCP 工具、插件工具、调用约定、工具开关 |
| E | 环境与执行 | 传输、会话、审批、浏览器、语音、测试发送 |
| L | 生命周期与编排 | 唤醒、回合、定时、恢复、多 agent |
| O | 可观测与运维 | 日志、成本、自愈、反馈、控制台 |
| V | 验证与评估 | 基准、回归、归因 |
| G | 治理与安全 | 权限、策略、审计、闸门、白名单/令牌 |
| S | REFERENCE_DATA 参考 | 哲学思考资料与逻辑方式驱动的参考核心 |
| R（注册中心） | 集成注册中心 | integration-registry：第三方/横切组件的统一注册与管理 |

## 二、组件 → 层（以各 plugin.json 的 layer 字段为准，去重后 48 个）

- **C**：ctx-chat-reply-shape、ctx-chat-slang、ctx-chat-style、ctx-chat-topic-drive、ctx-interest-terms、
  ctx-context-dynamics、ctx-context-lifecycle、ctx-context-runtime、ctx-context-session、
  ctx-media-sticker-pick、ctx-member-alias、ctx-memory-context、ctx-memory-profile-facts、
  ctx-memory-profile-store、ctx-memory-store、ctx-memory-update、ctx-role-card
- **T**：tool-bilibili、tool-codex-chat、tool-injection-lab、tool-registry
- **E**：env-bridge、exec-browser-manager、exec-sandbox、gov-admin-dev-mode（管理员模式环境）
- **L**：life-campus-watch、life-daily-worklog、life-proactive-startup-greeting、
  life-proactive-time-bubble、life-relay-message、life-schedule-reminder、life-scheduler、
  life-task-session、life-user-availability、life-wake-reasons
- **O**：obs-bridge-health、obs-cost-policy、obs-health-monitor、obs-self-review
- **V**：eval-regression
- **G**：gov-policy
- **S**：reference-data-core
- **R**：integration-registry（layer 为空，展示时归到「组件注册中心」）

去重结论：当前 48 个组件 id 无重复；`state/repair-backups/` 里是历史审计副本，不算运行组件。

## 三、social-v2 的 23 个板块 → 层

| 板块 | 层 | 说明 |
|---|---|---|
| 工具开关（socialV2.tools.*） | T | MCP 工具清单开关 |
| 语音库与语音发送 | E | 调试用 |
| 唤醒推荐值 / 唤醒硬限制 | L | life-wake-reasons 消费 |
| 发送限制 | L | ctx-chat-reply-shape / bridge send |
| 等待工具参数 | L | qq_wait_for_messages |
| 主动机会参数 | L | life-wake-reasons |
| 定时主动消息（timeBubbles） | L | life-proactive-time-bubble |
| 主动行为（宵禁/关心/新闻/空闲兜底/已读戳） | L | life-user-availability / bridge |
| 日程提醒与排程 | L | life-schedule-reminder（`qq_schedule` + 控制台面板直连统一存储） |
| 唤醒状态 / 会话状态 / 白名单快选 | L | 只读视图 |
| 心情参数（mood） | C | ctx-context-dynamics |
| 表情包参数（sticker） | C | ctx-media-sticker-pick / sticker-lib |
| 上下文参数（recent/unread/contextWindow） | C | bridge 快照 |
| 持久化记忆 / 轻量记忆 | C | ctx-memory-store / ctx-memory-context |
| 初始提示词 | C | ctx-context-session |
| 自我更新频率 | O | obs-self-review |
| 每日日记 | O | ctx-memory-store（存储 + `state/memory/diary/<日期>.md` 按天归档，控制台「日记历史」） |
| 反馈工具参数 / 工具调用日志 | O | bridge observability |
| 管理员开发模式 preset | E | qq-chat-dev（owner 私聊工具面） |

## 四、已有页面 → 层

- 人格与角色（roles）→ **C**
- 黑话词库（slang）→ **C**
- 工具参考 → **T**
- 环境与执行（一般群友 / 管理员模式 / 私聊模式 / 浏览器）、会话与审批 → **E**
- 一代仿真、二代仿真 → **L**
- 运行总览、令牌与花费、调试与运维 → **O**
- 访问与安全（白名单/owner/黑名单/令牌/安全拦截/静默）→ **G**

## 五、「参数空/0 = 默认 = 无该组件」约定

- 组件不再有独立 enable 开关（UI 不展示）；是否生效由参数本身决定：
  - 数值参数缺省 → 用代码默认值；
  - 数值参数为 0 且语义是「上限/条数/数量」→ 视为「无该组件」（如 timeBubbles 数量 0 = 不冒泡）；
  - 文本参数为空（个性设定、初始提示词、推荐提示）→ 视为「无该组件」。
- 特殊格式默认值（如 mood.initial=60、sticker.enabled=true）仍允许显式关闭，前端用「空=默认」的提示文字说明。

## 六、后端保留/删除

- 保留：`/api/plugins`、`/api/plugins/detail`、`/api/plugins/config`、`/api/plugins/reload`、`/api/plugins/order`、`/api/plugins/harnessify`（统一控制台的组件编辑、热加载与七层管理化仍用）。
- 已删除：`/api/plugins/page`、`/api/harness/page` 两个 HTML 页面路由（`public/plugins.html`、`public/harness.html` 已改为跳转回主控制台）。

## 七、MCP server → 层（工具接口归位）

| MCP server | 层 | 工具 | 归属组件 |
|---|---|---|---|
| `snowluma` | T | `qq_*`（含 `qq_attack`：提示词注入「攻击」工具，取弹药+发送+@目标） | QQ 工具面 `src/mcp-snowluma-safe.js` |
| `codex-peer` | T | `codex_chat_send / poll / status / cancel` | `tool-codex-chat` |
| `web-search-safe` | T | `web_search / web_fetch` | `src/mcp-web-search-safe.js` |
| `reference-data-private-phi` | S | `reference-data_status / topics / read` | `reference-data-core` |
| `bridge-health` | O | `bridge_health` | `obs-bridge-health` |
| `playwright` | E | `browser_*`（仅管理员会话） | `exec-browser-manager` |
| `snowluma-host` | E | `snowluma_status` | `env-bridge`（管理端开发模式） |

说明：`codex-peer`、`reference-data-private-phi` 等 MCP server 是 DSH 层配置（不随桥接重启）；其工具面变更需重载 DSH MCP 连接。ChatGPT Chat 接力已停用。`snowluma` 的 `qq_attack` 在 `mcp-snowluma-safe.js`，重载后进入 QQ 会话工具面。
