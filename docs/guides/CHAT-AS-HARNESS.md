# CHAT AS HARNESS —— 分发蓝图

> 目标：把当前这套「AI助手桥接 + 七层插件 + MCP + 驾驶舱 UI + 个性化配置」打包成一个可分发插件，
> 任何刚装 DeepSeek Harness 的空白用户，装上插件、按步骤激活、选小组件（默认全上）、登录 QQ、
> 设好机器人 QQ / 管理员 QQ / 白名单，双击《一键启动》或通过对话就能跑成现在这样。
> 本文是**蓝图与决策记录**，实现随进度更新。

## 1. 最终形态（用户视角）

1. 下载 Harness（源项目，我方不打包）。
2. 安装本插件（chat-as-harness）。
3. 首次会话里对 AI 说「激活 / 一键启动」或双击《一键启动》。
4. AI 按激活剧本分步引导：读环境 → 装依赖 → 起 SnowLuma → 填机器人/管理员/白名单 → 选小组件（默认全上）→ 起桥接。
5. 完成后：QQ 机器人可聊，管理端有七层驾驶舱。

## 2. 要打进仓库的东西（不重不漏）

| 模块 | 说明 |
| --- | --- |
| 桥接内核 | `src/bridge.js` 及全部 `src/*.js`（含插件宿主、七层注册表） |
| 插件 | `plugins/qq-components/*`（C/T/E/L/O/V/G/S 八层，含 skill.md） |
| MCP 工具面 | `src/mcp-*.js` / `src/mcp-*.mjs`（snowluma-safe / host / web-search / games） |
| 前端 | `public/harness.html`（七层驾驶舱）、`public/plugins.html`、原 `console.html` |
| 人格 | `roles/*.md`（AI助手等）、`dsh/agent-presets/*` |
| 配置模板 | `config.example.json`（不含任何真实令牌/QQ 号/密钥） |
| 一键启动 | `一键启动.bat` / `start.bat` / `setup-*.mjs` 激活剧本 |
| 文档 | README、construct.md、HARNESS-GAP.md、各 skill.md、许可与署名 |

## 3. 绝对不打包

- **浏览器登录态 / 用户目录 / 凭据 / 令牌 / QQ 号 / 白名单真实值**（`state/`、`config.json` 真实值、`.credentials.yaml`、Edge profile）。
- SnowLuma 编译产物（放安装指引 + 连接配置，不放二进制）。
- DeepSeek Harness 本体（那是源项目，用户自行安装）。

## 4. 源项目署名与许可

- DeepSeek Harness（运行时环境）：说明其地位与获取方式，不重分发。
- SnowLuma（OneBot v11 网关）：安装指引 + 连接配置，署名。
- qq-bridge 本仓库衍生：保留 MIT 许可与上游说明。
- 上述按各自许可证要求，README 里逐条注明，避免用户「装了才发现缺桥接」。

## 5. 浏览器管理组件（关键诉求）

- 目标：像人一样浏览/监测任意网站，**非必要不让人类重复登录验证**，安全可控、防风控。
- 不上传登录态；本机复用真实 Edge（CDP 9227）的既有登录态。
- 独立成 `exec-browser-manager` 插件：只读为主、动作白名单、节奏拟人、禁支付/银行/身份验证，敏感页不截图。
- 后续细化风险控制（指纹/频率/随机延迟/失败退避）。

## 6. REFERENCE_DATA 层（近人意识）

- 八层结构的第 8 层（S），`plugins/qq-components/reference-data-core` 占位。
- `config.philosophy` / `config.logic` 两个空槽位，等管理员提供哲学思考资料与逻辑方式后接入。

## 7. 待管理员拍板

1. 仓库名：`chat-as-harness`（小写连字符）还是 `CHAT-AS-HARNESS`。
2. SnowLuma 只放安装指引不放二进制，是否同意。
3. 授权协议：MIT / Apache-2.0 / 其它。

## 8. 实施顺序（建议）

1. 本地 scaffold + 激活剧本 + 一键启动 + README/署名。
2. REFERENCE_DATA 占位（已做）与八层 UI 收口。
3. 浏览器管理组件。
4. 建 GitHub 仓库 → 推一个干净分支 → 收尾检查（无凭据/登录态）→ 提 PR/发布。
