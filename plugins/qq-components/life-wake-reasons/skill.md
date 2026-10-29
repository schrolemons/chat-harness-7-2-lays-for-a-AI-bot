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

## 统一静默调度

本组件同时拥有`proactive`服务，不直连QQ/DSH。唯一扁平policy来自manifest/configSchema；旧care/idle/proactive配置别名不在运行期双读。`validateConfig`与导出的`validateProactivePolicy`同步返回{ok,errors}，用于宿主拒绝区间倒置、初始概率大于上限、兜底小于静默/最小主动间隔等错误。关闭或disabledReasons含proactiveCheck不排主动任务。

宿主热加载entry的generation查询沿index→proactive→proactive-policy传递，index直接使用的配置验证也使用同代policy；更新helper后不会因ESM静态缓存保留上一代策略。

`proactive.policy()`返回当前policy。`plan({key,now,facts,mood,random})`在静默阈值后，以心情frequencyFactor和聊天意愿相乘求唯一阶段概率与变化区间；区间下限有正数硬边界，0心情/意愿仍有有限机会。概率`min(pMax,(p0+n*step)*e)`，区间端点`max(floor,(base+n*intervalStep)*(2-e))`。初始静默阈值后再等待第0阶段抽取区间；最大静默会截短到兜底截止，最小主动间隔仍是硬边界。

`refresh({key,now})`仅使用ctx.scheduler建立每key一个任务，保存stage/jitter/nextAt，刷新和重建不重抽旧计划。实际due回调复查allowed/paused/quiet/curfew/budgetAllowed/busy/pendingPurpose/rateAllowed，只有合格的随机失败才推进stage。最大静默只跳过随机概率，不绕公共闸门。缺能力不创建忙重试；受阻时保留原due，等待宿主刷新或统一60秒组件tick。

同步`caps.getProactiveFacts(key)`须返回allowed/paused/busy/pendingPurpose/quiet/budgetAllowed/lastIncomingAt/lastOutboundAt/mood，allowed应包含公共出站资格；busy包含真实active turn、pending/accepted wake及queued非终态envelope。`caps.requestProactiveWake({key,reason:'proactiveCheck',intent,at})`只请求既有唤醒，返回true/{accepted:true}/{ok:true}表示接受，绝非确认发送。没有实际可见发送时环境调用`finished({key,now})`释放，保留原静默起点，等待新完整区间，stage不加分。服务重建后，原accepted仅在busy严格为false且没有pendingPurpose时释放为recovered-orphan，写入lifecycleHistory一次；活跃/待启动回合保留。

`observe({key,at,kind:'incoming'|'sent',reason,eventId,episodeId,hasText,hasImage,isSelf,success?})`只接受真实事实。非自身文本/图片与确认可见发送结束旧静默；机械thinking/ack不算。kind=sent本身表示环境已确认成功，success=false会防御性拒绝，未知投递不得调用。eventId永久去重；multipart更新每部分lastActivityAt，但意愿按episodeId只变化一次。旧时间事实留去重凭据，不重置较新计划或改变意愿。返回旧静默阶段的{reengaged}供环境在mood.incoming前使用，不同步触发唤醒。普通回复reason须规范为message/reply（兼容private/question/atMention/poke），不自动改变意愿；主动和目的发送按purposeWillingnessDelta收敛。

`setWillingness({key,value,reason,now})`严格0–100并需明确原因，来源ai；活动调整来源activity/purpose，默认来源default，独立lastAI始终保留最近真实AI评估证据。`preview({key,now})`完全只读，返回stage/willingness/source/lastAI/effectiveProbability/effectiveInterval/nextAt/blockedReason/intent/phase/lastFinishedReason。`isCurfew({now})`按上海时，开始含、结束不含；起止相同表示不设时段。

## 边界
- 唤醒尾巴仍只产指令文案；静默状态保存在本组件state，不写桥接业务字段。发送/入站事实与公共闸门由环境供应。
- 文案里引用的工具（qq_send_message / qq_mark_read / qq_task_result…）由 MCP 工具面提供，本组件不注册工具。
- 插件被禁用时桥接仍能唤醒（通用尾巴），只是失去该 reason 的专门引导。

2026-10-29 窄传输接口：proactive.cancel({key}) 取消该随机主动job；allowsReason({reason,now?,hasPendingHuman=false}) 返回 allowed/reason，由组件统一判宵禁，replyCheck/timeout 无真实待处理来信时只能观察，日程提醒豁免宵禁。observe 的 incoming 仍要求非自身文本/图片；sent 只接收环境确认的真实成功，语音/拍一拍/文件也算活动，mechanical不算。桥接实际 turn/end 调 finished，释放已接受但未发送的机会。
