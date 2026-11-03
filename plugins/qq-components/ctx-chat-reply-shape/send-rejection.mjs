// Explain recoverable source failures separately from terminal exhaustion.
export function describeSendRejection(message) {
 const text=String(message||'');
 if(/\bcontent_required\b/.test(text))return {code:'REPLY_CONTENT_REQUIRED',retryable:true,
  hint:'先用本回合已完整读入的 seq 按完整含义调用 qq_reply_contents 分组，取得 contentId，再在发送工具中显式携带对应 contentId。若尚未读全，先补齐正文和引用；不要原样重试发送，也不要自行生成 contentId。'};
 if(/\bsource_not_admitted\b/.test(text))return {code:'REPLY_SOURCE_NOT_ADMITTED',retryable:true,
  hint:'先用 qq_get_unread_messages 或消息详情把来源的完整正文和引用读入本回合，再用实际读到的 seq 调用 qq_reply_contents。旧回合读过的 seq 不代表本回合已准入；未读完时从返回的连续水位分页补齐，不跳过较早未处理消息。'};
 if(/发送计划拒绝[：:]\s*content_limit\b/.test(text))return {code:'CONTENT_PART_LIMIT',remaining:0,retryable:false,
  hint:'当前这一份完整用户内容的拆分额度已用完，不重试或改写重发这份内容；其他已声明且未完成的内容仍可按各自contentId继续。已发内容核实真实回执，未发内容不可标已回复。'};
 if(!/(?:最多发送\s*0\s*条|本轮发送额度已用完|发送计划拒绝[：:]\s*turn_limit\b)/.test(text))return null;
 return {code:'TURN_SEND_LIMIT',remaining:0,retryable:false,
  hint:'本回复批次的发送额度已用完；不要重试、改写重发或换发送工具。已发送的内容不再补发。只报告确实已处理的消息回执，未回应的消息保留待处理，再等待用户的新消息（qq_wait_for_messages）；返回 endRound=true 时结束本轮。后续来信由桥接重新判定，不把本次上限解释为账户余额不足。'};
}
