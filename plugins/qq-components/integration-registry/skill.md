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
- 本注册中心本身 `layer=""`，只提供接入说明与工具 `integration_howto`。

## 边界
只做说明与视图；启停/排序/配置仍由宿主与既有的 `/api/plugins` 接口统一执行。
