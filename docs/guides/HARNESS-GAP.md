# Agent Harness 七层对照与本项目缺口（HARNESS-GAP）

> 对照对象：管理员提供的《Agent Harness》笔记（ETCLOVG 七层：Context/Memory、Tooling、Execution/Sandbox、Lifecycle/Orchestration、Observability/Operations、Verification/Evaluation、Governance/Security），
> 加上 Cross-Cutting Concerns（层间耦合、成本质量速度、能力控制取舍、标准化、生态缺口）。
> 本文只描述**现状与缺口**，并给出命名约定；生成于 2026-10-25。

## 0. 命名约定（两层命名）

- **插件 id：`<layer>-<domain>-<action>`**，layer 取七层首字母小写：`ctx` / `tool` / `exec` / `life` / `obs` / `eval` / `gov`。
  例：`ctx-memory-profile-store`、`life-proactive-time-bubble`。
- **插件目录**：`plugins/qq-components/<id>/`，固定三件套 `plugin.json` + `index.js` + `skill.md`；
  `plugin.json` 里用 `layer` 字段声明所属层（`C/T/E/L/O/V/G`），分类页按层浏览。
- 桥接内核里只剩下：传输/会话状态/调度/发送/鉴权；**所有「口径与策略」文本都在插件 skill 里**。

## 1. 七层对照

| 层 | 本项目现状 | 覆盖度 |
| --- | --- | --- |
| **C 上下文与记忆** | 短期：提示词装配（角色/时间感/参与度/插件块）+ 快照与水位；中期：`state/memory/tasks-*.md`（qq_task_note）；长期：`state/memory/*.md` 持久记忆/日记 + `state/user-profiles.json` 全局画像（完整/可分享两层，脱敏）；压缩：快照字符上限、记忆截断、插件块长度上限 | 高 |
| **T 工具接口与协议** | MCP（`mcp-snowluma-safe` / `mcp-host-server` / `mcp-web-search-safe`）；29 个 `qq_*` 工具按 `socialV2.tools` 开关注册；工具描述+token 鉴权；`/api/plugins/call` 支持插件自定义工具 | 高（缺 A2A、OpenAPI 描述、工具签名/版本） |
| **E 执行环境与沙箱** | DSH sandbox（workspace-write / danger-full-access + 审批）；管理端开发模式自动放行 owner 写操作；浏览器走真实 Edge CDP；`state/` ACL 收紧 | 中（缺统一沙箱抽象层、可重置环境、代码沙箱隔离） |
| **L 生命周期与编排** | 单 agent 循环由 DSH 驱动；桥接负责唤醒/回合/退役/看门狗/热重启；社交循环 5s tick；插件可按 `schedule` 定时、可 `askAI` 反向调用；会话可恢复（pendingWake） | 中（缺持久化 checkpoint/回放、多 agent 编排、Issue→PR 任务跑道） |
| **O 可观测性与运维** | `state/bridge.log`、`qq-activity.log`、工具调用日志、token 账本/用量页、`_optimization.md` 优化记录、插件状态文件；看门狗自动修复（重连/退役） | 中（缺 trace/span 结构化、成本归因到回合/任务、异常检测与根因分析） |
| **V 验证与评估** | 只有**离线自测**（`npm run test:audit` 等）+ 6 小时自查（`system-self-review`）；没有任务级基准/评分器/回归轨迹 | 低（缺评估五阶段：基准、检查准备、受控执行、归因、反馈回归） |
| **G 治理与安全** | 白名单、控制台令牌、会话令牌、内容闸门（注入中和/违规/限长）、画像脱敏、出站敏感信息拦截、ACL、审批策略、管理端边界、看门狗限频 | 中高（缺统一策略语言、审计轨迹、权限随任务动态收缩、供应链治理） |

### 贯穿层的问题

- **层间耦合**：唤醒频率影响成本与观察窗口；插件块长度影响上下文；发送频率影响治理。
- **成本/质量/速度**：更多检查=更高延迟；目前只在 token 账本里记消耗，没有按任务归因。
- **能力控制取舍**：工具从 29 个继续增加会拉低选择质量，应该按场景收窄工具面。
- **标准化**：MCP 有了，但缺 OpenAPI/A2A/AGENTS.md 层面的互操作约定。
- **生态缺口**：跨工具互操作、故障恢复、人机交接仍靠桥接自定义实现。

## 2. 具体缺口清单（可执行）

1. **trace/span 结构化**：把「一次唤醒 → 工具调用链 → 发送 → 收尾」记成一条 trace，span 记模型调用/工具耗时/失败原因；当前只有平铺日志。
2. **任务级成本归因**：token 账本按「任务/插件」维度聚合，而不是只按会话/时间。
3. **评估闭环**：把真实失败转成可重复用例（失败消息 → 期望行为 → 回归脚本），与 `test:audit` 打通。
4. **checkpoint/恢复**：插件与桥接共用一个 `state/checkpoints/` 约定，长任务可从中断点续跑。
5. **沙箱抽象**：把「DSH 沙箱 / 管理端危险模式 / 浏览器」抽象成统一执行后端接口，便于替换与可复现。
6. **策略声明化**：把白名单/工具开关/审批边界抽成声明式策略文件（当前散在 config 与代码判断里）。
7. **审计轨迹**：谁在什么时候让 agent 做了什么（尤其管理端危险操作），保留不可改写的审计条目。
8. **A2A/AGENTS.md**：给未来多 agent 与仓库级上下文预留接口（现在只有单体）。

## 3. 已经做对的（保持）

- 提示词工程全部组件化（插件 + skill.md + 确定性判定 + 冷却/限频）。
- 两层记忆 + 跨会话画像 + 脱敏闸门。
- 发送/等待/收尾的机械约束（沉睡前观察、分条上限、发送限频）。
- 看门狗与热重载：运行时的自愈能力。

## 4. 下一步顺序建议

1. trace/span + 成本归因（O 层）——所有后续评估都依赖它。
2. 评估闭环（V 层）——先挑 3 个高频失败做回归用例。
3. checkpoint（L 层）——长任务续跑。
4. 策略声明化 + 审计（G 层）。


## 5. 目标结构（七层全插件化）

桥接最终只保留「环境管理」职责：传输、会话状态、调度、发送、鉴权、宿主。
其余全部以插件出现，插件 id 用 `<layer>-<domain>-<action>`：

| 层 | 现有插件 | 计划插件（缺口） |
| --- | --- | --- |
| C | ctx-memory-profile-store / ctx-memory-profile-facts / ctx-memory-update / ctx-chat-topic-drive / ctx-chat-reply-shape / ctx-media-sticker-pick | ctx-persona（人格提示词装配）、ctx-context-budget（token 预算与压缩策略） |
| T | （无） | tool-registry（工具 schema/权限声明）、tool-qq（QQ 工具面） |
| E | （无，当前由 DSH 沙箱承担） | exec-sandbox（统一执行后端）、exec-browser（浏览器能力） |
| L | life-proactive-time-bubble / life-proactive-startup-greeting | life-wake（唤醒策略）、life-session-checkpoint（断点续跑） |
| O | obs-self-review | obs-trace（trace/span）、obs-cost（任务级成本归因） |
| V | （无） | eval-bench（任务基准）、eval-regression（失败转用例） |
| G | （无，当前散在 env/config 里） | gov-policy（声明式权限与工具开关）、gov-audit（审计轨迹）、gov-content-guard（内容闸门） |

实施顺序：**G → T → E → V → L**（先治理与工具，评估和编排最后补齐）。
每一层迁移都遵守：先备份、node --check、可回滚、管理页可见、运行验证。
