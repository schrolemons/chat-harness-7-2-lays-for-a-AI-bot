# skill：工具注册表（tool-registry）

## 它解决什么
工具面现在是「实现 + schema + 鉴权 + 转发」混在一个 MCP 进程里。这个插件先把**声明**抽出来：
名字、分类、权限等级（只读 / 写入外发）、能力说明。管理页与 AI 都能查，后续桥接按声明做代理注册。

## 什么时候被调用
- 工具 `tool_list`：按分类列工具（可传 `category`）。
- 工具 `tool_describe`：看单个工具声明。
- `beforePrompt`：默认不注入（MCP 已给 schema）；`config.injectPrompt=true` 时只注入一行提示。

## 分类
observe（读）/ send（发）/ wait（等与收尾）/ memory（记忆）/ media（表情与图片）/ learn（黑话与反馈）。

## 权限等级
- `read`：只读，任何人可用。
- `write`：会往外发或改状态，受白名单/令牌/限频约束。

## 后续（同层迭代）
1. 桥接按本声明代理注册工具，MCP 进程退化成执行壳。
2. 工具开关从 `config.socialV2.tools` 挪进声明，管理页可直接改。
3. 声明带版本号/签名，防止工具定义被篡改。
