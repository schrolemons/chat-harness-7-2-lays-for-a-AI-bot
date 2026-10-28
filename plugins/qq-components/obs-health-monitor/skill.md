# 健康巡检（obs-health-monitor）

O 层「可观测性与运维」组件，负责统一盯各组件心跳，掉线时 QQ 告警 owner。

## 职责
- 每 5 分钟（schedule.everyMs）触发一次 onTick。
- 调桥接能力 `collectHealth()` 拿各组件状态（当前：campus-watch 课程监管的 state 文件 mtime）。
- 有组件 stale（超 45 分钟没跑）就调 `notifyOwner()` 告警。
- 告警去重：30 分钟冷却，避免同一问题刷屏。

## 边界
- 只做「观测 + 告警」，不自己修复组件（修复/自愈是别的组件/桥接的事）。
- 组件清单和超时阈值按需扩展，别把业务逻辑塞进来。
