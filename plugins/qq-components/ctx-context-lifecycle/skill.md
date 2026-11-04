# ctx-context-lifecycle

回复前确需确认对方是否说完时，按最后来信时间调用 qq_wait_for_quiet，已过去的静默计入；不同语义分别引用、相近内容合并一波并逐条提交回执。回复及回执完成、对方可能还想聊但此刻未接话时，按需调用 qq_wait_for_messages 等新互动，无人回复时按 life-conversation-wait 返回的 endRound、action 和 guidance 收尾、继续等待、延续旧话题或开启新话题；私聊与群聊一致。旧固定沉睡前观察已退役。组件只产出提示，概率与终止状态归 life-conversation-wait，DSH取消与消息队列保留归桥接环境。
