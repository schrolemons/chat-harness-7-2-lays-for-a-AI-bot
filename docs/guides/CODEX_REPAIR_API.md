# Codex 修正接口

入口位于 O层 → 日记与反馈 → 反馈工具参数 → **启用 Codex 修正接口**。默认关闭，本组件配置为 `obs-self-review.codexRepairEnabled`。不替代 Bot 自查、DSH 研究或现有反馈工具，不执行代码、命令、模型调用或重启。

管理员使用现有控制台令牌调用 `GET /api/socialV2/self-review-feedback/repairs` 查看定义；`POST` 提交验收结果。普通 QQ agent token 无权调用，浏览器写请求必须同源。不要把令牌放进URL、文档或Git。

Codex 开始反馈扫描或修复前，先请求上述 GET 并确认 `enabled === true`。返回 false 时，必须立即停止扫描、修复和提交，提示用户到本页勾选并保存“启用 Codex 修正接口”，等待用户操作后重新检查；不得自行开启，也不得改读 state 或换接口绕过。鉴权失败、接口不可用或状态不明也不能继续。提交前再次检查，用户中途取消后停止；服务端对关闭状态下的 POST（含 dryRun）返回403。此开关控制 Codex 协助流程，Bot 既有自查、普通反馈记录和日记、日报功能各自保持独立权限。

```json
{
  "runId": "codex-2026-11-01-bot-issues",
  "dryRun": true,
  "items": [{
    "id": "从反馈列表取得的真实编号",
    "summary": "修复点与核验结论",
    "classification": "code_fix",
    "evidence": ["相关回归脚本通过", "当前运行指纹及状态核验"]
  }]
}
```

先 dryRun 预检；确认返回 willResolve 无误后，删除 dryRun 或设为false，再提交相同内容。每批1–100条；id不重复；summary最多500字符；每项1–12条验证依据，每条最多300字符。接口不会替开发者执行这些验证，开发者必须如实提供已取得的证据。

classification 可选：`code_fix` 本轮修复代码；`already_fixed` 近期已修且本轮复验；`operational_recovered` 历史运行故障目前恢复，不能推断原始唯一根因；`not_a_bug` 正常维护或风险提醒等非程序故障，必须解释结案含义，尤其不能声称现实人身风险已解除。

每批全量校验，未知编号、删除状态、DSH正在研究或证据不合格时整批拒绝。已结案问题跳过。正式提交会保存已修复状态、完成时间、修复分类与批次号；统计从同一总账重算，不维护第二套计数。

成功返回 `ok:true`、`logSynced:true`、`resolvedCount`、`counts` 和现有扫描/修复 Markdown 的路径。原始反馈不删除，原日记正文不改写；日志追加到 `_optimization.md` 的“统一修复摘要”。

日志采用持久待同步记录和唯一批次标识。文件写入或日志回执保存失败时返回503、`stateCommitted:true`、`logSynced:false`，表示状态可能已成功写入但收尾尚未完成。用相同runId、相同items重试会只补缺失日志，不重复计数或添加重复摘要；不要换runId逃过失败。同一runId内容不同返回409。

仅收到最终成功回执后才报告整批完成。随后重新GET反馈列表核对编号、待处理数和已修复数；前端刷新后显示同一份统计。资料与凭据仍遵守本项目私有仓库、日志脱敏和角色卡不可擅改的约定。
