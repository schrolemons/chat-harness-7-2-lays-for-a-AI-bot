# 工作树与运行部署契约

公共发行分支的修改以当前已核验 Git worktree/branch/commit 为准。邻近旧 checkout 的未提交草稿保留为独立来源，不重置、覆盖或当作最新部署副本；实际机器的权威源码映射与草稿备份哈希留在不分发的本地审计记录。下述私人运行目录规则只约束对应私人部署，不能据此把公共工作树视为真实运行实例。共同代码通过逐文件差异与审查后的三方合并同步，禁止用公共完整文件替换私人拥有源。

本机AI助手的实际运行目录现在就是 **Git 私有工作树**。这是本轮用户明确要求的新结构，取代此前“公开开发副本与非Git运行目录”的管理方式。

| 对象 | 当前职责 |
| --- | --- |
| 私有 bot 工作树 | 当前AI助手的真实源码、角色、REFERENCE_DATA 私有资料与可审计的数据快照 |
| 邻居公开 DSH 模板仓库 | 用户明确授权时，经独立候选脱敏、审查与测试后同步共用代码；私人资料不导出 |
| `private-data/` | 从本机稳定读取并排除凭据的真实逻辑数据快照；manifest记录来源哈希 |
| 本机 `state/` / `config.json` / 浏览器profile | 仍是运行数据与凭据拥有源，不随 Git checkout 自动覆盖 |
| DSH 安装与 Desktop profile | 独立运行环境；链接应继续指向真实私有 bot 目录，不因仓库整理重建会话或重指向旧副本 |

实际绝对路径和 profile 记录在本机 `workspace.local.json`，该文件不上传。`developmentRepository` 指本私有工作树，`publicTemplateRepository` 仅作公开模板路径记录。

## 开始修改

- 检查 `git status --short --branch`、remote、当前进程和桥接健康；当前 ready 不做连接修复。
- 先保留受影响文件的哈希/快照，以当前文件局部修改。不得用其他 checkout 整文件覆盖，也不得用旧快照覆盖过程中出现的新编辑。
- 软内容/策略归组件；传输与最小环境能力归桥接。管理端页面按 `console/README.md` 的所属层修改，不编辑编译 bundle，不向旧隐藏容器追加功能。
- 私有数据使用 `npm run snapshot:private`；角色和 REFERENCE_DATA knowledge 直接在其实际路径版本管理。快照恢复必须单独审查，不自动重放待发任务。

## 验证与发布

1. `npm run build:console`、`npm run lint:console`，以及对应隔离行为测试；必要时跑完整控制台与组件矩阵。
2. `npm run audit:tools` 区分 MCP 注册、preset 范围与最新请求的注入证据；不得把静态工具名清单当已注入。
3. 提交前检查源码、生成产物与数据快照。本私有工作树只推送指定 private GitHub 仓库，仓库 hook 会核验 private 属性并检查本机凭据值是否混入。
4. 组件优先 `/api/plugins/reload`。核心 bridge/MCP/preset 变动分别确定实际加载方式；需要重启或 DSH 重载时，说明范围和中断后取得用户授权。
5. 发布后分别验证 `bridge-health`、运行构建指纹、实际组件加载与真实页面只读数据。未观察到 QQ/模型结果，不称实际送达或真实模型验收。

代码回退保留数据与发送凭据，不清空会话或锁。DSH 本体、profile 配置和现有会话是独立对象；不修改 Desktop 的 Electron 文件或内置包；公开模板更新单独从公开候选发布。
