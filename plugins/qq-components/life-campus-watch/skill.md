# 课程监管调度（life-campus-watch）

L 层「生命周期与编排」组件，负责 campus-watch 脚本的定时拉起。

## 网页变化通知
- `web-changes.mjs` 优先提取 main/article/Blackboard 正文，移除菜单、导航和页脚；按增删文字和真实链接比较，纯菜单变化静默。
- `summary-policy.mjs` 保存摘要规则；`summarizer.mjs` 使用独立的 `campus-summary` 无工具预设，把同轮最多六页变化合为一次 `deepseek-flash / low` 请求。只处理原始差异，不读取聊天历史或发送 QQ；没有有效差异不调用模型。
- 机主通知显示简明要点、资料链接和原网页。模型失败、超时、证据格式错误或数字不受证据支持时用规则摘要；抢课成功、登录提醒仍走原流程。
- 原始差异保存在 `state/campus-watch-state.json` 的 `webChangeHistory`（最近80次）；未确认发送的变化留在 `pendingWebChanges`，摘要缓存命中时不重复调用模型。发送凭据使用原始diff的稳定ID，不随AI措辞改变。
- 监控只用新建的临时标签页处理 cookie 和网页，结束后关闭；不枚举恢复的历史标签页，避免某个旧目标的 Page/Network.enable 卡住全轮检查。无头浏览器不执行窗口最小化。
- 本机安装：`node scripts/setup-web-summary.mjs desktop`。它只增补后台整理预设，保留其他预设和默认模型；DSH 可热加载，无须重启 bridge。
- 可选组件配置：`aiWebSummary=false` 使用规则摘要；`summaryModel` 默认 `deepseek-flash`；`summaryTimeoutMs` 默认35000，最大60000。每次用新整理会话，结束后归档，工具清单为空且执行守卫拒绝全部工具。

## 职责
- 每 1 分钟（schedule.everyMs）触发一次 onTick。
- 快检（--lectures-only）每 1 分钟；全检每 30 分钟（config.fullCheckMinutes）。
- 调桥接能力 `spawnCampusWatch()` 拉起脚本（脚本自带 120s 单实例锁 + 90s 看门狗）。

## 边界
- `index.js` 只做「何时拉起」；网页摘要规则由同组件内的独立模块提供，抓取和通知接口仍由 campus-watch.mjs 编排。
- 桥接只提供 spawnCampusWatch 能力，不在这里写调度逻辑。
