// Shared protocol is framed into the stable user prefix, never mixed with QQ text.
const protocolURL=new URL('../ctx-chat-reply-shape/reply-protocol.mjs',import.meta.url);protocolURL.search=new URL(import.meta.url).search;
const {MULTI_MESSAGE_REPLY_POLICY}=await import(protocolURL.href);
export const COMMON_CHAT_PROTOCOL=MULTI_MESSAGE_REPLY_POLICY+'\n回复完成且确有继续聊天的理由时才调用qq_wait_for_messages等待；endRound=true后结束本轮，不为收尾再发送。';

export function bridgeEntryGuidance(key){
 return String(key).startsWith('group:')
  ? '【行动前｜群聊】先读最近相关消息，优先回复本次@、点名、提问或拍一拍涉及的请求，结合相邻消息理解整段话，不因抽到新话题而跳过待答问题。正常接续当前话题，不再抽是否终止；如果只有空@、叫名字或拍一拍，没有具体待答消息，则按本轮话题选择抽签延续或换题，不把招呼本身当作旧话题。旧话题已经收束且没有待答请求时可自然换题；仍服从话题冷却、发送频率与公共等待机制。群聊热闹但无人点名时，结合话题和当前发送计划判断是否参与。'
  : '【行动前｜私聊】先理解对方当前的问题，判断是否说完、是否明确忙碌或收尾；结合当前形态、免打扰和发送计划自然回应，不套用群聊的点名和插话判断。';
}
