# 会话与回复的当前合同

本页说明 2026-11-03 核验后的职责边界。兼容不同存储或协议格式，不表示同时执行两套业务标准。

## 标题

- 原生 `qq-agent-presets/session-title-fallback.mjs` 负责受管预设或所属工作目录的用途名，也覆盖不经过 Node 客户端的内部会话创建。
- 初始预设来自 `session.header.agentPreset`；若已有 `agent-preset/selected`，最后一条选择覆盖初值，空选择也不回退。
- 标题通过 DSH 的 `sessionTitle.rename` 写入，不自行拼装 fallback 来源记录。用户或 provider 后续给出的标题优先。
- `createTitledSession` 只为没有指定已有 `sessionId` 的显式命名请求执行一次 rename。普通用途名交给原生插件，复用会话不自动改名或归档。
- 历史记录修正必须作为单独授权的运维操作执行，不藏在创建、重连或读取流程里。
- 已退休的学习会话只在无等待者、无实际运行 collector 时解除后续订阅；当前学习会话及普通聊天/任务的共享订阅不由它清理。RPC 响应失败不能证明已经观察到的模型回合停止。

## 正文与引用

- `plain` / 详情结果的 `ownPlain` 保存本条自身的完整正文；`text` 可以包含已解析的引用，二者不能混用。
- 从详情恢复正文时同时更新 unread 与 recent 的两份缓存，完整性标志必须与实际正文一致。
- 完整新正文可省略无法取得的引用并记录 `omittedReplyIds`。残缺本条正文、空网关结果或仅有引用都不能据此变成完整消息。
- 复用本地引用只接受同会话、可见、完整且消息 ID 匹配的原文，不通过扫描其他会话补齐。

## 回复身份与费用

- 原生 turn / action 表示执行过程，`contentId` 表示已读完整来源的语义内容，两者不是同一个身份。
- 多条来信需先按当前回合已准入的真实 seq 声明分组，并在发送时携带对应 `contentId`。
- 同 action 可处理多份不同内容；重读、重声明或换发送工具均不能刷新已用内容的额度。
- 旧 `replyBatch.renewed` 回执及其通用失败重置已退役。读取消息不解除令牌、网络或额度失败；匹配的新分组只解除相应缺失绑定失败。
- 预算弱状态的 5 条私聊、群聊 5+5 是输入窗口，不是每份回复的拆分上限。硬费用上限保持静默，不补发固定预算话术。

验证入口：`scripts/test-session-titles.mjs`、`scripts/test-group-context-admission.mjs`、`scripts/test-learner-subscription-lifecycle.mjs`、`scripts/test-chat-regression-guards.mjs`、`npm run test:budget`。测试使用隔离夹具，不改真实历史或向普通 QQ 会话发送消息。
