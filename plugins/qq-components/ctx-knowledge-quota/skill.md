# 专业问答配额

本组件用可配置的领域关键词，加上明确的知识问句或任务请求规则识别专业问题；不调用模型分类。默认覆盖技术、数学、科研与论文的一组常见词，支持“请写代码”“证明定理”等无问号请求。只是提到术语、普通闲聊、进度问候、催交论文和维护/主动通知不计数。

这是保守的规则分类器，不是完整语义理解：词表外的专业问题、代词指代的后续追问、图片中的题目、含糊或复杂混合表达可能漏判，也可能存在误判。既有自定义 `keywords` 覆盖默认词表，不会被自动扩充；新默认词只影响未覆盖的配置。

`dailyLimit` 是每个计数对象每天获准的请求数，0表示从第一个识别到的请求起带过。`resetHour` 按桥接进程本地时区切日。`exemptOwner` 对主人私聊和可信入站中的主人群发言生效。`countBy=session` 按会话共用；`user` 只在群聊按真实用户ID分桶，私聊仍按会话。缺少真实群用户ID时保守回落会话桶。

同一真实 `messageId` 在同一会话只生成一次决定；缺少ID时使用会话内 `seq`，再缺失时使用完整原文、用户ID和时间的摘要。后者无法区分没有ID和时间的完全相同消息。额度内的最后一次问题重试保持准许；同文新消息独立计数。旧消息跨日重试不扣新日额度。旧版前80字符签名没有消息ID，不能无歧义恢复成新版身份；已有每日计数保留，不主动改生产状态。

`knowledgeQuota.classify(payload)` 只读分类；`evaluate(payload)` 持久化本消息的准许/带过决定，并返回 `action`、计数与 `prompt`。`beforePrompt` 复用 `evaluate`。默认只检查最新一条非self消息；桥接若提供多条待回复请求，必须逐条预检，不能把“仅检查最新一条”当作整批额度管理。

群聊首次bootstrap可能只是初始化，并不代表用户叫机器人回答；没有此前消息准许/拒答决定时，bootstrap忽略专业配额，不扣额也不注入额度提示。实际触发机器人回应的群消息应先由共用入口预检，随后bootstrap复用该决定，不重复分类或记账。

`await knowledgeQuota.preflight({key,plainContent,messageId,userId,isOwner,reason,allowed,onHandled})` 在模型派发前执行相同决定。普通文字消息只由桥接的群私共用、实际唤醒合格后的唯一入口调用，不注册 `relayIncoming` 兼容入口，避免在未实际唤醒前预扣。额度内和非专业内容返回 `{handled:false}`。超额时先持久化拒答凭据，再用 `capabilities.sendSessionText` 直接发送 `deflectText`，返回 `{handled:true, action:'deflect', delivered, receiptStatus}`；调用方必须立即终止该请求的模型派发，并用 `onHandled` 在发送await之前将对应消息移出待处理。发送失败、未知或持久化失败也保持 handled，不能自动放行模型或盲目重发。

`deflectText` 是真正发出的固定短句，合并空白、最多120字符；留空回落默认。旧 `deflectStyle` 不再声明、不展示、不消费，既有override数据无需删除。固定短句不经过模型，不能宣称“模型已经学会遵守额度”。如桥接没有调用预检，`beforePrompt` 只有提示约束，不能保证阻止技术回答。

普通决定有有界历史；任何已生成的发送凭据（claimed/sent/uncertain）不随裁剪、跨日或额度重置删除，避免重放。额度重置清计数及对应普通去重决定，不清发送凭据；本组件的 query/reset 工具只供管理员控制台，聊天agent入口应由桥接拒绝且不向聊天MCP注册。

验收：`node --test scripts/test-knowledge-quota-behavior.mjs`，全部使用内存或临时文件、记录型发送能力；无真实QQ、模型或生产状态读写。群私共用入口、批量待处理、并行回合与模型读取接口的完整桥接集成需要另行验证。
