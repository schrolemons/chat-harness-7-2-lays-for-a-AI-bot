# skill：集成注册中心（integration-registry）

## 它是什么
不是第九层，而是**八层之上的横切注册中心**：让用户自己装的第三方插件/项目
（自助逛哔站、自助刷网课……）也能注册进八层模型，被统一管理参数、配置与开关。

## 第三方如何接入
1. 目录：`plugins/qq-components-user/<id>/`（与内建 `qq-components/` 分开，宿主自动扫描，标记 `builtin=false`）。
2. 清单：`plugin.json` 里声明：
   - `layer`：C / T / E / L / O / V / G / S 之一（决定它归到八层哪一层）；
   - `config`：参数与默认值（开关字段放这里，前端统一读）；
   - `name` / `description` / `version` / `tags`。
3. 代码：`index.js` 导出 `createPlugin(ctx)`，可选 `hooks`（beforePrompt 等）与 `ctx.registerTool`。
4. 管理：重启或热重载后出现在管理页对应层；参数/开关统一走 `/api/plugins`（list / detail / toggle / order）。

## 与八层的关系
- 第三方插件**映射进**八层（layer 字段），不另立第九层；
- 本注册中心本身 `layer=""`，提供接入说明、`integration_howto` 和薄适配服务。

## 边界
启停/排序/配置仍由宿主与既有的 `/api/plugins` 接口统一执行。任意下载的DSH原生插件不会自动被改写或获得QQ工具权限。

## 薄适配

位于 `plugins/qq-components-user/<id>/` 的用户组件导入 `../../qq-components/integration-registry/adapter.mjs` 的 `createBridgeAdapter(ctx,{keys,snapshot,actions})`，并返回其 hooks/services。`keys` 必须显式列出会话；`snapshot({key})` 同步读取已经监测到的本地状态，不请求QQ、不调用模型，单份JSON不超过2000字符。失效、卸载、超限或异步快照不注入旧数据。多个状态在本轮动态上下文总计不超过6000字符。

示例：房间驱动以 snapshot 提供位置/物品/活动版本，actions 包装原驱动命令。主聊天已经带入完整角色卡、人物资料和本会话记忆；适配状态在其后的动态资料中注入，不能覆盖身份或把房间文案当指令。`services.integrationAdapter.context({key})` 返回本会话当前风格、角色拥有源引用、记忆和心情的只读副本，不含聊天令牌。完整角色仍由主聊天唯一来源提供，不另存一套人格；另起自带LLM的第三方聊天器不会自动继承这些约定。

`invoke({key,action,args})` 只调用已登记的当前会话动作，并把共享context交给驱动。动作必须返回 `status: completed|queued|unknown|failed`；只有completed视为执行成功。queued不能写成已经执行，unknown不自动重试。适配服务不创建MCP权限、不直连QQ，也不绕过插件原有的授权/参数校验；原生插件需针对自身驱动写一个小包装。

逐请求刷新由 obs-context-assembly 的已审计列表包含 integration-registry，插件状态不是只在第一轮注入。验证：`node --test scripts/test-integration-adapter.mjs`；房间夹具验证记忆影响饮品选择、风格传递、会话隔离、卸载失效与执行凭据。未安装真实第三方房间插件，不称为其端到端验收。
