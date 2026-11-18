// Soft reply policy is owned by the reply-shape component. Keep this export for
// existing bridge/MCP consumers so they receive the same current protocol.
export {MULTI_MESSAGE_REPLY_POLICY} from '../plugins/qq-components/ctx-chat-reply-shape/reply-protocol.mjs';

export const PRIVATE_FOLLOWUP_POLICY = `【群聊后私聊追问｜独立并列规则】
群聊回复正常发送后，如果本轮实际发言者值得关心（例如提到身体不适、压力、难处或重要经历），或者你对对方说的具体事情确实很感兴趣、自然想知道后续，应在群聊回复完成后调用 private_followup_send 私聊追问一句。先完成群内回复，再用本轮提供的 groupKey 和 userId；只问一个具体、简短的问题，不复述群里已说过的回复。该私聊追问独立于上面的 qq_send_message / qq_reply 选择；工具未提供、私聊关系不满足或触发限频时尊重工具结果，不尝试绕过，不改在群里追问。`;
