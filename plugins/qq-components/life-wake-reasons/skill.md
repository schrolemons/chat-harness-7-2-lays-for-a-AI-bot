# skill：唤醒原因尾巴（life-wake-reasons）

## 它解决什么
`buildWakePromptV2` 以前用一长串 `if (reason === 'xxx') return base + '…'` 拼「这一轮该干什么」：
17 段指令写死在 `bridge.js` 里，改一句话要动主程序、不能单独开关、也看不到谁在注入什么。
现在这些文案是 L 层组件，桥接只负责触发前的**事实与副作用**。

## 什么时候被调用
`wakeTail`：每轮唤醒拼提示词时，桥接清完 pending 标记（`pendingReminderItems` /
`pendingTaskReport` / `pendingTimeBubble`）、读完优化记录后调用 `pluginHost.collectWakeTails(payload)`。
组件返回一段尾巴，桥接把它接在 base 后面；组件缺失/禁用/返回空时桥接退回通用尾巴。

## 支持的 reason
`bootstrap` / `timeout` / `replyCheck` / `careCheck` / `newsShare` / `idleRescue` /
`selfOptimize` / `selfReview` / `memoryWrite` / `newFriend` / `timeBubble` /
`startupGreeting` / `taskDone` / `reminder` / `proactiveCheck` / `poke` / `budgetRecovery`；其它（普通唤醒、
`atMention@seq…` 等）走默认「先看消息再决定」的尾巴。

## 输入（桥接提供，组件不读内部状态）
| 字段 | 用途 |
| --- | --- |
| `key` / `reason` | 会话与原因 |
| `preSleepMs` | replyCheck 文案里的观察时长 |
| `triggeredLine` | 默认尾巴里「触发消息多旧」 |
| `history` | selfOptimize / selfReview 的历史优化记录 |
| `taskReport {title,taskId}` | taskDone 的转达指令 |
| `reminderItems` | reminder 的日程条目 |
| `peer` | newFriend 的 QQ 号 |
| `maxItems` / `maxChars` / `unreadCount` | 相关文案的参数 |
| `doubleStampEnabled` / `doubleStampWindowCount` | 按条数生成的入站消息双戳回查指令 |

## 双戳窗口回查

启用时，每条新消息会触发最近 A 条历史消息（再加当前消息）的检查。Harness 在消息实际交给模型后记录 `seenAt`；模型完成处理后必须调用 `qq_report_message_receipts`，以 JSON 按 `conversationId` 和每条 `seq` 返回 `seen` / `replied` / `complete` / `anomaly`。相似消息可合并回复，但回执逐条提交。只有本轮 QQ 发送成功后才能报 `replied`；异常状态由 Harness 保留并写入检查状态/日志。

## 配置
`disabledReasons: []`：填某个 reason（如 `"poke"`）后，该原因的尾巴返回空 → 桥接走通用兜底。

## 边界
- 只产「指令文案」；不读文件、不发消息、不改会话状态。副作用（清 pending、读记录）留在桥接。
- 文案里引用的工具（qq_send_message / qq_mark_read / qq_task_result…）由 MCP 工具面提供，本组件不注册工具。
- 插件被禁用时桥接仍能唤醒（通用尾巴），只是失去该 reason 的专门引导。
