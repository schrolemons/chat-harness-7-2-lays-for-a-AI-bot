// Mechanical read-only metadata projection. No prompts, acknowledgements or admission.
import {pendingMessagesV2} from './receipt-state.js';
const fields=new Set(['seq','dialogueSeq','dialogueSeqRecovered','messageId','id','time','userId','senderId','sender','isSelf','needsReply','replyRequirement','replyDisposition','replyDispositionReason','replyDispositionAt','awaitingReply','receiptState','replyStatus','receiptStatus','state','status','read','readAt','seenAt','repliedAt','quoteTargetIsSelf']);
export function receiptStateView(state){
 const bySeq=new Map();for(const row of [...(state.recentMessages||[]),...(state.unread||[])])if(Number.isSafeInteger(row?.seq)&&row.seq>0)bySeq.set(row.seq,Object.fromEntries(Object.entries(row).filter(([key])=>fields.has(key))));
 const pendingSeqs=pendingMessagesV2(state).map(row=>row.seq);
 return {receipts:[...bySeq.values()].map(row=>({...row,needsReply:pendingSeqs.includes(row.seq)})),readThroughSeq:Number(state.lastReadThroughSeq)||0,unreadCount:pendingSeqs.length,bufferedUnreadCount:(state.unread||[]).length,pendingSeqs,pendingFromSeq:pendingSeqs[0]??null,queueObservedThroughSeq:Number(state.lastUnreadSeq)||0};
}
