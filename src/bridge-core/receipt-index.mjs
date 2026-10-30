// Mechanical read-only metadata projection. No prompts, acknowledgements or admission.
const fields=new Set(['seq','dialogueSeq','dialogueSeqRecovered','messageId','id','time','userId','senderId','sender','isSelf','needsReply','awaitingReply','receiptState','replyStatus','receiptStatus','state','status','read','readAt','seenAt','repliedAt','quoteTargetIsSelf']);
export function receiptStateView(state){
 const bySeq=new Map();for(const row of [...(state.recentMessages||[]),...(state.unread||[])])if(Number.isSafeInteger(row?.seq)&&row.seq>0)bySeq.set(row.seq,Object.fromEntries(Object.entries(row).filter(([key])=>fields.has(key))));
 return {receipts:[...bySeq.values()],readThroughSeq:Number(state.lastReadThroughSeq)||0,unreadCount:(state.unread||[]).length};
}
