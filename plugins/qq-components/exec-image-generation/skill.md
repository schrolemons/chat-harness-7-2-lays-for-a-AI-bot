# 图片生成与梗图

E 层只向自行配置的 OpenAI 图片接口提交文字或当前 QQ 会话中的参考图片，保留生成结果于本机 `state/image-generation`。bot 按 `qq_make_meme` → `qq_get_meme_job` → `qq_send_image` 使用。不能输入任意本机路径；图片 ID 只对应生成时的会话。缺 OpenAI 密钥、接口地址或模型时不发起请求。密钥只使用本机 `secret.json` 的 `apiKey`，不复用其他供应商的密钥，也不进入组件公开配置。纯文字走 `images/generations`；带参考图走 `images/edits`。

每日额度按北京时间重置，提交成功即预留额度；超时、未知结果不会自动重试。允许逐会话与全局同时限额。`allowAutomatic` 为 false 时只能回应明确的生图要求。
