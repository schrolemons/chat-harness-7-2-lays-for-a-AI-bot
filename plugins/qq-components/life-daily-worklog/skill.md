# skill：每日工作总结（life-daily-worklog）

## 它解决什么
「今天到底干了什么」以前只有两个去处：每小时重写一次的永久记忆（4000 字上限、靠模型归纳），
以及 22:00 发到 QQ 的【日记】。细碎的开发改动主要记在中期任务进度里，不保证进永久记忆。
本插件每天固定时间把散落的运行数据汇总成一份**可回溯的 Markdown 日报**。

## 什么时候被调用
`onTick`：插件宿主每 60 秒触发一次。只有满足下面条件才真正干活：
- 已过当天配置的 `hour:minute`（默认 23:00），或桥接重启后发现**昨天**的日报缺失；
- 对应 `state/memory/worklog/<日期>.md` 不存在；
- 同一个日期两次失败尝试间隔 ≥ 30 分钟（`state/plugins/life-daily-worklog.json` 记录）。

## 数据来源（只读）
| 来源 | 内容 |
| --- | --- |
| `state/memory/tasks-*.md` | 小鲸鱼收尾前用 `qq_task_note` 记的中期进度（按当天日期过滤） |
| `state/tasks.json` | `qq_task_spawn` 开的任务会话（标题/状态/结果摘要） |
| `state/tool-calls.jsonl(.1)` | 当天工具调用次数、失败次数、TOP 工具 |
| `state/token-usage.jsonl(.1)` | 当天模型调用步数与输入/输出 token（按会话、按模型） |

## 产物
`state/memory/worklog/<YYYY-MM-DD>.md`，五个小节：概览 / 任务会话 / 当日进度记录 / 工具调用 / Token 用量。
超过 `config.maxChars` 会截断并标注。当天完全没有数据时不写文件（30 分钟后重试）。

## 配置（plugin.json 的 config）
- `hour` / `minute`：生成时间，默认 23:00（本地时区）。
- `sendToOwner`：生成后是否把摘要发到管理员 QQ，默认 `false`。
- `maxChars`：单份日报最大长度，默认 6000。

## 边界
- 只读运行数据，只写 `state/memory/worklog/` 与自己插件目录下的状态文件；不碰永久记忆目录里的其它文件。
- 不改唤醒计划、不发群消息；`sendToOwner` 走桥接的 `notifyOwner` 能力（owner 私聊）。
- 日报是**数据汇总**，不替代永久记忆；是否要把它注入提示词由后续需求决定。
