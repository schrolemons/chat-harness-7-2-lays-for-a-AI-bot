# 工作树、运行目录与 DSH Desktop 修改契约

本项目涉及以下不同对象。修改前先确认自己正在操作哪一个。

| 对象 | 保存什么 | 修改方式 |
| --- | --- | --- |
| Git 开发工作树 `PUBLIC_REPO` | 可公开源码、合成测试、安装器和文档 | 在选定工作树编辑、检查、提交和推送 |
| 已部署目录 `RUNTIME_ROOT` | 实际运行的 bridge、组件，以及仅本机存在的配置和状态 | 以当前运行文件为基线做受控部署；不得用旧工作树整文件覆盖 |
| DSH 安装与所选 profile | Desktop 配置、插件链接、MCP 客户端、模型账户、现存会话 | 通过受支持的设置/API或本项目安装器修改；保留其他配置与会话 |
| 可选 DSH 上游源码工作树 `DSH_SOURCE` | DSH 自身的包、构建脚本与兼容适配源码 | 单独核对其 remote、branch、worktree 和版本；本仓库发布不修改它 |

运行目录可能暂时领先公开仓库。公开仓库也可能因隐私处理而与运行目录不同；不能用目录名、修改时间或文件大小决定哪份应该覆盖另一份。

## 一、开始工作前记录拓扑

1. 在开发树运行 `git status --short --branch`、`git remote -v`、`git worktree list`。记录当前提交及未提交改动；不得把别人的改动当成可丢弃文件。
2. 从锁文件、进程实际命令行和控制台 API 确认 `RUNTIME_ROOT`。DSH 服务端口从运行配置读取，不假定固定端口。
3. 确认 `DSH_HOME` 与目标 profile。Desktop 通常使用名为 `desktop` 的 profile，但以本机启动设置为准；Web profile 不等于 Desktop profile。
4. 查看 `DSH_HOME/plugins/qq-agent-presets`、`qq-mode-console`，以及目标 profile 下 `node_modules` 的实际 junction/symlink 目标。
5. 可从 `workspace.example.json` 创建本机 `workspace.local.json`。后者被 Git 忽略，记录绝对路径和 profile；不要上传。

部署目录也可能完全没有 `.git`，此时它不是开发工作树。不得为了同步在其中运行 `git init`、`reset`、`clean` 或建立到另一仓库的隐式关联；应在确认的 Git 工作树提交，再用审查过的文件部署。每次同步分别记录 Git 提交和部署文件哈希，不把两者混称为“已更新”。

安装版 Desktop 运行的是安装目录中的 `resources/app.asar/dsh` 与 `@deepseek-ai/dsh-desktop-host`，并使用传入的 profile；旁边存在 DSH Git 源码树不代表安装版正在执行该源码。涉及 Desktop 本体时，必须同时记录源码提交、构建产物、安装版本和启动进程，不能只修改源码后声称安装版已更新。

当前安装器通过两层链接连接 bundle：

```text
DSH_HOME/plugins/<bundle> -> RUNTIME_ROOT/plugins/<bundle>
DSH_HOME/profiles/<profile>/node_modules/<bundle> -> DSH_HOME/plugins/<bundle>
```

因此，修改被链接目录中的 preset/bundle 可能影响下一次 Desktop 加载。反之，只改隔壁 Git 仓库不会自动更新这些链接。

## 二、同步源码的工作顺序

```sh
node scripts/source-workspace.mjs snapshot RUNTIME_ROOT > LOCAL_AUDIT/before.json
node scripts/source-workspace.mjs diff PUBLIC_REPO RUNTIME_ROOT
node scripts/source-workspace.mjs verify RUNTIME_ROOT LOCAL_AUDIT/before.json
```

这些命令只生成清单或比较路径和 SHA-256，不执行复制、不启动应用、不读取凭据内容。清单不包含运行状态、私有知识卡或依赖目录；它不是完整灾难备份。

同步时必须逐项审查新增、修改和删除，区分实现代码与本机数据。私有材料、账号、群号、学校服务、截图和真实验收记录不随公开源码发布。公开示例使用虚构身份；必要差异写入同步记录，不以隐私为理由默默删除功能。

写回之前复查清单。如果有新编辑，停止写回并重新合并。只部署审查过的文件；删除必须单独确认。同步完成后保存提交号、文件清单、必要的公开化差异和验证结果。

## 三、按功能修改代码

| 内容 | 归属 |
| --- | --- |
| 聊天策略、引用规则、话术、关心与兴趣判断 | `plugins/qq-components` |
| QQ/DSH 传输、鉴权与受限环境能力 | bridge 与 MCP 适配层 |
| 模式解析、媒体段解析、双戳缓冲计算 | `src/bridge-core` |
| preset 人格与工具面 | `dsh/agent-presets` 源文件 |
| preset 注册产物 | 由 `scripts/build-agent-preset-patches.mjs` 生成 |
| 本机凭据、成员档案、会话、日程状态 | 仅运行目录中的本机配置/state |

拆分 bridge 时一次提取一个边界，保持函数体和状态语义，明确可变配置的读取时机。先保存可回退基线，再跑已有隔离回归。恢复遗失优化与架构重构分别审查，避免把行为变化藏在文件移动里。

## 四、DSH Desktop 的更改要求

- **无需修改 Desktop 本体的情况**：QQ 组件、bridge、MCP server、preset、bundle 和 profile 安装器变化都先在本项目实现。不要直接覆盖 Desktop 的 Electron 文件或其内置依赖。
- **profile 部署**：`node scripts/setup-dsh.mjs PROFILE` 会生成 preset、更新指定 profile 的托管 MCP 条目和插件链接。必须先审查目标 profile 及安装器变更，保存原文件，保留非托管条目。禁止从另一个 checkout 运行安装器并无意中把生产链接改到旧代码。
- **确需适配 Desktop/DSH 版本**：记录明确版本、问题证据、支持的 API 和回滚路径；优先把兼容逻辑放进适配器。若不得不补丁化上游依赖，保存版本锁定、原文件哈希、可重复执行且校验上下文的补丁脚本，以及隔离验证；不要只保留手工改过的 `node_modules`。
- **现存会话**：更换 preset 源不等于所有会话立即更新。应检查会话实际挂载的 preset/MCP 工具面，通过支持的刷新或更新机制应用；不得为了应用提示词而重建会话或清除历史。
- **中断范围**：组件变化优先使用 `/api/plugins/reload`；bridge 核心变化需要重载 bridge；MCP schema 变化需要刷新对应 MCP 客户端/进程。重启 Desktop/DSH 是另一项动作，须单独说明必要性并取得授权。
- **验证**：源码检查、工具 schema 可见、发送请求排队、QQ 实际送达是不同证据。重载后检查 bridge 构建号、组件加载、DSH/QQ 健康状态；不得凭文件时间声称已生效。

## 五、发布与回退

发布前运行项目测试、隐私检查、preset 生成一致性和 diff 检查，逐项审查暂存区。公开仓库更新不自动部署到生产，不重新指向本机 profile，不删除状态和会话。

回退代码时先比对当前编辑；保留数据结构兼容性。恢复旧备份前，必须合并备份之后的优化与用户新编辑。不要因为某项测试失败而直接重启或恢复整棵旧目录。
