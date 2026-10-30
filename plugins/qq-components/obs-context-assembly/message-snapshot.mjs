// Snapshot data is always user data. The parent module owns the one shared switch.
export function snapshotRecords(snapshot){const seen=new Set();return [...(snapshot.recent||[]),...(snapshot.receiptWindow||[]),...(snapshot.messages||[])].filter(row=>row&&typeof row==='object').sort((a,b)=>(a.seq||0)-(b.seq||0)).filter(row=>{if(!Number.isSafeInteger(row.seq))return true;if(seen.has(row.seq))return false;seen.add(row.seq);return true;});}
export function splitMessageSnapshot(text){
 try{const snapshot=typeof text==='string'?JSON.parse(text):text;if(!snapshot||!Array.isArray(snapshot.messages))return null;
 const {messages:_messages,recent:_recent,receiptWindow:_receipt,...state}=snapshot;
 const records=snapshotRecords(snapshot),receipts=records.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>['seq','messageId','id','time','userId','senderId','sender','isSelf','needsReply','replyStatus','receiptStatus','read','readAt','repliedAt','quoteTargetIsSelf'].includes(key))));
 const backgroundText='【QQ 收件状态】\n'+JSON.stringify({...state,receipts});
 return {records,backgroundText,parts:[{id:'receipt-state',name:'收件状态',destination:'background',text:backgroundText},{id:'new-messages',name:'新增聊天原文',destination:'task',text:records.length?'【新增 QQ 消息数据】\n'+JSON.stringify(records):''}]};
 }catch{return null;}
}
export function snapshotModule(row){if(row.id!=='message-snapshot')return row;const split=splitMessageSnapshot(row.text);return {...row,protected:false,...(split?{parts:split.parts,linkedParts:true}:{})};}
