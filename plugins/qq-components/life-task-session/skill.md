# life-task-session — 任务协调（L 层）

聊天会话负责聊天、派单、输入输出与状态管理。涉及执行命令、操作文件或浏览器、制作产物及连续多步处理时，复用既有独立任务工具；无需操作的简短知识解答留在聊天会话。

## 工具

仅管理员私聊的有效会话令牌可用；MCP 名为 qq_task_*。

- task_spawn(token,title,task)：新建 qq-task-worker 会话。task 只传目标、必要背景、源文件位置、约束与验收要求，不附聊天历史、人格、令牌或唤醒规则。
- task_list(token)：查看任务列表。
- task_result(token,taskId)：查看状态、结果、待补充输入和 pendingRequests。读取时会核对最近历史，恢复漏接的结束事件；读失败保留原状态，不猜测成功。
- task_input(token,taskId,input,requestId)：补充同一任务，稳定 requestId 在明确重试时复用；不能为相同输入重复派单。确定未接收可重试；传输结果不确定不能自动重发。普通输入以同一 wireId 投递，由 DSH 去重。
- task_input 的 replyToRequest：回答 pendingRequests 中对应请求。权限决定必须来自用户明确同意或拒绝，用 decision=allowed-once/rejected；问题用原编号 answers。控制类响应结果不确定时不自动重发。
- task_cancel(token,taskId)：取消在跑或待补充的任务。

## 执行与状态

工作会话保留本地文件、命令与联网工具，隔离 QQ 发送、宿主控制及跨会话消息工具。缺少输入时通过 Bot 转达，Bot 将回答投递回原任务。

- running：执行中或仍有已排队补充输入。
- waiting_input：缺少输入、等待权限决定或尚未明确结束。
- done：末尾独占一行 [任务完成]。
- failed：末尾独占一行 [任务失败]，或执行错误/中止/空结果。
- cancelled：用户取消。终态不被迟到或重复事件改写。

末尾 [任务需补充] 返回 waiting_input。标记必须独占末行，正文举例中的标记无效。未返回结束标记的非空回复保留为 waiting_input。补充输入尚未消费时，上一轮完成不提前结束整个任务。

状态先持久化再通知协调器；并行任务分别保留待汇报记录。查询后只确认该版本的回执，避免吞掉新状态。断线快照和按需历史读取只补任务状态，不重发 QQ 历史回复。不同会话的收发队列独立，同一会话保持顺序。

## 汇报口吻

聊天协调器先核实任务状态，用清晰自然的语言说明真实进展、阻碍、下一步和产物。未送达不声称已发送，不照搬内部日志，不附加人物外形、亲昵称呼或情绪表演。

## 维护

任务策略放 task-policy.mjs，协议能力在 bridge.js。index.js 将宿主 generation query 传给策略模块，避免 ESM 热缓存导致新增导出失踪。修改策略后热加载插件，无需为插件重启桥接。核心或 MCP 变更按仓库 AGENTS.md 的运行期纪律启用。
