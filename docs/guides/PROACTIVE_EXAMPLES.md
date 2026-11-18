# 开发者主动行为示例

控制台 → L 层 → 主动行为顶部提供随包预装的示例目录。目录本身不创建会话、日程或发送任务，安装后即可预览；必须选择已有的真实会话、勾选启用并点击“添加示例到此会话”才保存。

| 模板 | 默认值 | 执行入口 |
| --- | --- | --- |
| 时间冒泡 / 定时主动会话 | 每天 09:00、12:30、20:30，建议每日上限 3 | 现有 time-bubbles API → life-proactive-time-bubble / life-scheduler |
| 明日待办提醒 | 明天 09:00，一次性，提前 10 分钟，每 30 分钟提醒 | 现有 schedules API → life-schedule-reminder |
| 每周回顾 | 下一个尚未进入提醒窗口的周日 20:30，每周重复，提前 10 分钟，每 30 分钟提醒 | 同上 |

示例由 `console/layers/L/proactive-examples.js` 生成，没有预置接收人或真实作息。日期以预览时浏览器的本地日期计算，日程通过绝对时间 `dueAt` 保存；页面跨日或提醒窗口已开始时会刷新预览并要求重新勾选。冒泡使用桥接的本地时钟，跨时区使用时请核对桥接所在时区。到点继续服从原有组件开关、会话权限、暂停、免打扰与额度规则；添加示例不保证消息已发送。

应用前重新查询目标会话。冒泡使用 `POST /api/socialV2/time-bubbles` 的追加操作 `{key, appendSlots: [...]}`：服务端在同一同步步骤内读取最新配置、核对锁和容量并保存，按稳定示例 ID 或相同时分跳过已有项，保留已有编辑和锁定项；整栏锁定或加入后超过当前每日上限时拒绝，不删除旧时段、不自动提高上限。成功响应含 `added`、`addedSlots` 与最新的 `all`；追加操作不接受 `slots/reset` 混用，也不修改 `allLocked`。旧的列表替换操作保持兼容。

日程使用控制台专用的 `POST /api/socialV2/schedules`，携带 `{action:"appendIfAbsent", key, exampleId:"模板名:v1", title, dueAt, repeat, leadMinutes, intervalMinutes, detail}`。组件在完整存储中按会话和不可编辑的 `exampleId` 检查，既不依赖前 100 条列表，也不依赖可修改的标题、日期或备注；旧示例备注标记仍可识别。已存在时返回 `{ok:true,added:0,item}` 并保留编辑；新增返回 `added:1`；容量已满则返回 HTTP 409 / `SCHEDULE_CAPACITY`，原有日程不会被淘汰。普通 `add` 行为保持兼容。示例追加不经过模型或创建新定时通道。

保存后的示例可以在同页的时段和日程编辑器中修改、删除或确认完成；加载当前会话后再编辑冒泡。添加示例后的列表刷新保留现有日程提前量、提醒间隔及同一私聊跟进限制的未保存草稿，冒泡编辑器也保留已有行的草稿。日程从首次提醒起按间隔提醒，明确完成本次后停止；每周模板进入下一周。示例没有独立定时器、队列或新的发送通道。当前没有通用控制台定时主动会话 API，因此定时主动会话示例直接使用现有时间冒泡机制。

离线验证：`node --test scripts/test-proactive-examples.mjs scripts/test-schedule-example-append.mjs scripts/test-time-bubble-append-api.mjs`、`node scripts/test-proactive-examples-ui.mjs`。UI 测试在内存编译控制台并使用临时 fixture，不触碰真实 QQ、模型或运行数据。
