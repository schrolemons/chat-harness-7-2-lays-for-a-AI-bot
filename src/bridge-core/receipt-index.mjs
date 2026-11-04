// Mechanical read-only metadata projection. No prompts, acknowledgements or admission.
import {pendingMessagesV2, receiptStateV2} from './receipt-state.js';
const fields=new Set(['seq','dialogueSeq','dialogueSeqRecovered','messageId','id','time','userId','senderId','sender','isSelf','needsReply','replyRequirement','replyDisposition','replyDispositionReason','replyDispositionAt','awaitingReply','receiptState','replyStatus','receiptStatus','state','status','read','readAt','seenAt','repliedAt','quoteTargetIsSelf']);
export function receiptStateView(state){
 const bySeq=new Map();for(const row of [...(state.recentMessages||[]),...(state.unread||[])])if(Number.isSafeInteger(row?.seq)&&row.seq>0)bySeq.set(row.seq,Object.fromEntries(Object.entries(row).filter(([key])=>fields.has(key))));
 const pendingSeqs=pendingMessagesV2(state).map(row=>row.seq);
 return {receipts:[...bySeq.values()].map(row=>({...row,needsReply:pendingSeqs.includes(row.seq)})),readThroughSeq:Number(state.lastReadThroughSeq)||0,unreadCount:pendingSeqs.length,bufferedUnreadCount:(state.unread||[]).length,pendingSeqs,pendingFromSeq:pendingSeqs[0]??null,queueObservedThroughSeq:Number(state.lastUnreadSeq)||0};
}

const receiptActivityPrefix = /^(\[[^\]\r\n]+\] ((?:private|group):\d+) \[reserved2\] )消息已接收 \[receipt=(\d+),(\d+)\]：/;
const legacyActivityPrefix = /^(\[[^\]\r\n]+\] (?:private|group):\d+ \[reserved2\] )消息已入未读：/;
const activityStates = {
  unseen: '未读',
  seen: '已读未回复',
  complete: '已读已回复',
  resolved: '已归档',
  anomaly: '回执异常',
};

export function projectReceiptActivity(line, conversations) {
  const match = line.match(receiptActivityPrefix);
  if (!match) return line.replace(legacyActivityPrefix, '$1消息已接收 · 状态未记录：');
  const [prefix, header, key, seq, time] = match;
  const state = conversations.get(key);
  const sameReceipt = row => row.seq === Number(seq) && row.time === Number(time) && !row.isSelf;
  const receipt = state?.unread?.find(sameReceipt) || state?.recentMessages?.find(sameReceipt);
  let status = '状态未记录';
  if (receipt) {
    const stamped = receiptStateV2(receipt);
    status = receipt.replyDisposition === 'history' && ['seen', 'unseen'].includes(stamped)
      ? '历史上文'
      : activityStates[stamped];
  }
  return header + '消息已接收 · ' + status + '：' + line.slice(prefix.length);
}
