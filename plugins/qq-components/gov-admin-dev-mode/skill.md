# skill：管理员开发模式提示（gov-admin-dev-mode）

## 它解决什么
主动启用管理员环境且高权限预设已装配的 owner 私聊，得到实际能力与授权边界说明；人设、语气和二代交互流程不变。不再使用退役的 qq-chat-dev。
这段文案以前硬编码在 `buildWakePromptV2` 里；现在由本组件产出，桥接只调服务。

## 什么时候被调用
桥接在拼 base 之前：`pluginHost.callService('admin-dev', 'line', { aliasEntries, rootEscaped })`。
仅当统一的 `hasAdminEnvironment(key)` 检查通过时调用。owner 身份、封闭模式或模型自称管理员均不单独授予权限。

## 输入
| 字段 | 含义 |
| --- | --- |
| `aliasEntries` | 昵称对照（`十二=private:10003、…`） |
| `rootEscaped` | 桥接仓库根路径（已做反斜杠转义，直接嵌进提示词） |

## 边界
- 只产文案；没有工具权限、不写文件、不发消息。
- 真正能不能用工具由管理员环境开关、实际装配的 DSH 预设、桥接鉴权与 DSH 审批共同决定，不是这段文案决定的。
- 插件禁用/缺失时桥接不再注入这段（owner 会话会退回普通 qq-chat-v2 式提示），不会报错。
