# 控制台前端的唯一源码

控制台按层管理。`public/console.html` 是装配入口，页面内容来自本目录的片段，浏览器脚本与样式由 esbuild 编译。`public/console/app.js`、`app.css`、`theme-init.js` 是生成产物，不直接修改。

| 目录 | 负责内容 |
| --- | --- |
| `layers/C` | 人格、学习、称呼、记忆、人物档案、专业问答 |
| `layers/T` | AI助手工具注册、开关、Games 与专用 MCP |
| `layers/E` | 浏览器、监控、图片、语音、会话与执行环境 |
| `layers/L` | 唤醒、发送、补话、主动行为、日程与任务 |
| `layers/O` | 状态、花费、日记、反馈、自查与日志 |
| `layers/V` | 失败回归与 human |
| `layers/G` | 访问、安全策略与控制台令牌 |
| `layers/S` | 私人资料包挂载与按需阅读 |
| `layers/R` | 扩展注册管理 |
| `shared` | API、路由、主题、基础样式、通用组件表单基础 |

每层内的 `pages/` 是页面片段，`components/` 是具体组件的标签与编辑器定义，`editors/` 是较复杂的专用交互。`config-load.js` 与 `config-save.js` 分别负责该层配置的读取和采集。`ownership.js` 声明组件进入哪个规范页面；不得把它改成旧页面索引或隐藏迁移容器。

## 修改流程

1. 从 `layers/<层>/ownership.js` 找到真实可见页面，再修改对应片段/模块。
2. 组件的 `plugin.json.config`/`configSchema` 拥有配置合同。表单只补说明和专用编辑方式；已删除字段不会继续生成，新增字段必须进入所属页面。内部哨兵和凭据不作为可编辑项。
3. 修改后运行 `npm run build:console`、`npm run lint:console`、`npm run test:console-modules`、`npm run test:console-ui`。
4. 确认组件实际行为，而非只确认保存成功。涉及核心服务器模块的改动另行受控重启；普通组件优先热加载。

不存在 `v2-c/v2-o` 旧参数页、按 details 数字索引搬运控件、旧路由映射或原版预览入口。C 层规范地址为 `#setting-c-0`、`#setting-c-1`、`#setting-c-2`。

服务端模板/资源处理在 `src/console/`；通用插件管理 API 在 `src/console/plugin-management.js`，实际 QQ/DSH 传输仍归桥接。源码、编译产物、当前进程是否已加载是三项分别验证的状态。

## 分区与保存范围

- 基础项直接展开；范围、阈值和低频调整项按功能分组，默认折叠。不要用运行时搬运制造第二个配置入口。
- 组件规则通过 `shared/components/scope.js` 标明全局或本机作用范围；按钮写明保存对象。全局规则按会话分别执行，不意味着心情、记忆和用量混用一份数据。
- 会话背景、轻量记忆、事务、事实正文和定时时段只影响选中的会话；人物档案按 QQ 号保存。全局默认值与局部覆盖值使用独立保存入口。
- 模型与思考强度统一由调用档位与成本策略拥有；控制台不再提供 DSH 全局默认的写入卡片。本机 API 密钥单独保存。
- 页面批量保存只提交 `shared/config-scope.js` 声明的全局组与本页拥有的补充参数，不提交会话正文，也不清空其他页面草稿。
- 每个可调参数的说明应有单位和具体例子。来源是组件 schema、分层 `parameter-examples.js` 或该字段所在的 HTML。

- 心情表单声明 `ownsEnabled`，只显示“启用心情系统”。显示状态结合组件加载状态与机制开关；保存开启时同步激活组件，关闭机制时保留既有账本。不要重新加第二个启用入口。
