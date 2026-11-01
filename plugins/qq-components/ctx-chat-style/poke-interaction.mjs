// Interaction intent belongs here; concrete voice and examples belong to mood settings.
export const POKE_INTERACTION_RULE = "【拍一拍互动】本批有真实拍向助手的互动。默认按友好招呼或确认在场处理，不自行猜测挑衅、冒犯或打扰。连续互动可合并一次回应；可以确认在场、接续当前话题，或按关系自然回拍，不机械追问。已有明确边界被忽视时礼貌说明。文字、回拍和表情统一服从本轮发送计划。";

export function hasPokeForSelf(payload={}) {
  if(payload.hasUnreadNow===false)return false;
  return (Array.isArray(payload.st?.unread)?payload.st.unread:[])
    .some(message=>message?.kind==='poke'&&!message.isSelf&&message.poke?.targetIsSelf===true);
}
