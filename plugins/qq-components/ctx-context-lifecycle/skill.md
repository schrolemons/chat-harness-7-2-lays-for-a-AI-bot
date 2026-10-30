# ctx-context-lifecycle

回复前按最后来信时间调用 qq_wait_for_quiet 判断是否说完，已过去的静默计入；不同语义分别引用、相近内容合并一波并逐条提交回执。每波实际回复后调用 qq_wait_for_messages 等新互动，无人回复按 life-conversation-wait 的递增概率收尾；私聊与群聊一致。旧固定沉睡前观察已退役。组件只产出提示，概率与终止状态归 life-conversation-wait，DSH取消与消息队列保留归桥接环境。
