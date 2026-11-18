# E 层预设模型设置

唯一入口：控制台 → E 层 → 预设总览 → 模型与思考强度。页面顶部提供全局默认 provider/model/effort，一次保存同时更新默认对话与普通任务。启用单独设置的预设使用自己的配置；未启用的预设继承默认设置。保存全局默认保留所有单独配置和独立任务范围；关闭某项单独设置并保存才恢复继承。不再根据 Pro、复杂任务或其他关键词自动升级，也不读取 config.json 中旧的 dsh 模型字段。

qq-task-worker 是特殊预设，配置 allowed 数组，每项为 provider/model/efforts。发起任务的模型先调用 qq_task_models 查询允许范围与 DSH 当前目录的交集，再以 modelSelection={provider,model,effort} 调用 qq_task_spawn。范围只剩一个组合时允许省略选择，以兼容原调用。任务持久保存选择；续办仍核对当前范围，超出范围时拒绝新输入，模型可以查询范围后在 qq_task_input 中重新选择。权限、问题回答和 requestId 去重规则保持不变。控制台直接发起的反馈研究没有发起模型，使用普通任务默认组合，但仍须位于同一允许范围。

所有可选模型、provider 和思考档位从 DSH 目录读取。支持跨 provider 同名模型、off 和自定义档位；空 effort 表示模型默认，传输时省略 reasoningEffort。不能强行给不支持思考档位的模型指定档位。目录失联或组合失效时拒绝保存，保留草稿，不替换成隐藏备用模型。

设置按行保存并以 revision 防止覆盖别人的修改。保存后同步已有对话、学习会话和允许范围内的未完成任务；正在生成的请求不追溯切换。部分同步失败会显示明确错误，已保存与同步成功分开报告。范围收窄不自动更换既有任务的模型；下一次输入会拒绝越界选择。

全局默认沿用控制台鉴权的 POST /api/presets/model-policy，参数为 {scope:"global",selection:{provider,model,effort},revision}。GET 同路径返回当前 config、revision 与 supportsGlobalDefault。服务端先验证目录与 revision，再一次写入两个默认值并同步一次；不循环逐项保存，不改变 presets 中的覆盖项。旧运行进程未加载该接口时，前端禁用全局保存并说明不可用，单项入口继续可用。

旧版 defaultProvider/defaultModel/defaultEffort 只读迁移为对话和普通任务默认值；旧升级规则退休。旧固定 qq-task-worker 设置迁移为一个组合的范围。组件停用时仍读取保存的配置；损坏配置拒绝调用。旧 O 层和通用组件配置写入口停用，避免多份权威。

原生上下文压缩通过 qq-agent-presets/default-compaction.mjs 薄适配层，每次摘要读取 E 层当前全局默认（conversation），同时继承供应商、模型和思考档位；预设不再写死摘要来源。完整原生压缩指令、检查点、模型身份和用量由原生后端保留。普通后台任务与记忆整理没有覆盖项时继承 task；全局保存会同时更新 conversation/task，独立任务的允许模型范围仍保留。

原生 selectModel 会改桌面全局默认，桥接现在串行保存并通过版本校验恢复这一副作用：单独任务、看图及预设覆盖不改用户默认；并发的用户新选择优先。只有显式保存全局/对话默认才同步桌面默认。此能力和原生压缩适配需要加载新的 bridge/预设代码，组件热加载成功不等于核心已更新。

二代聊天/管理员聊天的 maxContextTokens=65536 只约束该预设的压缩压力测量；不修改供应商模型实际容量，不缩小独立任务的窗口。实际触发同时受 thresholdRatio、输出预留与headroom限制；小容量模型取更小容量。后台摘要的真实usage独立入账并标为压缩摘要，不冒充QQ回复轮数，未匹配价目表的调用仍只统计token。

验证入口：npm run test:models。所有回归使用临时状态和模拟传输；MCP tools/list 测试使用临时服务，不能把插件注册等同于 MCP 实际暴露。代码和待启用包的验证不代表已经部署或完成真实推理验收。


2026-11-12 上游额度：modelAvailability只记录真实模型turn/end中的budget_exceeded/ExceededBudget拒绝，与本地价目表和金额账本分离；同provider模型共用15分钟请求冷却，retryAt仅为最早允许重试，不宣称学校额度已恢复。最终模型请求、普通唤醒、补话与后台评估核对当前选中provider，切换到未受限来源不继承USTC限制；独立任务模型范围不改。
