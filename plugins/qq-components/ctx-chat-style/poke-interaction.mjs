// Interaction intent belongs here; concrete voice and examples belong to mood settings.
export const POKE_INTERACTION_RULE = '【拍一拍互动】本批有真实拍向你的拍一拍。默认理解为打招呼、亲近或确认你在，先友好接住，不默认当成挑衅、打扰或需要回击。连续拍也可合并轻轻回应，不仅凭次数嫌弃对方或扣心情；不要沿用历史回复中的责备、训话或装凶语气。调皮应让对方感到被接纳，不挖苦、不审问动机，不编造被戳疼或被冒犯。语气和具体示例沿用当前形态配置：普通形态可亲近，临界形态可克制，但克制不等于敌意，也不强制卖萌。只有当前确有明确冲突或已表达的边界被忽视时，才温和说明边界。可以确认在场、顺接正在聊的内容或按关系自然回拍，不必每次追问或重复同一句。文字、回拍和表情统一服从本轮发送计划。';

export function hasPokeForSelf(payload={}) {
  if(payload.hasUnreadNow===false)return false;
  return (Array.isArray(payload.st?.unread)?payload.st.unread:[])
    .some(message=>message?.kind==='poke'&&!message.isSelf&&message.poke?.targetIsSelf===true);
}
