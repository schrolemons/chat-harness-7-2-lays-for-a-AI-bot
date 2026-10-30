// A display/transport identity shared by both QQ directions. Receipt seq is never changed.
const valid=value=>Number.isSafeInteger(value)&&value>0;
export function ensureDialogueSequences(st,{recovered=false}={}){
 if(!st||typeof st!=='object')return;
 const groups=new Map();let index=0;
 for(const row of [...(st.recentMessages||[]),...(st.unread||[])]){
  if(!row||typeof row!=='object')continue;
  const key=valid(row.seq)?'receipt:'+!!row.isSelf+':'+row.seq:row.messageId!=null?'id:'+row.messageId:row;
  if(!groups.has(key))groups.set(key,{rows:[],index:index++,time:Number(row.time??row.at)||0});groups.get(key).rows.push(row);
 }
 let last=valid(st.lastDialogueSeq)?st.lastDialogueSeq:0;
 for(const group of groups.values())for(const row of group.rows)if(valid(row.dialogueSeq))last=Math.max(last,row.dialogueSeq);
 const used=new Set();
 for(const group of [...groups.values()].sort((a,b)=>a.time-b.time||a.index-b.index)){
  let seq=group.rows.find(row=>valid(row.dialogueSeq))?.dialogueSeq;
  const repair=seq&&used.has(seq);
  if(!seq||repair){if(last>=Number.MAX_SAFE_INTEGER)throw Error('对话序号已超出安全整数范围');seq=++last;}
  used.add(seq);
  for(const row of group.rows){row.dialogueSeq=seq;if(recovered||repair)row.dialogueSeqRecovered=true;}
 }
 st.lastDialogueSeq=last;
}
