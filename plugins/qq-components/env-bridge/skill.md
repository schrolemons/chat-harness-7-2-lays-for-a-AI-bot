# skill：环境管理（env-bridge）

## 定位
桥接**不是**业务大脑，是环境：把 QQ（SnowLuma）、DSH、MCP 工具、本机执行串起来，
并保证传输、状态、调度、发送、鉴权、自愈这些底层能力可用。

## 它负责
| 能力 | 说明 |
| --- | --- |
| 传输 | SnowLuma OneBot v11 WS、DSH events.mux |
| 会话状态 | `state/social-v2.json`：未读/最近/唤醒配置/心情/记忆/驱动冷却 |
| 唤醒调度 | 5s 社交循环、定时唤醒、主动机会、回复检查、沉睡前观察闸门 |
| 发送队列 | 顺序发送、拟人间隔、限频、分条上限 |
| 鉴权 | 控制台令牌、会话令牌、白名单、Host/Origin 校验 |
| 看门狗 | 回合判死、WS 假死重连、mux 重连、退役保留 pendingWake |
| 控制台 | 状态/插件/配置/日志/发送调试 |
| 插件宿主 | 加载 `plugins/qq-components/<id>`、钩子、工具、热重载、七层注册表 |

## 它不负责
人设、语气、记忆写什么、什么时候追问、发哪张表情、怎么评估——这些都在对应层插件里。
桥接只提供接口和状态，不做「聊什么」的判断。

## 查询
工具 `env_bridge_capabilities`（走 `/api/plugins/call`）只列能力，不能证明当前在线或离线。实时健康统一调用管理端 `mcp__bridge-health__bridge_health({})`，或本工程 `node scripts/bridge-health.mjs --json`。该入口自动使用控制台鉴权并只返回必要状态，不暴露 `/api/status` 里的聊天活动。不要对未带令牌的 401/403、过期的 3080 地址或旧日志下掉线结论。
