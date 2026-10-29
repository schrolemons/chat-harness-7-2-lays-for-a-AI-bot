# 自动人物档案提取标准

普通聊天与 memoryWrite 共用 extraction-policy.mjs。语义判断由模型完成，写入通过现有 profile_get/profile_update，继续受宿主鉴权控制。

- 逐栏检查 routine_food、hobbies、relationships、catchphrases。明确姓名等可用 identity 扩展字段；不能把学科误作爱好。
- 有可核对来源的人际关系、明确边界、值得记住的共同经历要补充，不以好感或亲近感为条件。只有一起吃饭的证据就记该共同经历与日期，不猜关系称谓。
- 区分本人表达、本人转述、摘要和推断；保留 QQ、会话、日期、消息 ID/seq，缺少的来源字段不补造。转述仅写入讲述者自己的关系，不替第三方认证，不自动创建反向关系。
- 读取旧档案后合并完整字段，保留无关信息并去重；明确更正才替换冲突事实。只有工具成功才记已写入；失败或来源不明时留会话记忆候选。自动整理不调用 profile_delete。
- 一次起床、一次吃饭口味、单次玩笑或短时刷屏不能证明长期习惯或口头禅。当天近况归持久化记忆，轻量只保留当前话题、bot待说想法与短窗口印象。
- 群聊仍只处理工具允许的本轮真实发言者；管理员明确授权才可跨档案。不能因为记忆整理扩大权限或把别的私聊材料搬进群。

候选队列保留证据最多 6 小时，每会话最多 maxSnippets 条，总量最多 32 倍该上限；渲染提示不等于写入成功，不会因此清队列。定时更新绕过普通冷却并补读当前会话 recentMessages 中的非自发消息。相同消息 ID/seq 去重，截断片段标记 truncated，须核对完整原话再判断。

验收：test-profile-extraction-policy.mjs（证据流/重试/隔离/截断/定时提示）、test-memory-profile-promotion.mjs（接口兼容）、test-profile-sharing.mjs（真实工具读写及权限）、test-memory-context.mjs（四栏目与宿主注入）。不把离线规则测试视为真实模型提取验收。
