# 激活剧本（AI 引导式）

> 目标：一个空白 Harness 用户，装上本插件后，对 AI 说「激活」或双击《一键启动》，
> 就能一步步跑起来。本文是给**激活引导会话**用的步骤与口径，AI 按它逐条检查、只在缺哪步时问哪步。

## 前置
- 已装 DeepSeek Harness（本仓库不含本体）。
- 已装本插件到 Harness 插件目录（`plugin.json` 所在目录可被 Harness 扫描到）。
- 本机有 Node.js ≥ 22（`node -v`）。

## 步骤（AI 逐条核对，幂等）

1. **环境**：`node -v`、`npm -v` 达标；否则提示安装。
2. **依赖**：在插件根目录跑 `npm install`（首次）。
3. **配置**：`config.example.json` 复制为 `config.json`；引导用户填：
   - `dsh.baseUrl`（Harness 地址，默认 `http://127.0.0.1:53973` 之类，按实际）；
   - `ownerQQ`（管理员 QQ 号）；
   - `allow.groups` / `allow.private`（白名单，至少填自己）。
4. **QQ 网关（OneBot v11）**：确认 SnowLuma / NapCat / Lagrange 任一已装好并给出 ws/http 地址；
   把 `snowluma.wsUrl` / `httpUrl` / `accessToken` 填进 `config.json`。**本仓库不打包网关二进制**。
5. **角色**：`roles/` 下选人格（默认 `AI助手`），`config.json` 的 `role` 字段可改；想自定义就加一个 `roles/<名字>.md`。
6. **小组件（插件）**：默认全上；管理页 `/api/plugins/page` 或七层驾驶舱 `/api/harness/page` 可停用/启用。
7. **启动**：双击《一键启动》或 `node src/bridge.js`；看到「桥接已启动 / SnowLuma 已连接 / DSH 已就绪」即成功。
8. **验证**：在 QQ 用管理员号给自己机器人发一句，能回即通。

## 每步只问缺的
- 已经能检测到的（node 版本、依赖、端口）不问；
- 只问必须用户提供的：QQ 号、白名单、网关地址与 token、Harness 地址。
- 涉及凭据的输入**只写进本地 config/state，不写进聊天记录、不入库**。

## 失败重试
- `config.json` 损坏 → 从 `config.example.json` 重建，绝不回写坏文件。
- 网关连不上 → 先 `check-onebot-status`（或等价探针），再看 token/地址。
- 任何改动先备份，改完 `node --check src/*.js` 再重启。
