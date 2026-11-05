# 独立实例安装与精确迁移

公开 bot 使用固定、独立的运行目录。DSH profile 只链接该目录；不要把运行数据放在 DSH 管理的包缓存、开发 `.worktrees` 或另一个 bot 的目录中。现有私人 Git 工作树保留源码、角色、配置、历史和工作目录，不能当作可递归删除的安装目录。

## 首次安装

目前托管 SnowLuma 产物适用于 Windows x64。准备 Node.js **24.20.0 或更新版本**及 npm，先启动一次 DSH 创建目标 profile，再退出该 Desktop，使 profile 没有写入者。Windows 旧 Node 24.16 存在已定位的原生 worker 退出问题；实际 bot 和七个 MCP 使用安装器验证过的 SnowLuma 内置 Node 24.22.1。安装器不会升级全局 Node。

从 [v0.4.0 Release](https://github.com/schrolemons/chat-harness-7-2-lays-for-a-AI-bot/releases/tag/v0.4.0) 下载公开包并核对 SHA256SUMS。也可用本页末尾的命令从同版本源码生成公开包。在独立的临时 bootstrap 目录安装它，再准备永久运行目录。下列路径均为示例，必须替换为自己的绝对路径；永久目标必须尚不存在，父目录必须已存在。

```powershell
npm install --prefix C:/BotSetup C:/Downloads/qq-bridge-public-0.4.0.tgz --ignore-scripts --no-audit --no-fund
node C:/BotSetup/node_modules/qq-bridge-public/scripts/install.mjs --target C:/Bots/public-bot --dsh-home C:/DSHHome --profile desktop
```

这一步从同一 allowlist 复制公开代码，在永久目录执行锁定依赖的 `npm ci --omit=dev`，自动下载并验证官方 SnowLuma v2.1.1 Windows x64 ZIP，再装入本实例的 `managed-dependencies/`。无需单独维护或选择外部 Snow 工程。网络必须能访问 npm registry 和官方 GitHub Release。测试或已有下载可附加 `--snow-artifact C:/Downloads/SnowLuma-v2.1.1-win-x64.zip`，摘要必须匹配固定官方产物。

如果本机已设置 `HTTP_PROXY` / `HTTPS_PROXY`，但直连 GitHub 不通，使用 Node 自带的进程级代理参数：`node --use-env-proxy C:/BotSetup/node_modules/qq-bridge-public/scripts/install.mjs --target C:/Bots/public-bot --dsh-home C:/DSHHome --profile desktop`。它仅让本次 Node 请求使用已有代理环境，不修改全局网络配置，也不需要另一套下载器。不要把代理凭据写入共享脚本或日志。

公开包约 3 MB，Snow ZIP 另需 **42,694,125 字节**；npm 依赖还需下载，实际流量受本机缓存影响。发行命令输出准确压缩/解压字节数和 SHA-256。ZIP 和已安装 vendor 二进制不提交 Git。bootstrap 安装可重用 npm 下载缓存，永久目录的 `node_modules` 始终为独立安装，不是另一个工程的链接。

命令只准备 `.instance-install/candidate.json` 和回滚证据，不修改 profile、不启动 QQ/Snow/DSH。检查 candidate 的 conflicts 为空、目标路径和差异正确后，在确认目标 Desktop 及其他 profile 写入者均已退出的窗口应用：

```powershell
node C:/BotSetup/node_modules/qq-bridge-public/scripts/install.mjs --apply-plan C:/Bots/public-bot/.instance-install/candidate.json --writers-stopped
```

`--writers-stopped` 是操作者对已关闭写入者的明确声明，安装器不会猜测或杀死进程。每次写入前再次比较计划哈希/链接真实目标；profile 有新编辑就拒绝。应用之后自行启动原 Desktop。controller 初态 disabled，账号及发送名单为空；现有冒泡/日程示例保持可见且未绑定。通过 DSH 启用正确实例，再在其独立启动面板配置自己的账号和允许目标。Snow 首次启动诊断保存在本实例 `state/runtime-logs/snow.log`，可能包含本地 WebUI 初始凭据，不应分享。

默认公开包实际名称 `qq-bridge-public`，entry/settings namespace 为 `public-bot-mode`，生成的客户端 registration/filter ID 与包名相同。私人实例保留 `qq-mode` 和原六个 preset ID。公开六预设使用 `public-bot:` 前缀，四个 workspace 末级目录为 `public-bot-chat/learning/task/summary`，标题包含 bot 身份。

公开 listener 初始端口为 console 3200、Snow HTTP 3201、Snow WS 3202、launcher 3299、Snow WebUI 5299。DSH 目标默认留空，跟随选定 Desktop 的实际地址，不预留固定端口。已声明实例及正在监听的端口冲突会阻止准备，不接管外部服务。自定义 DSH 目标端口或第二个公开实例可用 `preparePublicInstall()` 的显式 `ports`/身份参数准备；随后可在设置中调整并验证冲突。

## 现有私人安装的迁移

先同步并核验已评审的通用源码，再以当前状态生成计划。`planInstanceInstall({descriptor,profilePath,legacy,runtime})` 只读。`legacy.rows`/`legacy.overrides` 每条要求精确 rowHash、解析后的 modulePath 和已知 sourceRoot；外部宿主 MCP 还要求本项目内的实际 commandPath。bundle/link 要求真实 target 和 dependency 的 `link:` 目标一致。顶层模式覆盖必须同时证明来源 bundle。不能通过 ID、路径看起来相似或旧固定集合推断归属。

计划中逐项记录旧哈希/链接目标、精确编辑、候选内容和回滚内容。未知同名项保留并报告冲突；Codex Peer、模型、密钥、默认 preset、浏览器 user data 与其他 preset 不受迁移管理。旧六预设交由 controller 保持相同 ID。保留会话 ID，不对已开始的会话调用 `preset.select`。不运行 snapshot restore 或会修改旧数据正文的 bootstrap。

候选文件可能含 profile 私有配置，只能放在受保护的本地审计目录，禁止提交 Git 或放进发行包。生成候选并不授权执行真实迁移。真正应用前再次保存当前基线、核验哈希，在明确批准的停止写入窗口执行，然后启动原 Desktop；不要恢复过期快照覆盖新的状态。

## 中断和升级

若安装进程被强制结束，mutex 也会保留。普通回滚继续返回 BUSY；只有确认该安装事务的所有写入者已停止后，才能为回滚命令附加 `--recover-lock`。这要求锁的 transactionId、plan hash、pending journal 及全部目标的当前哈希一致；不根据 PID、年龄或端口自动回收。缺失/损坏/异主证据与并发改动都保留原样并拒绝恢复。

中断保留 journal 与 profile pending 标记，后续安装拒绝越过它。明确检查后可对未提交事务执行：

```powershell
node C:/BotSetup/node_modules/qq-bridge-public/scripts/install.mjs --rollback-plan C:/Bots/public-bot/.instance-install/candidate.json --writers-stopped
```

回滚逐项比较当前内容与该事务的 before/after，遇到新写入即拒绝。它只撤回本次精确 profile 编辑/链接，不删除 source、session、备份或 durable installation inventory/receipt；初始化中断留下的 pending declaration 需另行审查，不能自动重试认领。已提交事务不接受这条回滚命令。

升级先将新版 `.tgz` 安装到新的 bootstrap/stage，使用 `source-workspace.mjs snapshot` 和 `diff` 比较当前固定运行目录，人工评审仅代码的改动并按当前哈希应用。保留 `.qq-bridge-instance*`、`.instance-install`、`managed-dependencies`、配置、角色自定义、state 和所有原会话；不能重新对现有目标运行 fresh installer，也不能用 pnpm/npm 包替换永久运行根。profile 链接保持不变。代码升级若改变安装时记录的文件哈希，卸载预检必须报告差异并保留，不自动把新版/未知文件认领为旧安装所有。

安装 receipt 区分 `preserve` 的现有 Git code root 与 `created` 的新公开根，后者附 installer 创建的文件清单和哈希。该根记录不授权递归删除其后来出现的未知文件。session/path 所有权仍需独立证据；Task8 卸载流程消费这些记录。旧 force/start/stop/setup 脚本遇到 descriptor（即使内容损坏）即拒绝，在 managed 根中不能绕过 controller。

fresh 安装还记录 `node_modules` 的实际创建文件哈希、目录和链接真实目标，不能仅用 lockfile 哈希推断整个目录未变。`config.json`、两个初始 state 文件及全新 state 命名空间记录 `mutable: true`：其初始哈希证明创建来源，正常运行会变化；卸载必须对明确所有权范围另做当前清理计划和 CAS，不能拿旧创建哈希直接删当前状态。现有私人 config/state 不因迁移自动获得这些记录。

## 显式清理与原生删除限制

停止、禁用和升级都不调用卸载。`node scripts/cleanup-instance.mjs C:/Bots/public-bot` 只读取该根的 receipt 并输出计划/冲突。当前 DSH 没有完整在线永久删除接口；CLI 没有可证明全部 home 写入者退出和禁止重启的 owner capability，因此返回 `UNSUPPORTED_SESSION_DELETE`，不修改实例。`--writers-stopped`、单个 bot/PID 已停止、归档会话都不能替代该证明。

程序接口 `planInstanceCleanup(manifest, {sessionStoreAdapter})` / `executeInstanceCleanup(plan, {expectedManifestHash, sessionStoreAdapter})` 支持由可信 owner 协调的离线过程。当前已验证的 owner 仅由合成 fixture 创建全新 home、保留所有 child handles、关闭创建入口并等待全部 child close；维护重启只挂载原生存储服务，不启动 bot/profile 能力。公开 CLI 不提供从普通 home、PID 或布尔参数构造此能力的方法。共享真实 home 的自动停止和卸载尚不支持。

受支持的固定存储组合为 pinned 0.2.1-rc.2 JSONL v4 的原生默认 zstd 多帧或明文格式（均可附精确记录的 v3 历史文件）、v7 per-record 投影缓存和一个明确启用的 durable query index。zstd 按原生合同要求第一帧只含一行 header；逐帧验证结构与校验和，不按扩展名猜测内容。解析上限为原始文件 128 MiB、header 64 KiB、每个后续帧解码 128 MiB、总解码 512 MiB 和 65536 帧；超过限制、非零字典 ID、skippable 帧及损坏格式保留并报冲突。每条 ID、全部 generation/cache 路径、逻辑 header 和原始文件字节哈希都要核验；旧 whole-unit cache、未知备份/格式、未记录的目标工作区会话、共享未知 writer 或禁用但残留的 index 均拒绝。原生列表、搜索、catalog 和 workspace 引用必须一致后，才能清理已记录的 data/dependency、所选 profile 行/链接与目录登记，代码和安装元数据最后处理。保留其他会话、共享 workspace 登记、附件和独立 fork；不作取证级擦除保证。

清理 plan、完整 receipt 快照和逐项 journal 保存在 manifest 指定 DSH home 的 `bot-instances/cleanup/<installationId>/`，位于实例根外。中断重试只核验同一计划的已完成项及已记 intent 的精确路径，不补扫认领新目标；遗留 mutex、丢失 owner 能力或新出现的文件需要人工审查。现有 Git 源码、linked worktree、未知备份和 `preserve` 数据继续保留。新安装根也只有在文件清单、创建收据和当前 CAS 全部相符时才移除。

明确标记 `preserve` 的子文件/目录优先于 owned 父目录展开；若清理会删除它、其内容或必要父目录，整个计划拒绝执行。保留开发者代码根仍允许清理另行证明归属的工作数据。Snow marker 只证明记录的资产及其必要父目录，未知空目录不被认领；运行后生成但未取得对应生产者所有权收据的 `config/onebot_*.json` 等也保留并拒绝卸载。该运行数据收据缺口需单独完成集成验证，不能仅按路径名称补充归属。

## 发布与支持边界

现有 CI 执行源码测试和 privacy check；唯一打包入口复用 `npm pack`：

```powershell
node scripts/release-public.mjs --stage C:/Build/public-stage --output C:/Build
```

`release-files.json` 是评审后的精确路径 allowlist，使用 UTF-8 路径，包括中文角色。新增公开文件要同时更新清单；禁用路径即使误加入清单也拒绝打包。打包前后都检查隐私规则，源码包带 `npm-shrinkwrap.json` 保存同一锁定依赖图。提交前仍需运行测试、生成检查和 privacy check。pack 不执行 tag、发布、上传或安装。

这里验证的是源码、合成 profile、真实发行 ZIP/npm tarball 和原生客户端模块图。实际安装后的 Electron/HMR、QQ 登录与真实消息需独立验收。当前 native UI 依赖提供 webServer 的 DSH host；纯 worker 组合不受支持。旧无 descriptor 的 standalone CLI 可保留原用途，但不能据此声称新版 native UI 兼容旧 global 启动器协议。
# 当前 native 连接与验证边界

受管实例的 DSH API 端口留空表示跟随提供该插件的原生 `webServer.getOrigin()`。公共新安装默认留空；旧本机根 URL 且未设置 `launcher.ports.dsh` 的配置也跟随当前主机。明确设置的端口、远程地址、HTTPS 或带路径的地址保留其指定目标。设置页显示当前有效地址；修改其他设置不会把临时端口保存为固定值。运行中主机地址变化需明确停止并重新启动 bot，启动器报告需要重启，不自动重连或寻找其他主机。

bridge 和受管网页摘要读取同一次启动的目标快照。子进程及实例 MCP 使用 descriptor 中的 `dshHome`；不会继承另一 home 的 `DSH_LAUNCH_TOKEN`。无 descriptor 的 standalone 和普通原生会话维持其原有显式客户端行为。

安装器在已核验的 Snow ZIP 中创建独占空 `config` 目录，并将其记录在不可变依赖标记。标记字节的 SHA-256 必须匹配同一安装 manifest 中 `source: created`、`cleanup: owned`、带 `createdByTransaction` 的精确 Snow 依赖路径与 `manifestPath` 收据；缺少或修改收据不授予写入权限。运行时只为自己实际创建的 `onebot_<UIN>.json` 追加作者凭据；已有而未记录的文件拒绝覆盖，凭据写入失败也拒绝启动。正常重写保留初始证据，停止后的清理对当前字节进行 CAS 核验。其他 Snow 自动生成的日志、数据库、WebUI 配置或未知空目录不因路径相似取得所有权；未知内容会阻止完整清理。旧标记没有目录创建证据时不自动补记或收养。

Windows 验证使用 Node **24.22.1**，CI 固定同版本；受管运行最低为 24.20.0，避开已诊断的旧 Windows native teardown race。统一 runner 使用临时源码、独立物理依赖副本与空 `DSH_HOME`/`HOME`、npm cache。Windows `USERPROFILE` 保留操作系统值以兼容浏览器默认目录校验，浏览器仍只使用测试创建的一次性 profile。官方 Snow 与真实浏览器专项前置条件通过 `TEST_SNOW_ARTIFACT`、`TEST_OWNED_BROWSER_PATH`、`TEST_LAUNCHER_BROWSER` 明确提供；可选 Desktop 载体参考使用 `TEST_DESKTOP_MAIN`。常规 CI 不自动下载 Snow 或启动 QQ。完整发行验收必须另行运行这些专项，不能以缺少资产时的跳过当通过。

公共发行安装测试在同一从零产物上核验原生默认 zstd、缓存、索引、显式 Snow 配置和完整收据的只读清理计划。完整删除执行另由较小的受控原生夹具验证；真实依赖树的逐文件同步日志吞吐仍有规模限制，安装测试不将数千次删除混入其成功条件。该证明的 home 和所有 writer 都由测试独占创建；不提供真实共享 home 的删除协调器。普通生产删除仍须保持 `UNSUPPORTED_SESSION_DELETE`，不以 bot 已停止替代共享原生存储的独占证明。源码测试、发行字节、实际已加载运行时与真实 QQ/模型结果须分别报告。

[![powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
