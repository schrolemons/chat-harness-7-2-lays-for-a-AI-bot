# 词条、黑话与绰号：适用来源合同

三类资料共用 `plugins/qq-components/learning-scopes.mjs`；桥接只负责鉴权、存储能力与传输，不再保留另一套全库注入规则。

- `sourceKeys`：默认注入适用的会话数组。例如 `["group:10001","private:10002"]`；最多50个，空数组仅查询。
- `originKey` 和 `evidence`：原始采集位置及证据。修改适用名单不会移动条目或改写证据。
- 旧单值 `sourceKey` 只在读取时迁移；不能确定适用来源的旧资料不再隐式全局注入。
- 默认注入只选已确认、名单包含当前会话的条目，按频次与更新时间排序。三类上限独立，范围0–40；0仍支持按需查询。

| 类型 | 默认注入设置 | 按需查询 |
| --- | --- | --- |
| 词条 | `ctx-interest-terms.config.injectMax`（默认3） | `qq_term_query` |
| 黑话 | `config.slang.injectMax`（默认8） | `qq_slang_query` |
| 绰号 | `ctx-member-alias.config.injectMax`（默认40） | `qq_alias_query` |

当前来源内可检索；其他来源只接受完整名称/别名匹配，绰号也接受精确QQ。空查询或部分词名不能遍历其他会话。结果只返回释义或确认映射，不返回原始聊天证据、备注或其他来源名单。候选永不作为确认事实返回。

本轮消息完整命中未注入词名、或回复用户的QQ存在确认绰号时，生成明确查询工具提示。最终是否执行仍由聊天模型决定；工具注册成功、请求携带schema、模型实际调用是不同验收项。

## bot 调整高频资料

`qq_knowledge_sources({key,token,kind,id,action})`：kind为term/slang/alias，action为include_here/exclude_here。只允许增删令牌对应的当前会话，保留其他会话名单；不能确认候选。先查询取得条目ID，反复用到且适合当前会话时再加入。

管理传输：GET `/api/socialV2/{term|alias|slang}/query`，POST `/api/socialV2/knowledge-sources`。严格使用当前会话令牌；独立工具开关见T层。

Console在三类管理页编辑多来源名单，并通过下拉选择已有会话。GET `/api/learning/sources` 供控制台检查后端合同版本；旧核心没有该合同则阻止保存新字段，避免假成功。它是管理接口，不向聊天模型开放。

## 验证与启用

`npm run test:learning-scopes` 验证组件、鉴权、来源修改与真实stdio MCP注册/停用。学习浏览器回归为 `node scripts/test-learning-console.mjs`，只操作隔离数据。

涉及bridge/MCP核心，不能仅重载三个插件就声称已启用；等并行核心修改定稿后统一验证、备份真实状态、受控启用并重连QQ MCP，随后核对运行指纹和请求工具面。私人数据原文件仍由本机state拥有。
