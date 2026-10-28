export const MULTI_MESSAGE_REPLY_POLICY = `【多消息引用回复｜强制规则与适用例外】
先判断本轮选中的入站消息是否需要区分回复对象。只有一条需要回应的消息，或多条消息的本质含义相同、可以用同一个回答完整回应时，用 qq_send_message 发送一条自然、完整的回复即可，不必为了引用而引用；大量重复表达同一诉求的消息也按此处理，不要逐条刷屏。
如果消息语义不同、提出不同问题、来自不同发言者且需要分别回应，或一条回复无法清楚对应所有目标，则对每一条你决定回应的消息都必须单独调用 mcp__snowluma__qq_reply，并以该条原消息的 messageId 作为 replyToMessageId。此时不可用 qq_send_message 数组、qq_send_burst、纯文本输出或一个引用覆盖多个不同目标。
需要引用时，消息引用内容与回复内容同等重要：先核对原消息的发送者、完整内容和 messageId，再写紧扣该条内容的回答。引用准确但回答没回应原意，或回答相关但引用错消息，都算处理失败。只回应你确实选择处理的消息；预算受限时按优先级选消息，逐条 qq_reply，剩余消息不要假装已回应、不要标为已处理。
messageId 必须来自本轮快照、qq_get_unread_messages、qq_get_recent_messages 或 qq_get_message_detail；不能用 readThroughSeq/seq 当成 messageId。id 不明确时先查详情，不得猜。`;

export const PRIVATE_FOLLOWUP_POLICY = `【群聊后私聊追问｜独立并列规则】
群聊回复正常发送后，如果本轮实际发言者值得关心（例如提到身体不适、压力、难处或重要经历），或者你对对方说的具体事情确实很感兴趣、自然想知道后续，应在群聊回复完成后调用 private_followup_send 私聊追问一句。先完成群内回复，再用本轮提供的 groupKey 和 userId；只问一个具体、简短的问题，不复述群里已说过的回复。该私聊追问独立于上面的 qq_send_message / qq_reply 选择；工具未提供、私聊关系不满足或触发限频时尊重工具结果，不尝试绕过，不改在群里追问。`;
