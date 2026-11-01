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

### Codex 修正接口

Codex 扫描、修复反馈之前先 GET 修正接口检查 `enabled === true`；提交前复查。未勾选时立即停止并要求用户到 O层 → 日记、日报与反馈 → 反馈工具参数 勾选并保存“启用 Codex 修正接口”，等待用户开启后再检查。不得自行开启、直接扫描 state 或走其它接口绕过；鉴权失败或状态未知同样停止。该开关不替代 Bot 自查与普通反馈的独立权限。

O层「日记与反馈 → 反馈工具参数」的“启用 Codex 修正接口”对应本组件 `codexRepairEnabled`，默认关闭。启用后由现有管理员控制台鉴权访问 `GET/POST /api/socialV2/self-review-feedback/repairs`；普通QQ agent token始终拒绝。提交编号、修复说明、验证依据与runId，一次结案、自动计算统一统计并补写现有`_optimization.md`；规范见 `docs/guides/CODEX_REPAIR_API.md`。支持dryRun，全批验证、相同批次重试幂等；日志写失败保留待同步批次并返回503，不能宣称整个收尾成功。
自查间隔和修复上限统一由控制台「自我更新」设置管理：
- `socialV2.selfReview.intervalHours`：定期扫描间隔，默认 6 小时。
- `socialV2.selfReview.maxSelfFixesPerRound`：自我发现与工具反馈每轮最多修复数。
- `socialV2.selfReview.maxFeedbackFixesPerRound`：用户反馈每轮最多修复数。

组件配置不再保存重复的间隔或修复上限。
