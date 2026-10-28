# skill：黑话学习与注入（ctx-chat-slang）

## 它解决什么
黑话学习以前整条链路在 `bridge.js`：收消息攒窗口 → 冷却 → 抽词 prompt → 研究 prompt → 写
`state/slang.json` → 每轮提示词 prepend 黑话表。现在这些都在本组件里；桥接只保留
**存储**、**学习会话的 DSH 往返**和**控制台 / MCP 的 CRUD 端点**（数据面）。

## 什么时候被调用
| 钩子/服务 | 时机 | 做什么 |
| --- | --- | --- |
| `onIncoming` | 每条入站消息 | 过滤 `/` 开头、角色切换句；把 `{sender,text,time}` 推入该会话窗口（≤80 条），够 min 且冷却到就排队抽词 |
| `onTick`（60s） | 兜底 | 重试积压窗口；清理 24h 没动的窗口 |
| `services.slang.contextBlock()` | 每轮拼提示词 | 返回「当前时间 + 已确认黑话表」，桥接 prepend 到 prompt |
| `services.slang.extract({key})` | 控制台手动抽词 | 对窗口立即抽一次 |
| `services.slang.research({ids})` | 组件内研究入口 | 按 ID 对候选分批研究，每批最多五条 |
| `slang_research_batch` 工具 | 控制台手动研究 | 接收 1–5 个明确的候选 ID，等待写回并返回实际成功、失败数 |
| `services.slang.reset/forget/clearWindows` | 重置/清空会话 | 清组件内窗口与冷却 |
| `services.slang.stats()` | 调试 | 当前窗口键与长度 |

## 桥接给的能力（组件不直连 DSH / 不写文件）
- `slangConfig()`：`socialV2.slang` 配置（enabled / extractMinMessages / extractCooldownMs /
  inferenceThresholds / autoResearch / injectMax / learnerPreset）。
- `slangList()` / `slangSave(entries)`：读/写 `state/slang.json`（桥接负责落盘与上限裁剪）。
- `slangLearnerPrompt(text)`：桥接创建/复用一个受 safe preset 约束的学习会话，投递 prompt、
  等回合并返回文本（网络与 DSH 连接属于桥接职责）。

## 抽词/研究逻辑
复用 `src/slang-learner.js` 的纯函数：`buildExtractionPrompt` / `parseExtractionJson` /
`buildResearchPrompt` / `parseResearchJson` / `upsertSlangEntry` / `buildSlangContext`。
有可用解释的研究结果写入候选词条，仍由管理员确认；不确定结果记录研究次数，控制台显示「已研究仍不确定」。控制台按所选 ID、每批最多五条等待写回，避免一次研究过多超过桥接等待时限。旧的 `/api/slang/research` 端点目前不用于控制台。

黑话库只记录群内黑话、梗、缩写和特殊语用。游戏玩法、共同兴趣知识及圈层文化背景走 `ctx-interest-terms`；不能把“入圈/退圈/出圈”误记成三角洲玩法。

## 边界
- 不直接发送 QQ 消息、不创建 DSH 会话、不写 `state/slang.json`（只通过能力）。
- 桥接里的控制台 `GET /api/slang`、确认/删除、`qq_slang_query/submit` 仍走桥接数据面；
  组件只管「学习和注入」。
- 组件禁用时：桥接的 `withSlangContext` 退回直接读库拼黑话表（仍可注入，但不学习）。
