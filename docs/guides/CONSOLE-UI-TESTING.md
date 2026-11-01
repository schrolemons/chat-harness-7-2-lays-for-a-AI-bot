# 控制台隔离预览与回归

前端拥有源见 `console/README.md`。先运行 `npm run build:console`，再运行 `npm run preview:console`；访问本机4173端口。fixture只加载模板与编译资源，以合成内存数据模拟API，不读取生产state、不调用QQ或模型。

## 验收命令

- `npm run lint:console`：未定义引用与重复对象键。
- `npm run test:console-modules`：模板路径、资源凭据边界、组件字段、工具注入证据、私有快照、启动与静态合同。
- `npm run test:console-ui -- --artifacts=state/audits/console-ui`：真实浏览器验证30项功能，包括全部规范导航、所有注册组件可见性、保存请求与单位/零值、草稿保留、工具来源、移动布局和主题。
- `node --test scripts/test-budget-console-ui.mjs scripts/test-learning-console.mjs scripts/test-console-login.mjs scripts/test-token-budget-mechanical.mjs`：预算、学习、登录与恢复行为。
- `npm run test:component-behavior`：参数实际影响提示/服务/派发的专项隔离行为。
- `npm run test:monitor`：监控提取、登录识别、租约恢复、去重与临时Edge profile的可见→无头交接。

原版预览、旧222/225控件ID名单和整轮写请求基线已经从活动测试移除，原文件留在本机审计归档及Git初始提交中。新测试直接针对真实拥有模块和各API行为；不得为保留旧断言而恢复废弃控件。

`htmlPath`仅用于显式测试文档。正常预览读取当前装配入口。结果JSON记录testedBuild和componentCount；截图、真实运行凭据和个人页面内容不随公开模板发布。
