// Snapshot data is always user data. The parent module owns the one shared switch.
export const RECEIPT_INDEX_RULE='【C36 收件状态索引规则】当前收件状态只由 C36 的 receipt-index 提供；索引保留真实 seq 与双戳，不包含聊天正文，也不是新的聊天任务。索引有编号不等于正文已交给模型，不能仅凭索引报告已读或已回复；未列入索引也不表示消息未处理。聊天原文与工具调用、工具返回按原执行时间线保留；历史工具回执是当次结果，不另作一份当前索引。已读不等于已回复，不能用对话序号替换工具所需的原始收件 seq。';
const receiptFields=new Set(['seq','dialogueSeq','dialogueSeqRecovered','messageId','id','time','userId','senderId','sender','isSelf','needsReply','awaitingReply','receiptState','replyStatus','receiptStatus','state','status','read','readAt','seenAt','repliedAt','resolvedAt','resolutionReason','quoteTargetIsSelf']);
const receiptRow=row=>Object.fromEntries(Object.entries(row).filter(([key])=>receiptFields.has(key)));
export function refreshReceiptIndex(row,live){
 if(row.id!=='message-snapshot'||!Array.isArray(live?.receipts))return row;
 try{const snapshot=JSON.parse(row.text),seqs=new Set(snapshotRecords(snapshot).map(record=>record.seq).filter(Number.isSafeInteger));return {...row,text:JSON.stringify({...snapshot,receiptIndex:live.receipts.filter(record=>seqs.has(record.seq)).map(receiptRow),readThroughSeq:live.readThroughSeq,unreadCount:live.unreadCount,receiptIndexRefreshedAt:Date.now()})};}catch{return row;}
}
export function snapshotRecords(snapshot){
 const receipts=new Set(),dialogue=new Set(),ids=new Set();
 return [...(snapshot.recent||[]),...(snapshot.receiptWindow||[]),...(snapshot.messages||[])].filter(row=>row&&typeof row==='object').sort((a,b)=>Number.isSafeInteger(a.dialogueSeq)&&Number.isSafeInteger(b.dialogueSeq)?a.dialogueSeq-b.dialogueSeq:Number.isSafeInteger(a.seq)&&Number.isSafeInteger(b.seq)?a.seq-b.seq:0).filter(row=>{
  if(Number.isSafeInteger(row.seq)&&receipts.has(row.seq)||Number.isSafeInteger(row.dialogueSeq)&&dialogue.has(row.dialogueSeq)||row.messageId&&ids.has(String(row.messageId)))return false;
  if(Number.isSafeInteger(row.seq))receipts.add(row.seq);if(Number.isSafeInteger(row.dialogueSeq))dialogue.add(row.dialogueSeq);if(row.messageId)ids.add(String(row.messageId));return true;
 });
}
export function splitMessageSnapshot(text){
 try{const snapshot=typeof text==='string'?JSON.parse(text):text;if(!snapshot||!Array.isArray(snapshot.messages))return null;
 const {messages:_messages,recent:_recent,receiptWindow:_receipt,receiptIndex:_index,...state}=snapshot;
 const records=snapshotRecords(snapshot),receipts=(Array.isArray(snapshot.receiptIndex)?snapshot.receiptIndex:records).map(receiptRow);
 const backgroundText='【QQ 收件状态】\n'+JSON.stringify({...state,componentId:'message-snapshot',recordType:'receipt-index',receipts});
 return {records,backgroundText,parts:[{id:'receipt-state',name:'收件状态',destination:'background',text:backgroundText},{id:'new-messages',name:'新增聊天原文',destination:'task',text:records.length?'【新增 QQ 消息数据】\n'+JSON.stringify(records):''}]};
 }catch{return null;}
}
export function snapshotModule(row){if(row.id!=='message-snapshot')return row;const split=splitMessageSnapshot(row.text);return {...row,protected:false,...(split?{parts:split.parts,linkedParts:true}:{})};}
