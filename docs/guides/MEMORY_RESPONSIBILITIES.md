# 小鲸鱼四类记忆

| 数据源 | 职责 | 普通聊天注入 |
| --- | --- | --- |
| `state/person-profiles.json` | QQ 号唯一稳定档案：作息、爱好、人际关系、明确边界；最权威 | 当前私聊本人；群聊仅按明确对象查询 |
| `state/memory/<会话>.md` | 逐条重要事实、今日临时画像、展示用日记 | 完整事实与当天画像，预算内选取；日记仅整理回合参考 |
| `state/memory/affairs/<会话>.json` | 任务、承诺、随口安排的唯一当前状态及修改历史 | 活跃事项按优先级/更新时间选择完整条目；完成/取消项不自动注入 |
| 会话 state 的 `activeTopics/pendingThoughts/memberImpressions` | 当前话题、bot待说想法、当前消息窗口内行为印象 | 当前窗口相关内容；窗口外成员与上个窗口的行为印象不注入 |

事实是带原话语境与日期的证据，档案是经过确认的稳定结论；两者不各自维护一套权威人物属性。今日画像不能覆盖权威档案，本人明确更正应核对并更新档案。轻量内容沉淀为有源事实后，才提炼为档案/作息或事务；明确需要定时提醒的事务才关联日程 ID，不另建计时器。

## 事务读写

`qq_task_note` 保留工具名，统一使用 `action=list|upsert`。新建填写 title/detail/status/nextAction/source/priority；修改必须带 list 返回的 id 与 expectedRevision。状态：needs_review（历史待核实）、pending、doing、waiting、done、cancelled、superseded。过了两小时不代表完成，旧文字也不构成当前授权。

管理接口：`GET /api/socialV2/affairs?key=...&status=active|all|具体状态&offset=0&limit=20`；POST 同路径，action=upsert。沿用控制台认证/CSRF；事务和轻量记忆的智能体令牌严格绑定同会话，事务还检查 taskNote 开关与会话允许范围，不继承传话的跨会话授权。工具结果与注入都走同一轻量格式化服务，不保留另一份旧印象文本。

C 层“上下文与记忆”中可查看、筛选、分页、新建、编辑、完成和取消，查看修改历史和事务独立预算预览。保存冲突保留表单并提示重读；不覆盖别人的新版本。日程安排仍在 L 层。

正式日程接管同一个提醒后，仅承载该提醒的事务标 superseded 并保留日程ID；独立待办可继续跟踪工作进度，不复制提醒状态。日程取消不代表工作完成。

## 存储和预算

取消旧 tasks 文件的 `.slice(-15000)` 环形覆盖。事务正文与每次修改历史持续保存；单次 title≤240、detail≤20000、nextAction/source≤2000 字符，超过时明确拒绝而非截断。每轮预算不限制总存储容量。

ctx-memory-context.maxChars 是会话事实/画像注入预算；affairsMaxChars 是事务注入预算。宿主每插件总上限8000，组件预留拼接余量并按剩余空间重新选取事务；事务预览是独立预算预览，组合预算可能收紧。事实按完整行、最近记录优先，画像预留约30%；日记不挤占普通聊天。自动刷新仅提交新增/有源更正事实，合并保留原记录，控制台手工编辑可明确替换；单次提交超过200000字符会明确拒绝，不对累计事实存储环形截断。ctx-memory-update.maxChars 是模型本次整理输出的目标长度，不是文件容量。

## 迁移与收据

首次运行新存储服务时，将旧 tasks Markdown 与旧“未完成事项”导入一次；原文保存在 `state/memory/migration-originals/`，旧原文件不删。历史任务全部标待核实，通知/日记已发记录转入 `state/memory/receipts/*.jsonl`，不进入模型事务上下文。日记是否投递仍以原有发送账本/凭据为准，不能据历史任务或归档正文自动重发。

`node scripts/preview-memory-migration.mjs` 在独立候选目录演练真实输入，输出原文哈希与迁移报告，不改变运行数据。`node scripts/migrate-memory-config.mjs` 只检查旧参数；授权切换时加 --apply，将 midTermSlice 一次性改名为 affairsMaxChars，保留原保存值和配置备份。运行逻辑不再读取旧参数/旧任务文件作为平行来源。

## 验证和启用

`npm run test:memory-management` 覆盖存储/迁移、真实桥接HTTP、配置行为、窗口/日期、辅助模块热加载与真实浏览器的隔离磁盘存储。模块随插件 generation 一起重载，bridge 的窗口视图走插件服务，避免静态导入持有旧策略。

本变更涉及 bridge 路由和 MCP schema，需在获准后协调切换前端入口、桥接重启与 bot MCP 重连；不能只热加载部分记忆插件。当前主线程仍管理控制台整体发布，不在侧会话中切换其入口、提交其未完成改动或重启服务。没有真实 QQ 发送或模型行为验收时，只报告隔离测试结果。
