# skill：管理员开发模式提示（gov-admin-dev-mode）

## 它解决什么
owner 私聊（qq-chat-dev）会多出一大段「管理员开发模式」说明：本机工具、浏览器、GitHub 工作流、传话/发送约束、安全边界。
这段文案以前硬编码在 `buildWakePromptV2` 里；现在由本组件产出，桥接只调服务。

## 什么时候被调用
桥接在拼 base 之前：`pluginHost.callService('admin-dev', 'line', { aliasEntries, rootEscaped })`。
仅当会话是 owner 私聊且 `socialV2.adminDev.enabled !== false` 时才调用。

## 输入
| 字段 | 含义 |
| --- | --- |
| `aliasEntries` | 昵称对照（`管理员=private:10612、…`） |
| `rootEscaped` | 桥接仓库根路径（已做反斜杠转义，直接嵌进提示词） |

## 边界
- 只产文案；没有工具权限、不写文件、不发消息。
- 真正能不能用本机工具由 DSH preset（qq-chat-dev）决定，不是这段文案决定的。
- 插件禁用/缺失时桥接不再注入这段（owner 会话会退回普通 qq-chat-v2 式提示），不会报错。
