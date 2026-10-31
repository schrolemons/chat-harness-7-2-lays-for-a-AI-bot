# 回复形态与唯一发送计划

2026-10-31：reserve 接收真实准入水位 inputSeq 和拟发送正文，同一批来信的相同文字在成功发送、并发预占或结果未知时不重复执行，成功指纹随账本持久化。只有确定失败才释放；真实新来信的新水位可再次发送相同简短回应。机械通知及日程保持各自的投递语义，不因普通聊天去重被取消。

## 发送上限与重复调用

`send-rejection.mjs` 只将确定耗尽的本批次发送上限归类为 `TURN_SEND_LIMIT`，明确剩余0条、不可重试、先回执再等待新来信。仍有剩余条数、消息太长、鉴权、账户余额和网络错误分别处理，不能混为上限耗尽。

`request-guard.mjs` 由既有 QQ preset 的 context-composer 注册。同一原生回合内，真实发送工具连续两次发生相同错误，且没有新认领入站或后台新授予的回复批次时，在下一次付费模型请求前收口；不杀会话、不重启进程、不删队列。校验原生 tool/call 与 tool/result 配对，只认可错误结果，聊天文字与读取工具错误均不能触发。新回合或实际发送成功清除旧连续失败计数；新认领的消息不被丢弃。它不是“群聊会话自动恢复”的重建机制。

## 发送计划

本组件属于 L 层，拥有全部实际出站的分钟/小时账本、间隔和对话回合条数。桥接在真实模型投递前调用 `replyPlan.resolve`，冻结结果并随 pending/active/completed envelope 携带；beforePrompt 只展示该计划，表情选择也消费同一个计划。

`resolve({key,turnId,incomingText,mood,reason,referenceMode?,agent=true,now?})` 返回不可变 kind/maxMessages/hourlyLimit/minIntervalMs/detailLevel/maxMessageChars/delayPlan/line。心情 replyCeiling 可收紧条数；有效欢迎可采用 casual 上限，仍服从 serious 和资料讨论（最多1条）。没有另一套低心情阈值或最近连发判断。

配置唯一来源为 plugin.json：maxMessagesNormal/Casual/Serious、longIncomingChars、intervalMinMs/MaxMs、longGapProbability、longGapMinMs/MaxMs、maxSendPerMinute/Hour、maxMessageChars。0频次上限表示不限制该时间窗口，0间隔表示无需等待；条数必须1–20。普通/长间隔必须合法有序，请求 fixed 延迟也受同计划边界约束。`src/reply-shape.js` 导出纯 `validateReplyPolicy` 供宿主与迁移共用。

发送调用 `reserve({key,plan,operationId,kind,now,requestedDelay?})`，同步持久预占成功才允许网络写入；`commit({key,operationId,sentAt,deliveryId})` 在物理成功后记账；`release({key,operationId,knownFailed:true})` 只释放确定失败。未知结果保留预占，不伪造成功、不自动重试。`remaining({key,plan})` 跨目标合计同一模型回合的条数；全部文字、图片、语音、表情、拍一拍和文件都占一条真实物理发送。

`initialize({conversations:[{key,sendTimes}],now?})` 仅在没有组件拥有账本的会话导入旧成功时间历史；不重复导入。`preview({key,now?})` 只读返回 minute/hour/successful/inflight/allowed/nextAt。`policy()` 返回配置；`delay({plan,requested?,random?})` 是唯一间隔求解。账本位于组件 state.sendLedger，重载/重启保留预占与成功凭据。

`progress({plan})` 只读返回冻结批次的 successful/inflight/remaining，未知结果仍计为预占，不编造成功。该组件加入逐模型请求刷新名单；beforePrompt 同时展示原计划和最新发送进度，明确已答内容不换说法重发、剩余额度不是目标条数。刷新不调用 resolve/reserve，不授予新额度；真实新来信仍按原批次准入机制处理。

停用或缺失本组件会明确拒绝模型投递与发送，不退回旧 socialV2.send 或无上限。操作者/机械/通知没有模型整轮条数，但仍共享实际目标的频次和间隔；可信存储通知保留既有模型预算豁免及暂停、静默、白名单、时效、收据防重守卫。

验证：scripts/test-resolved-send-plan.mjs、test-outbound-facts.mjs、test-outbound-host.mjs 与隔离 test:plugin-audit；这些是模拟网关/模型证据，不代表生产QQ发送验收。

聊天意愿由proactive.availability读取，调用方不能用payload伪造。与心情共用ctx-chat-reply-shape/engagement.mjs的F公式，先缩放条数再施加现有上限；detailLevel按F分档，styleInstruction只来自心情。低忙闲分数不改变语气或人设；严肃问题仍需完整回答。

2026-10-31 回复批次与错误保护：实际读到新的、超过本回合已准入水位的人类来信时，replyPlan.forMessages只授予一次新批次额度，重复读取旧消息不刷新。桥接读取结果仅在实际授予时带replyBatch.renewed/id/throughSeq；preset不把历史seq本身当作新输入。两次相同真实发送错误后阻断无新认领输入的下一次模型请求，部分成功不算全失败。冷漠私聊计划固定1条、群聊按所选窗口条数，普通分钟上限满时冷漠批次等待释放后继续；小时上限仍有效。可信thinkingAck和budgetExceeded不占普通对话账本，后者另受tokenBudget独立防刷屏。
