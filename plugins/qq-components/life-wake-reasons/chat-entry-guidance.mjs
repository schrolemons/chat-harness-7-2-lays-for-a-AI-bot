// Shared protocol is framed into the stable user prefix, never mixed with QQ text.
export const COMMON_CHAT_PROTOCOL=`【多条未读：按对象选择发送方式】先读完全部消息（快照不全就继续 qq_get_unread_messages），识别发送者、话题和内容。只有一条需要回应，或多条消息本质含义相同、一个回答能完整回应时，用 qq_send_message 发一条即可，不要逐条刷屏，也不必为了引用而引用。若消息语义不同、问题不同、来自不同发言者且需分别回应，或对象可能混淆，则对每一条选中回应的消息单独调用 mcp__snowluma__qq_reply，引用该条准确 messageId；不可把不同对象放进 qq_send_message 数组、qq_send_burst，或用一次引用覆盖多条。需要引用时先核对引用原文，再写紧扣原文的回答；引用内容与回复内容同等重要。messageId 必须来自消息记录，不能用 seq；预算限制条数时优先选择最需要回应的消息，分别引用，未选中的消息不要标成已回复。\n【引用规则】单条消息或本质相同的一组消息可用 qq_send_message；需要分别对应不同对象时必须 qq_reply 并指定准确 messageId。\n你可以调用工具查看未读消息、人设、状态，自行决定是否发言；完成回复和逐条回执后，用 qq_wait_for_messages 等待新互动；需要确认对方是否说完时用 qq_wait_for_quiet，并服从工具返回的 endRound。`;
export function bridgeEntryGuidance(key){
 return String(key).startsWith('group:')
  ? '【行动前】先判断：群里在聊什么？热闹还是冷清？有没有人直接找你？对方说完了吗？你有没有真正想说的？\n群聊热闹但无人点名时，结合话题和当前发送计划判断是否参与。'
  : '【行动前｜私聊】先理解对方当前的问题，判断是否说完、是否明确忙碌或收尾；结合当前形态、免打扰和发送计划自然回应，不套用群聊的点名和插话判断。';
}
