# 课程监管调度（life-campus-watch）

L 层「生命周期与编排」组件，负责 campus-watch 脚本的定时拉起。

## 网页变化通知
- `web-changes.mjs` 优先提取 main/article/Blackboard 正文，移除菜单、导航和页脚；按增删文字和真实链接比较，纯菜单变化静默。
- `summary-policy.mjs` 保存摘要规则；`summarizer.mjs` 使用独立的 `campus-summary` 无工具预设，把同轮最多六页变化合为一次 `deepseek-flash / low` 请求。只处理原始差异，不读取聊天历史或发送 QQ；没有有效差异不调用模型。
- 机主通知显示简明要点、资料链接和原网页。模型失败、超时、证据格式错误或数字不受证据支持时用规则摘要；抢课成功、登录提醒仍走原流程。
- 原始差异保存在 `state/campus-watch-state.json` 的 `webChangeHistory`（最近80次）；未确认发送的变化留在 `pendingWebChanges`，摘要缓存命中时不重复调用模型。发送凭据使用原始diff的稳定ID，不随AI措辞改变。
- 普通监控使用临时标签页，检查结束关闭；登录协助复用一个同网站标签页，不重复创建。cookie 直接通过 BrowserContext 恢复，不初始化旧标签页。仅可验证归属的监控专用浏览器可自动交接为无头，日常浏览器不关闭。
- 本机安装：`node scripts/setup-web-summary.mjs desktop`。它只增补后台整理预设，保留其他预设和默认模型；DSH 可热加载，无须重启 bridge。
- 可选组件配置：`aiWebSummary=false` 使用规则摘要；模型与思考强度统一读取 O 层调用档位，旧 `summaryModel` 不再作为覆盖入口；`summaryTimeoutMs` 默认35000，最大60000。每次用新整理会话，结束后归档，工具清单为空且执行守卫拒绝全部工具。

## 职责
- 每 1 分钟（schedule.everyMs）触发一次 onTick。
- 每分钟检查快检是否到期；讲座未启用时不派发快检，讲座实际访问遵守 lecturesIntervalMinutes（至少5分钟）。全检默认每30分钟（config.fullCheckMinutes）。
- 调桥接能力 `spawnCampusWatch()` 拉起脚本，脚本使用原子 PID 租约与180秒浏览器阶段看门狗；活进程的锁不因120秒时间窗口而失效。

## 登录与浏览器交接
- 学术报告应用的认证选择页（`yjsrzfwapp/dbLogin`）、CAS登录页及查询HTTP 401均作为认证失效处理，立即进入该研究生平台自己的登录协助；不等数据请求超时后继续用旧cookie或重复DOM选课流程。BB登录成功只恢复BB，不合并两个平台的凭据。检查失败/待登录不会在日志中报告“无变化”。
- `scripts/campus-browser-session.mjs` 统一租约、登录页识别、cookie 保存/恢复及可见→无头交接；`scripts/login-window.mjs` 为本轮失败的监控网址打开登录页，不依赖个人姓名或无关的研究生应用。
- 登录窗口持有 `state/login-window.lock` 与监控租约；组件及脚本都暂停后台访问。登录等待只读取DOM，每3秒查看一次，不自动刷新、输入凭据。
- 连接现存浏览器时保留最新 cookie；仅新启动的浏览器从 `campus-cookies.json` 恢复，避免旧快照覆盖刚登录的会话。健康检查结束保存最新 cookie。
- 一个监控专用Edge进程承载独立BrowserContext。同一origin的不同路径复用会话；不同主机名（含子域）或协议/端口分别隔离，不能因碰巧使用相同认证中心而互借登录态。`scripts/campus-site-sessions.mjs` 按origin保存cookie及local/sessionStorage到仅本机的 `state/campus-site-sessions/<hash>.json`。首次迁移只取旧快照中域名精确匹配目标主机的cookie，不导入其他域名或SSO会话。后续只读该网站自己的文件。
- 登录窗口只访问该网站独立context；关闭可见进程前保存该context，启动无头后恢复并验证原网站受保护页，SSO新标签参与判断。讲座还需验证应用列表响应，不能只凭门户登录页消失报成功。手动退出后不回填旧storage令牌。
- `loginMaxAttempts` 默认3，`loginRetryMinutes` 默认5。首次失败立即QQ通知；之后每隔同一间隔验证，失败立即通知并计数，达到上限暂停该网站且不再自动弹窗。登录等待中仅采样DOM，不自动刷新登录页；暂停时保存会话并收回专用可见窗口。网络不可达不冒充登录失败。
- `state/campus-login-recovery.json` 按网站origin持久保存尝试次数、通知事件及代次。同域课程共用一次登录预算；其他网站独立。暂停跨日期保留；控制台手动重新监管、成功恢复后的新掉线或桥接新进程启动会获得N次新机会。组件热加载和脚本重启不重置；旧代次登录进程不能覆盖新重试。
- “重新监管”沿用管理员专用 `POST /api/plugins/config`，写入隐藏的 `manualRetry:{url,nonce}`。仅允许已配置网站，组件状态记录消费过的nonce，重复保存/重载不重放。它不注册AI工具，不允许模型自行绕过上限。状态工具 `campus_watch_status` 只读返回次数、暂停原因、下次尝试与通知错误。
- 讲座平台的专用脚本与DOM备用流程验证成功后，都回写网站health并结束恢复等待；登录仍有效时直接恢复后台监管，无需弹窗。脚本失败不伪报成功，DOM确认鉴权失败后才计入登录预算。
- 手动重新监管只派发所选URL；浏览器忙时请求持久保留，下一次组件轮询优先执行，不等完整巡检周期。页面等待期间每5秒读状态，平时每30秒；失败会结束等待并给出原因。导航超时或HTTP错误不能把同主机上一页正文当本页结果。
- 登录通知写明网站名称、原网址、最近检测到掉线时间及恢复验证时间，统一北京时间，不声称知道真实掉线瞬间。网络/访问错误单独报告，不冒充鉴权失败、不乱弹登录窗。
- 登录通知独立于旧网页diff的6小时去重，使用共享 `/api/notifications/send` 稳定事件凭据；不调用LLM、不读取会话agent令牌。投递失败保留错误，未知投递结果遵守共享凭据规则，不盲目重发。
- 页面跳转到 CAS/login 时先记录登录状态，再排除跨站正文；读取失败不覆盖内容基线。子检查顺序等待完成，不用未取消的Promise.race并行导航同一页。
- 正文提取在同一次DOM采样中附带可见password输入与显著SSO登录提示；登录提示需标题/用户名控件与登录动作相互印证，课程正文提到sign-in、页头登录链接或隐藏密码控件不单独判登录。
- 租约竞争使用独立PID/nonce记录与非阻塞bakery互斥；只清理已确认死亡的拥有者记录。旧格式未知拥有者空guard保留原文件但超过创建窗口后不再阻塞新协议，避免永久停监控。
- 离线回归：`node --test scripts/test-campus-browser-session.mjs scripts/test-campus-monitor-scheduling.mjs`。真实内核隔离回归：`node --test scripts/test-campus-browser-handoff.mjs`，仅创建临时profile并访问127.0.0.1合成站点，不连接生产9222、不发送QQ或模型消息。
- 登录专项：`node --test scripts/test-campus-login-recovery.mjs scripts/test-campus-login-flow.mjs scripts/test-campus-login-ui.mjs`，覆盖通知时序、上限、重试权限、代次、SSO和控制台保存/按钮。

## 边界
- E 层脚本协同只编辑 `scriptPaths` 及逐项启停；没有启用项时 `scriptCollabEnabled=false`。保存清单时保留网页配置及开发者维护的脚本约定。
- `scriptDescriptions` 是开发者与 AI 维护的“脚本地址 → 执行／搜索约定”映射，只读展示在地址下方。`campus_watch_status` 将说明折叠为一行（最多240字符），同时返回已暂停条目；状态查询不执行脚本。未登记约定时不臆造执行细节。
- `index.js` 只做「何时拉起」；网页摘要规则由同组件内的独立模块提供，抓取和通知接口仍由 campus-watch.mjs 编排。
- 桥接只提供 spawnCampusWatch 能力，不在这里写调度逻辑。

## 短暂访问故障静默处理（2026-11-03）
普通页面读取失败按完整网址单独跟踪，首次失败只记日志和状态；同一页面至少间隔 `loginRetryMinutes` 再次检查仍失败才通知，不额外创建定时器。期间恢复则取消失败提醒，未发送过失败通知时也不发恢复提醒。同域名其他页面成功不能清除该页面故障；原页面验证成功后，才为已通知的故障发送一次恢复提醒。真正的登录失效仍按既有立即通知和登录协助规则处理。
