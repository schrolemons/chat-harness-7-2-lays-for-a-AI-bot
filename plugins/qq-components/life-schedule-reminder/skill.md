# skill：日程工具与提醒调度（life-schedule-reminder）

## 它解决什么
以前「日程」只是提示词里的一条约定：模型把 `日程｜YYYY-MM-DD HH:MM｜标题｜…` 写进轻量记忆的
activeTopic，桥接用正则解析、到点提醒。问题是没有工具（只能记、不能查/不能取消）、格式容易写错、
而且存在会话状态里，`/api/socialV2/reset` 一重置就没了。

本插件把日程变成独立的数据 + 独立工具 + 独立定时：
- 存储：`state/plugins/life-schedule-reminder.json`（插件 state，跨会话重置保留）；
- 工具：模型用 `qq_schedule`（add / list / cancel / update）增删改查，桥接路由
  `POST /api/socialV2/schedules` 做令牌/白名单/开关校验后转给本插件；
- 调度：`onTick` 每 60 秒，按**每条日程自己的** `leadMinutes`（提前多少分钟；未指定用全局
  默认 `advanceMinutes`，默认 30）把到点条目交给桥接能力
  `requestReminderWake`，由桥接放 `pendingReminderItems` 并发出 `reason=reminder` 的唤醒；
- 展示：`beforePrompt` 注入未来 `horizonDays`（默认 14）天的日程，模型不用自己盯时间。

## 数据格式
一条日程 = `{ id, key, title, place, detail, dueAt, repeat, createdAt, leadMinutes?, updatedAt?, lastRemindedAt, firedAt }`。
- `leadMinutes`（可选）：这条日程提前多少分钟提醒，0–1440，0 = 到点才提醒；**缺省字段/旧数据 = 用全局默认
  `advanceMinutes`（默认 30）**，行为与旧版写死 30 分钟一致；到点唤醒时刻 = `dueAt - leadMinutes * 60000`。
  超范围时夹取到 0–1440，并在 `add`/`update` 返回里带 `leadClamped: true` 与说明；
- 控制台「日程提醒与排程总览」可逐条查看/修改提前量，调用 `schedules.update`，无需重启桥接，下个 tick 即生效。
- `repeat`：`none`（一次性，提醒后保留 7 天，可用 `includePast: true` 回顾）/ `daily` / `weekly`；
- 一次性条目过期超过 `lateMinutes`（默认 120 分钟）静默标记 `expired`，不补发陈年提醒；
- 重复条目提醒后自动顺延到下一次，错过多期直接跳到未来最近一期。

## 配置（plugin.json 的 config）
| 键 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | true | 停用后不提醒、不注入（存储与工具仍可用） |
| `advanceMinutes` | 30 | 全局默认提前量（分钟，0–1440）；日程未指定 `leadMinutes` 时使用，可在控制台改，插件自动 reload 后对新旧「未指定」条目都生效 |
| `lateMinutes` | 120 | 一次性条目过期多久后丢弃 |
| `horizonDays` | 14 | 提示词里展示未来几天 |
| `maxItems` | 200 | 最多保存多少条（超出淘汰最旧） |
| `maxPromptItems` | 8 | 提示词里最多列几条 |

## 调用时机
- `onTick`：插件宿主的统一调度（`schedule.everyMs = 60000`，走 life-scheduler）。
- `beforePrompt`：普通对话唤醒时；`memoryWrite / selfReview / selfOptimize / slangLearn` 等内部回合跳过。

## 统一日程存储
旧格式日程已完成迁移，当前会话状态中没有待迁移条目。旧格式的登记、显示、解析与提醒路径已移除。
控制台「日程提醒与排程总览」直接列出所有 `life-schedule-reminder` 存储会话（包括尚未出现在当前会话列表中的会话），
添加使用 `schedules.add`，删除使用 `schedules.cancel`；列表不再显示「新/旧」标签。

### 默认展示与历史查询
- `schedules.list`、`schedules.listAll`、控制台总览和 `beforePrompt` 默认只展示 `dueAt > 当前时间` 的未来日程；已发生、已过期、已取消或已完成的记录不进入默认展示。
- `firedAt` 表示提前提醒已交给桥接，不表示事情已发生：一次性日程在提前提醒后、实际时间到来前仍然展示。
- 每天/每周重复记录即使当前保存的时间已过去，展示时也计算最近的未来一期；只生成展示副本，不改写存储或触发提醒。实际提醒与顺延仍由 `onTick` 处理。
- 服务及控制台 API 的列表请求可显式传 `includePast: true`，查看仍在存储中的原始记录与原始时间；默认过滤不删除记录，既有保留期与取消行为保持不变。

## 边界
- 只写自己的插件 state；不发 QQ、不读记忆文件。
- 「能不能提醒」由桥接判断（reserved2、未暂停、白名单、未静音）；组件被拒时条目保留，下个 tick 重试。
- 注册/提醒不依赖模型在场：桥接到点主动唤醒。
