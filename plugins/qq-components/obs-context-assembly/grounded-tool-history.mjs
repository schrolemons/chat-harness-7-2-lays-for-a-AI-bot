import {qqDialogueBlocks} from '../../../console/layers/O/context-qq-blocks.js';

const readers=new Set(['qq_get_recent_messages','qq_get_unread_messages','qq_get_my_recent_messages','qq_get_message_detail','qq_wait_for_messages','qq_wait_for_quiet']);
const redundant=new Set(['text','plain','ownPlain','sender','userId','time','at','ago','media','forwardIds','quoteTargetIsSelf','bodyComplete']);
const short=name=>String(name||'').split('__').at(-1);
const own=(message,key)=>message?.source?.key===key&&(message.source.kind==='qq-context-dialogue'||message.source.kind==='qq-context-stable'&&message.source.baseSource?.kind==='qq-context-dialogue');

// Replace duplicate facts with references only after their exact full bodies
// have been projected into this same request's authenticated QQ dialogue.
export function compactMessageReadResult(data,rows){
 if(!data||Array.isArray(data)||data.ok===false||data.error)return null;
 let changed=false;
 const project=row=>{
  if(!row||typeof row!=='object'||row.truncated||row.textTruncated||row.bodyComplete===false)return row;
  const text=row.text??row.plain??row.ownPlain;
  if(typeof text!=='string'||!text||row.unresolvedReplyIds?.length)return row;
  const known=rows.find(other=>typeof other.text==='string'&&other.text===text
   &&!other.truncated&&other.bodyComplete!==false&&!other.unresolvedReplyIds?.length
   &&(row.messageId!=null?String(other.messageId)===String(row.messageId):Number.isSafeInteger(row.seq)&&other.seq===row.seq)
   &&(row.userId==null||other.userId==null||String(row.userId)===String(other.userId)));
  if(!known)return row;
  const next=Object.fromEntries(Object.entries(row).filter(([field,value])=>!redundant.has(field)||JSON.stringify(value)!==JSON.stringify(known[field])));
  // A text field using plain rather than text must still match by that field.
  if(JSON.stringify(next).length>=JSON.stringify(row).length)return row;
  changed=true;return next;
 };
 const result={...data};
 for(const field of ['messages','newMessages'])if(Array.isArray(data[field]))result[field]=data[field].map(project);
 for(const field of ['info','message'])if(data[field]&&typeof data[field]==='object'&&!Array.isArray(data[field]))result[field]=project(data[field]);
 return changed?{...result,messageBodies:'完整正文已保留在本次QQ聊天原文中，按messageId或seq对应；原始工具事件仍完整保存。'}:null;
}

export function compactGroundedMessageResults(session,{key,messages=[]}={}){
 const entries=[...session.surface.nodes].map(seq=>({seq,event:session.eventAt(seq)}));
 const all=[...entries.map(({event})=>event?.data?.message||event?.data).filter(Boolean),...messages];
 const rows=all.filter(m=>own(m,key)).flatMap(m=>(m.content||[]).flatMap(block=>block.type==='text'?qqDialogueBlocks(block.text).flatMap(part=>part.rows):[]));
 if(!rows.length)return {count:0,savedChars:0};
 const calls=new Map();for(const message of all)for(const block of message.content||[])if(block.type==='tool-call'&&readers.has(short(block.name))&&(String(block.name).includes('__snowluma__')||String(block.name).startsWith('qq_')))calls.set(block.id,block);
 let count=0,savedChars=0;
 for(const {seq,event}of entries){
  if(event?.type!=='tool/result')continue;
  const message=event.data.message;
  if(message?.isError||!calls.has(message?.toolCallId)||message.content?.length!==1||message.content[0].type!=='text')continue;
  const original=message.content[0].text;let data;try{data=JSON.parse(original);}catch{continue;}
  if(data.key!==key)continue;
  const projected=compactMessageReadResult(data,rows);if(!projected)continue;
  const text=JSON.stringify(projected);if(original.length-text.length<256)continue;
  session.append('tool/result',{...event.data,message:{...message,content:[{...message.content[0],text}]}},{surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]});
  count++;savedChars+=original.length-text.length;
 }
 return {count,savedChars};
}
