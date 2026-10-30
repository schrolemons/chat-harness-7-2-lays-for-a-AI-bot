# 课程监管调度（life-campus-watch）

L 层「生命周期与编排」组件，负责 campus-watch 脚本的定时拉起。

## 网页变化通知
- `web-changes.mjs` 优先提取 main/article/Blackboard 正文，移除菜单、导航和页脚；按增删文字和真实链接比较，纯菜单变化静默。
- `summary-policy.mjs` 保存摘要规则；`summarizer.mjs` 使用独立的 `campus-summary` 无工具预设，把同轮最多六页变化合为一次 `deepseek-flash / low` 请求。只处理原始差异，不读取聊天历史或发送 QQ；没有有效差异不调用模型。
- 机主通知显示简明要点、资料链接和原网页。模型失败、超时、证据格式错误或数字不受证据支持时用规则摘要；抢课成功、登录提醒仍走原流程。
- 原始差异保存在 `state/campus-watch-state.json` 的 `webChangeHistory`（最近80次）；未确认发送的变化留在 `pendingWebChanges`，摘要缓存命中时不重复调用模型。发送凭据使用原始diff的稳定ID，不随AI措辞改变。
- 监控只用新建的临时标签页处理网页，结束后关闭；cookie 直接通过 BrowserContext 恢复，不初始化旧标签页。现存可见浏览器不移动、不关闭。
- 本机安装：`node scripts/setup-web-summary.mjs desktop`。它只增补后台整理预设，保留其他预设和默认模型；DSH 可热加载，无须重启 bridge。
- 可选组件配置：`aiWebSummary=false` 使用规则摘要；模型与思考强度统一读取 O 层调用档位，旧 `summaryModel` 不再作为覆盖入口；`summaryTimeoutMs` 默认35000，最大60000。每次用新整理会话，结束后归档，工具清单为空且执行守卫拒绝全部工具。

## 职责
- 每 1 分钟（schedule.everyMs）触发一次 onTick。
- 每分钟检查快检是否到期；讲座未启用时不派发快检，讲座实际访问遵守 lecturesIntervalMinutes（至少5分钟）。全检默认每30分钟（config.fullCheckMinutes）。
- 调桥接能力 `spawnCampusWatch()` 拉起脚本，脚本使用原子 PID 租约与180秒浏览器阶段看门狗；活进程的锁不因120秒时间窗口而失效。

## 登录与浏览器交接
- `scripts/campus-browser-session.mjs` 统一租约、登录页识别、cookie 保存/恢复及可见→无头交接；`scripts/login-window.mjs` 为本轮失败的监控网址打开登录页，不依赖个人姓名或无关的研究生应用。
- 登录窗口持有 `state/login-window.lock` 与监控租约；组件及脚本都暂停后台访问。登录等待只读取DOM，每3秒查看一次，不自动刷新、输入凭据。
- 连接现存浏览器时保留最新 cookie；仅新启动的浏览器从 `campus-cookies.json` 恢复，避免旧快照覆盖刚登录的会话。健康检查结束保存最新 cookie。
- 可见→无头使用同一个 `state/campus-profile`：导出全部cookie（含session）、关闭本脚本创建的可见进程、等待端口释放、启动无头、恢复cookie、验证目标页。localStorage 等仍由同一 profile 持久化。
- 遇到原本已存在的可见浏览器只复用新标签页、保存登录态并断开连接；不自动关闭或迁移用户当前浏览器。超时也保留可见窗口，后续交接需管理员确认。
- 页面跳转到 CAS/login 时先记录登录状态，再排除跨站正文；读取失败不覆盖内容基线。子检查顺序等待完成，不用未取消的Promise.race并行导航同一页。
- 正文提取在同一次DOM采样中附带可见password输入与显著SSO登录提示；登录提示需标题/用户名控件与登录动作相互印证，课程正文提到sign-in、页头登录链接或隐藏密码控件不单独判登录。
- 租约竞争使用独立PID/nonce记录与非阻塞bakery互斥；只清理已确认死亡的拥有者记录。旧格式未知拥有者空guard保留原文件但超过创建窗口后不再阻塞新协议，避免永久停监控。
- 离线回归：`node --test scripts/test-campus-browser-session.mjs scripts/test-campus-monitor-scheduling.mjs`。真实内核隔离回归：`node --test scripts/test-campus-browser-handoff.mjs`，仅创建临时profile并访问127.0.0.1合成站点，不连接生产9222、不发送QQ或模型消息。

## 边界
- E 层脚本协同只编辑 `scriptPaths` 及逐项启停；没有启用项时 `scriptCollabEnabled=false`。保存清单时保留网页配置及开发者维护的脚本约定。
- `scriptDescriptions` 是开发者与 AI 维护的“脚本地址 → 执行／搜索约定”映射，只读展示在地址下方。`campus_watch_status` 将说明折叠为一行（最多240字符），同时返回已暂停条目；状态查询不执行脚本。未登记约定时不臆造执行细节。
- `index.js` 只做「何时拉起」；网页摘要规则由同组件内的独立模块提供，抓取和通知接口仍由 campus-watch.mjs 编排。
- 桥接只提供 spawnCampusWatch 能力，不在这里写调度逻辑。
