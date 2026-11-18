// Explain recoverable source failures separately from terminal exhaustion.
export function describeSendRejection(message) {
 const text=String(message||'');
 if(/\b(?:delivery_unconfirmed|uncertain_delivery)\b/.test(text))return {code:'DELIVERY_UNCONFIRMED',retryable:false,hint:'本次发送可能已到达QQ，但没有可靠回执。不改写、不换工具、不重发同一份内容，也不把它登记为已回复或发送成功；保留待核对状态，其他独立来信可正常处理。'};
 if(/\btask_group_pending\b/.test(text))return {code:'TASK_GROUP_PENDING',retryable:true,
  hint:'当前任务组尚未接手，本次发送在QQ请求前被拒绝。先用当前原指令的已读seq声明task并取得taskPending=false的contentId；支持sourceSeqs的发送工具可合并完成。额度未准入时等待，不能换工具原样重试或把拒绝说成结果未知。'};
 if(/\bgroup_context_pending\b/.test(text))return {code:'GROUP_CONTEXT_PENDING',retryable:true,
  hint:'先用 qq_get_recent_messages 读取所答消息附近的连续历史（limit=100，必要时 offset 分页），截断的正文通过消息详情补齐。结合话题、说话人和引用再回答；普通历史只作上下文，不要求逐条回复。不要原样重试发送。'};
 if(/\bcontent_required\b/.test(text))return {code:'REPLY_CONTENT_REQUIRED',retryable:true,
  hint:'先用本回合已完整读入的 seq 按完整含义调用 qq_reply_contents 分组，取得 contentId，再在发送工具中显式携带对应 contentId。若尚未读全，先补齐正文和引用；不要原样重试发送，也不要自行生成 contentId。'};
 if(/\bsource_not_admitted\b/.test(text))return {code:'REPLY_SOURCE_NOT_ADMITTED',retryable:true,
  hint:'先用 qq_get_unread_messages 或消息详情把来源的完整正文和引用读入本回合，再用实际读到的 seq 调用 qq_reply_contents。旧回合读过的 seq 不代表本回合已准入；未读完时从返回的连续水位分页补齐，不跳过窗口内明确需要回应的较早消息；普通消息和历史上文可自由选择是否回应。'};
 if(/发送计划拒绝[：:]\s*content_limit\b/.test(text))return {code:'CONTENT_PART_LIMIT',remaining:0,retryable:false,
  hint:'当前这一份完整用户内容的拆分额度已用完，不重试或改写重发这份内容；其他已声明且未完成的内容仍可按各自contentId继续。已发内容核实真实回执，未发内容不可标已回复。'};
 if(!/(?:最多发送\s*0\s*条|本轮发送额度已用完|发送计划拒绝[：:]\s*turn_limit\b)/.test(text))return null;
 return {code:'TURN_SEND_LIMIT',remaining:0,retryable:false,
  hint:'本回复批次的发送额度已用完；不要重试、改写重发或换发送工具。已发送的内容不再补发。只报告确实已处理的消息回执，未回应的消息保留待处理，结束当前发送批次。后续来信由桥接重新判定，不把本次上限解释为账户余额不足。'};
}
