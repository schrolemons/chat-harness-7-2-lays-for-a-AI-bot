# skill：自我迭代（self-review）

## 它解决什么
定期收集问题和运行/会话证据，分析后主动改进。管理员明确提出反馈或修复时，另行定向处理其点名问题。

## 什么时候被调用
`beforePrompt` 且 `reason` 是：
- `selfReview`：定期自查（默认 6 小时一次）。
- `selfOptimize`：管理员明确提出反馈或修复后，定向修复这条反馈。

普通统计建议、错误计数或周期自查结果不会触发 `selfOptimize`。反馈修复只接受用户明确表达的反馈/修复意图；群聊或私聊中的原始反馈会转交 owner 管理员会话评估，避免普通用户消息直接获得本地代码修改权限。

## 只做什么
- 对话质量：漏回复、重复、称呼错、表情过多、语气不对。
- 工具调用：失败、被拒、误用。
- 环境执行：桥接/DSH/QQ/浏览器/计划任务/日志异常。
- 修的是**功能、代码、配置**；改代码先备份、`node --check`、最小可回滚。
- `selfReview` 会分析最近会话和优化记录，核实问题并主动做小范围改进；结论写入优化记录。
- `selfOptimize` 只处理管理员明确提出的具体反馈，不顺带处理其他建议。

## 不做什么
- 不凭旧日志、默认 3080、401/403 或空闲事件流宣布断线；先调用 `mcp__bridge-health__bridge_health` 或 `node scripts/bridge-health.mjs --json`。`ready` 时停止连接修复。
- 不反复启动、不用 `--force` 试错。确需重启桥接，先说明修改、理由和影响，等机主明确同意。
- 不改记忆文件（`state/memory/*.md`、日记、持久化记忆）——那是 `memory-update` 插件。
- 不重启 DSH；不碰与桥接无关的系统目录；不为改而改。

## 配置
`config.intervalHours` 仅作说明口径（真实定时在桥接 `socialV2.selfReview.intervalHours`）；
`config.maxFixesPerRound` 控制单轮最多修几项。
