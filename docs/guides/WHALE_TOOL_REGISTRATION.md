# AI助手工具注册合同

AI助手自己的 MCP 定义以 `src/tools/servers.js` 为目录；DSH 内置工具、系统执行和浏览器宿主能力不归这个目录注册。新增工具不可只往前端加名称。

1. **组件工具**：在 `plugins/qq-components/<id>/index.js` 使用 `ctx.registerTool(name, { description, schema, handler })`。宿主负责生命周期、启停、重载与实际工具注册。实现必须经桥接能力访问 QQ/DSH，不私连协议。
2. **MCP 工具**：在对应 server 中注册真实 schema 和 handler。若新增 server，声明其名称、脚本、所属层和 `audience`，更新负责安装该 server 的安装器及对应 preset 范围。QQ 配置开关只在 `src/tools/flags.js` 声明一次，MCP 注册与控制台共同使用。
3. **开放范围**：`audience: qq` 才是普通聊天候选；管理工具和浏览器工具在 QQ preset 的注册期隐藏，并保留执行期守卫。`tool-visibility.mjs` 在 `tools/change` 后重查，处理晚于 preset 注册的 MCP。
4. **实际验证**：`npm run audit:tools` 只做 MCP 握手与 `tools/list`，不调用工具、不发 QQ、不调用模型。结果保存在本机 `state/tool-catalog.json`，包含当前源码/配置/模式指纹。
5. **注入证据**：管理 API `/api/tools/catalog` 只读现有 QQ 会话最新 `request/header` 的工具名称，与实际注册表合并。普通 T 层列表只列已注册且有请求注入证据的聊天工具。待注入、已删除但仍残留的 schema、管理工具分开显示。请求头记录的是最近已发生请求，不表示尚未发生的下一轮请求。
6. **刷新要求**：保存配置不等于 MCP schema 已刷新。组件重载、MCP 客户端刷新、preset 更新和 DSH 重载分别验证；不重建既有聊天或删除历史。所需中断先取得用户授权。

应分别证明：注册成功、preset 可见、请求实际携带 schema、调用成功、出站实际送达。这五个状态不能互相代替。

学习资料工具：`qq_term_query`、`qq_slang_query`、`qq_alias_query` 与 `qq_knowledge_sources` 的来源/查询/修改合同见 [LEARNING_SOURCES.md](LEARNING_SOURCES.md)。新增 schema 及独立开关必须以真实 stdio 握手、tools/list 和调用转发验证；不代表既有 DSH 客户端已刷新。


### 等待工具拆分（2026-10-30）

`qq_wait_for_messages` 与 `qq_wait_for_quiet` 共用 `waitMessages` 开关，均作用于私聊和群聊。前者收到新消息立即返回，真正无人回复超时由 life-conversation-wait 执行 p/q 递增终止；后者只确认最后来信后的静默，不计无人回复次数。旧 purpose=reply 仍兼容转入静默路径。新工具注册需要桥接及 DSH MCP 进程加载最新代码后核验实际工具面，单独热加载插件不能完成部署。

### S 层标准私人资料包

唯一注册源为 `mcp-personal-core`（serverName `personal-core`），只提供 `core_status`、`core_topics`、`core_read`。组件服务同名；工具不接受任意目录或文件路径，管理员仅从控制台配置挂载目录。资料包协议、AI整理说明与虚构示例见 [说明.md](../personal-core/说明.md)。机主SCHNIE包属于私人数据，框架不内置其作者、章节或话题；旧工具名称只在一次性迁移中处理，不保留运行别名。
