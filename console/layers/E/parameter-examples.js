// Behavior examples owned by this layer; no runtime configuration values.
export default {
  "exec-browser-manager": {
    "headlessFor": "保留 monitor|automate|scrape-readonly：这些用途不显示窗口；用 | 分隔多个用途，登录时仍可切换到可见窗口。",
    "visibleFor": "保留 login|auth|captcha：登录和验证码等用途显示窗口，让你完成验证；多个用途用 | 分隔。",
    "allowUrls": "填https://example.invalid：把此地址纳入允许范围；不要把账号或密钥写进网址。",
    "blockUrls": "加入某个地址后，浏览器访问规则会检查该阻止项；允许项不应被当作绕过阻止项的凭据。",
    "rules": "写“提交表单前先确认”：作为浏览器操作提示提供给模型，不替代服务端权限检查。"
  },
  "exec-image-generation": {
    "apiBase": "填https://images.example.invalid/v1：请求发往你自己的兼容图片接口，不会改变聊天模型地址。",
    "proxyUrl": "填http://127.0.0.1:7897：仅图片供应商请求经这个代理；留空使用现有代理环境。",
    "model": "填供应商提供的模型ID：生图请求使用该ID，不会切换平时聊天模型。",
    "size": "填1024x1024：请求正方形图片，实际尺寸支持范围由所选服务决定。",
    "quality": "填服务支持的画质档位：用于生图请求；不支持的值会由服务返回错误。",
    "quotaMode": "选both：全局额度和每会话额度都必须有余量，满足一个不能绕过另一个。",
    "dailyGlobalLimit": "设为20：所选额度模式启用全局限制时，所有会话合计受每日20次约束。",
    "dailySessionLimit": "设为3：启用会话限制时，同一会话每日最多使用3次额度。",
    "maxPromptChars": "设为2000：过长的生图描述不能无限制传给供应商。",
    "maxReferenceImages": "设为2：一次生图最多附带2张参考图片。",
    "maxReferenceBytes": "设为5242880：单张参考文件按5MiB的输入大小门槛检查。",
    "maxOutputBytes": "设为10485760：生成图片下载超过10MiB时会被拒绝继续作为正常结果处理。",
    "timeoutSeconds": "设为120：单次请求最多等待约2分钟，不会无限挂起。",
    "cooldownSeconds": "设为60：同一会话两次生图至少间隔1分钟。",
    "allowAutomatic": "关闭后，模型不能仅因随口聊天就自动发起生图；仍需符合明确请求等调用条件。",
    "allowedSessions": "只填private:10001：仅该会话在此允许列表范围内；其他权限与额度仍需满足。",
    "assetRetentionDays": "设为7：本地生图资产按7天保留策略清理，不等于删除已经发到QQ的消息。"
  },
  "life-web-watch": {
    "fastCheckMinutes": "设为1：每分钟检查任务是否到期，不代表每分钟导航全部网页。",
    "fullCheckMinutes": "设为5：普通网页完整抓取约每5分钟进行一次。",
    "webWatchEnabled": "关闭后停止普通网址检查，保留已填写网址以便恢复。",
    "watchUrls": "填“名称 | 网址”：监控该页变化；取消该行勾选则暂停这一个网址。",
    "scriptCollabEnabled": "开启后可以展示协同脚本心跳；只填路径不等于自动执行脚本。",
    "scriptPaths": "填脚本的本地路径：只有脚本按约定回传心跳后才显示运行状态，路径本身不是执行授权。"
  }
};
