# 维护与检查

[返回项目说明](../README.md)

## 本地检查

Node.js24与npm；Windows实例选择逻辑要求Node.js24.20.0或以上。测试使用隔离副本和桩服务，不代表真实QQ投递验收。

在仓库根目录运行：

```sh
npm ci
npm test
npm run lint:console
npm run build:bundle -- --check
node scripts/build-agent-preset-patches.mjs --check
npm run privacy:check
```

本次维护只改公开文档与项目封面，不重启桥接、DSH或QQ，不改变插件安装、账号及会话。

## 发布与下载

安装与升级优先采用[现有Release](https://github.com/schrolemons/chat-harness-7-2-lays-for-a-AI-bot/releases/latest)中的发行包，并阅读对应版本说明。维护性文档提交不会自动生成新版本。

## 反馈

使用[Issues](https://github.com/schrolemons/chat-harness-7-2-lays-for-a-AI-bot/issues)报告问题，提供使用环境、操作步骤和预期／实际结果。日志中的密钥、账号、聊天记录与个人配置应先移除。已有仓库规则和安全说明优先于个人账号的通用模板。

## 项目标识

`docs/assets/project-cover.svg`是README使用的封面。对应PNG用于在GitHub设置页手动上传分享预览，不加入本仓库的发行文件。封面是项目标识，不是实际运行截图。版式由schrolemons的项目封面统一约定组成；修改时保留文字可读性和1280×640画布。
