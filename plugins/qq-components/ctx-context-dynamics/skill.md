# ctx-context-dynamics

按宿主提供的心情、表情配置与一次掷骰结果输出动态提示；维护回合不注入。

插拔、配置和验收参见 docs/guides/PLUGIN_RUNTIME_CONTRACT.md。运行 npm run test:plugin-audit，测试使用隔离文件和模拟端点。


## SCHNIE 正式模式协调（2026-10-26）

通过 schnie-core/turn-policy.mjs 共用当前逐轮路由。phi/care/现实支持模式抑制与认真回应冲突的玩梗、多条碎句、表情或另起话题要求；普通闲聊保留既有行为。仅协调提示词，不记录心理判断、不自动发送消息。S层停用后恢复普通规则。

2026-10-29：心情块仅渲染 moodState 的 modeName、score、styleInstruction、配置规则与真实 history；不重算高低阈值，不重复规定发送条数。无心情服务时不编造分数。
