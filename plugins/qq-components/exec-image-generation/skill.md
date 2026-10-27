# 图片生成与梗图

E 层负责向自行配置的 OpenAI 兼容生图接口提交文字或当前 QQ 会话中的参考图片，保留生成结果于本机 `state/image-generation`。bot 按 `qq_make_meme` → `qq_get_meme_job` → `qq_send_image` 使用。不能输入任意本机路径；图片 ID 只对应生成时的会话。缺密钥与模型时不发起请求。密钥由控制台单独设置，永不出现在组件公开配置中。

每日额度按北京时间重置，提交成功即预留额度；超时、未知结果不会自动重试。允许逐会话与全局同时限额。`allowAutomatic` 为 false 时只能回应明确的生图要求。
