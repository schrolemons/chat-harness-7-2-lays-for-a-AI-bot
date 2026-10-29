# 回复形态与唯一发送计划

本组件属于 L 层，拥有全部实际出站的分钟/小时账本、间隔和对话回合条数。桥接在真实模型投递前调用 `replyPlan.resolve`，冻结结果并随 pending/active/completed envelope 携带；beforePrompt 只展示该计划，表情选择也消费同一个计划。

`resolve({key,turnId,incomingText,mood,reason,phiMode?,agent=true,now?})` 返回不可变 kind/maxMessages/hourlyLimit/minIntervalMs/detailLevel/maxMessageChars/delayPlan/line。心情 replyCeiling 可收紧条数；有效欢迎可采用 casual 上限，仍服从 serious 和 phi（最多1条）。没有另一套低心情阈值或最近连发判断。

配置唯一来源为 plugin.json：maxMessagesNormal/Casual/Serious、longIncomingChars、intervalMinMs/MaxMs、longGapProbability、longGapMinMs/MaxMs、maxSendPerMinute/Hour、maxMessageChars。0频次上限表示不限制该时间窗口，0间隔表示无需等待；条数必须1–20。普通/长间隔必须合法有序，请求 fixed 延迟也受同计划边界约束。`src/reply-shape.js` 导出纯 `validateReplyPolicy` 供宿主与迁移共用。

发送调用 `reserve({key,plan,operationId,kind,now,requestedDelay?})`，同步持久预占成功才允许网络写入；`commit({key,operationId,sentAt,deliveryId})` 在物理成功后记账；`release({key,operationId,knownFailed:true})` 只释放确定失败。未知结果保留预占，不伪造成功、不自动重试。`remaining({key,plan})` 跨目标合计同一模型回合的条数；全部文字、图片、语音、表情、拍一拍和文件都占一条真实物理发送。

`initialize({conversations:[{key,sendTimes}],now?})` 仅在没有组件拥有账本的会话导入旧成功时间历史；不重复导入。`preview({key,now?})` 只读返回 minute/hour/successful/inflight/allowed/nextAt。`policy()` 返回配置；`delay({plan,requested?,random?})` 是唯一间隔求解。账本位于组件 state.sendLedger，重载/重启保留预占与成功凭据。

停用或缺失本组件会明确拒绝模型投递与发送，不退回旧 socialV2.send 或无上限。操作者/机械/通知没有模型整轮条数，但仍共享实际目标的频次和间隔；可信存储通知保留既有模型预算豁免及暂停、静默、白名单、时效、收据防重守卫。

验证：scripts/test-resolved-send-plan.mjs、test-outbound-facts.mjs、test-outbound-host.mjs 与隔离 test:plugin-audit；这些是模拟网关/模型证据，不代表生产QQ发送验收。
