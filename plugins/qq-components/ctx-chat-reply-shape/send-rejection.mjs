// Only definite exhaustion is terminal. A smaller batch or shorter message can
// still fix other validation failures; never turn those into forced silence.
export function describeSendRejection(message) {
 const text=String(message||'');
 if(!/(?:最多发送\s*0\s*条|本轮发送额度已用完|发送计划拒绝[：:]\s*turn_limit\b)/.test(text))return null;
 return {code:'TURN_SEND_LIMIT',remaining:0,retryable:false,
  hint:'本回复批次的发送额度已用完；不要重试、改写重发或换发送工具。已发送的内容不再补发。只报告确实已处理的消息回执，未回应的消息保留待处理，再等待用户的新消息（qq_wait_for_messages）；返回 endRound=true 时结束本轮。后续来信由桥接重新判定，不把本次上限解释为账户余额不足。'};
}
