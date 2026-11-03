// Only authenticated QQ reader results become dialogue data. Native tool nodes
// remain untouched, including their original call/result relationship.
const readers=new Set(['qq_get_recent_messages','qq_get_unread_messages','qq_get_my_recent_messages','qq_get_message_detail']);
const short=name=>String(name||'').split('__').at(-1);
const valid=n=>Number.isSafeInteger(n)&&n>0;
const fields=new Set(['seq','dialogueSeq','dialogueSeqRecovered','messageId','sender','userId','text','plain','ownPlain','time','at','ago','isSelf','media','quoteTargetIsSelf','bodyComplete','seenAt','repliedAt','resolvedAt','receiptState','needsReply','replyRequirement','replyDisposition','omittedReplyIds']);
function payload(value,depth=0){
  if(depth>3)return null;
  if(typeof value==='string'){try{return payload(JSON.parse(value),depth+1);}catch{return null;}}
  if(!value||value.isError||value.ok===false||value.error)return null;
  if(Array.isArray(value.content))return payload(value.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'),depth+1);
  return value;
}
export function historyBackfillRows({session,messages=[],key,seen=new Set(),seenDialogue=new Set()}={}){
  const surface=[...session.surface.nodes].map(seq=>{const e=session.eventAt(seq);return e?.data?.message||e?.data;}).filter(Boolean);
  const all=[...surface,...messages],calls=new Map(),rows=[];
  for(const m of all)for(const c of m.content||[])if(c.type==='tool-call'&&readers.has(short(c.name))&&(String(c.name).includes('__snowluma__')||String(c.name).startsWith('qq_')))calls.set(c.id,short(c.name));
  for(const m of all){
    const name=calls.get(m.toolCallId);if(!name||m.isError)continue;
    const data=payload((m.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n'));if(!data||data.key!==key)continue;
    const candidates=name==='qq_get_message_detail'?[data.info||data.message]:Array.isArray(data.messages)?data.messages:[];
    for(const row of candidates.slice(0,100)){
      const text=row?.text??row?.plain;
      if(!row||!valid(row.seq)&&!valid(row.dialogueSeq)||typeof text!=='string'||!text.trim()||row.bodyComplete===false||row.truncated||row.textTruncated||row.unresolvedReplyIds?.length||row.bodyComplete!==true&&text.length===200)continue;
      if(valid(row.seq)&&seen.has(row.seq)||valid(row.dialogueSeq)&&seenDialogue.has(row.dialogueSeq))continue;
      if(valid(row.seq))seen.add(row.seq);if(valid(row.dialogueSeq))seenDialogue.add(row.dialogueSeq);
      rows.push(Object.fromEntries(Object.entries(row).filter(([field])=>fields.has(field))));
    }
  }
  return rows;
}
