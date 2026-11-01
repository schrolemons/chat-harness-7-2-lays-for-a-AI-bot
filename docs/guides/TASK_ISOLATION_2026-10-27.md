# AI助手聊天与任务隔离修复（2026-10-27）

## 目标与行为

聊天只负责聊天、派单、用户输入输出和任务状态；执行请求使用既有 qq_task_spawn 新开 qq-task-worker。worker 只接收任务目标、必要背景、路径、约束与验收要求，不携带角色卡、聊天历史、唤醒/沉睡提示或 QQ 令牌。每个新任务独立会话，同一任务补充输入继续原会话。普通闲聊和无需操作的简短知识回答留在聊天会话。

QQ 发消息、语音和表情按会话排队；DSH 事件按 sessionId 排队。同一会话顺序不变，不同会话并行。离线补投也按会话独立排队。管理员任务或某条发送卡住时，不占住群聊处理链路。

## 已核实根因

1. 旧 worker 带聊天人格和社交协议；管理员开发模式还会在聊天会话接管任务，增加提示词与工具回合成本。
2. 全局 sendChain 和串行事件分发把不同 session 的收发绑到一起；独立的 DSH 会话仍会被桥接的共享队列阻塞。
3. 断线快照仅恢复 token 和尚未结束的文本 collector，不补已结束任务；漏掉 live turn/end 后，注册表可能一直 running。补充输入的消费关系也须从快照恢复。
4. 线上 plugins warnings 实际为：插件加载失败 life-task-session: The requested module './task-policy.mjs' does not provide an export named 'taskEvent'。入口带 generation，但依赖模块没有，Node ESM 复用旧导出，使整个任务插件和 task_result 都未注册。

任务 t-mvqfjwb8-e7b8 的原始日志有 turn/end seq=146，最后独占一行 [任务完成]。新恢复器对同一日志输出 done，结果 3852 字。只读证据在 state/task-isolation-recovery-preview.json；未绕过运行进程直接改生产 tasks.json。

## 改动位置

- plugins/qq-components/life-task-session：任务协调提示、状态策略、按任务保留回执、严格末行标记、generation 依赖刷新。
- src/bridge.js：能力 taskInput、排队与幂等投递、问题/权限转达、独立收发队列、断线快照补回、taskResult 按需核对历史。
- src/mcp-snowluma-safe.js：既有 MCP 服务新增 qq_task_input，保留 spawn/list/result/cancel。
- dsh/agent-presets/qq-task-worker 与生成 patch：中性工作协议，保留工作工具；task-tool-restrict 隔离 QQ、宿主、跨会话联络与直接提问工具。
- config.json：下次加载关闭 owner 聊天内开发模式与自动审批。普通聊天仍保留原聊天人格，worker 不带该人格。
- scripts：任务/并发/工具隔离测试加入常规隔离审计。

状态包括 running、waiting_input、done、failed、cancelled。终态不被迟到事件改写；尚未消费的补充输入阻止上一轮提前宣告整个任务结束。确定未接收与结果不确定分别处理，稳定 requestId/wireId 支持明确重试；控制类答复不自动重发。权限决定必须由用户明确授权。

历史核对最多 6 页、每页 500 条、总请求信号 8 秒；证据不完整时保留状态。并发查询合并；读取期间有新事件/取消则放弃覆盖。开放回合只补元数据，不重放 QQ 回复或虚构完成。

## 生效边界（2026-10-27 17:23 已上线）

用户已明确授权重启。桥接由原守护进程重新加载，运行核心 build 与源码 1a8b290314df1904 一致，45 个插件加载、warnings 为空。DSH 重启后地址改为 http://127.0.0.1:56413，已核实原有会话身份后同步配置并恢复连接；没有重复启动守护进程。

任务 t-mvqfjwb8-e7b8 已由新桥接自动从历史快照恢复为 done，lastEndSeq=146，recoveredFromHistory=true。通过 MCP 实际调用 qq_task_result 返回 3852 字完整结果，与前期原始日志恢复预演的 SHA256 一致，磁盘 tasks.json 也为 done。新增 qq_task_input 在工具列表可见；对不存在的任务做无副作用能力探针，已进入新桥接能力，返回“没有这个任务”，没有工具缺失或能力未加载错误。

DSH 新一轮真实聊天请求的 request/header 工具列表包含 mcp__snowluma__qq_task_input；原生 qq-task-worker 读回中性工作协议和 task-tool-restrict，实际 bundle 路径指向当前仓库。保留所有历史会话，不通过删除会话加载新配置。

QQ 网关重启期间 3000/3001 一度没有监听，已用原 SnowLuma 启动器恢复。最终健康检查 ready：控制台、DSH、QQ 传输、QQ 账号和上游心跳全部正常。

本次新增并发验收 5/5 通过：管理员发送堵塞不堵群聊；管理员推理等待不堵群聊；管理员回复发送不堵群聊事件消费；离线队列按会话补投；独立任务投递停住时，管理员私聊与群聊仍能继续。工具隔离检查另 1/1 通过。测试在隔离环境运行，未向真实群发送测试消息，也未额外调用付费模型制造测试任务；实际环境验收覆盖运行版本、MCP 路由、持久状态、原生工具注册与连接健康。

线上核验证据：state/task-activation-live-verification.json。

回滚备份：state/repair-backups/task-isolation-20261027-161414/，另有 bridge.js.bak-task-isolation-20261027-161414。

## 验证

目标回归：npm run test:task-isolation；worker 生成预设一致性；MCP stdio 握手与工具列表；插件契约/投递/能力测试；bridge 与 MCP 语法检查；实际原始日志恢复预演。

最终目标回归 24/24；插件契约/投递/能力 19/19；插件插拔矩阵 48/48；token economy 36/36；MCP 三个服务握手成功，snowluma 工具列表包含 qq_task_input。源码核心 build 为 1a8b290314df1904。

全量隔离审计 39/45 组通过：context-dynamics 的旧表情话术断言、plugin-repairs 缺少 campus fixture root、campus-grab 缺少 MONITOR_SCRIPTS、whale-persona 的人格文案断言未通过；另有 matrix 与 token economy 在并行审计中 90 秒超时，单独隔离复跑分别 48/48 和 36/36 通过。前三项已用原 bridge/原任务插件隔离回放确认相同失败。完整结果在 state/plugin-audit-regressions.json 与 state/task-isolation-timeout-recheck.json，未将全量审计报告为全绿。

这些优化没有通过付费模型实测日费用降幅；用量成本的既有审计见 COST_OPTIMIZATION_2026-10-27.md。
