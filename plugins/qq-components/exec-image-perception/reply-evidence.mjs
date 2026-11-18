const imageIndices=message=>(message?.media||[]).flatMap((m,i)=>['image','sticker'].includes(m?.kind)?[i+1]:[]);
export function createImageReplyEvidence({readHistory,now=Date.now}={}){
 const observed=new Map(),rows=new Map(),ttl=15*60000;
 const identity=(key,id)=>key+'\0'+String(id);
 function rememberRows(key,messages){
  for(const m of messages)if(m?.messageId!=null){rows.set(identity(key,m.messageId),{at:now(),message:m});}
  while(rows.size>512)rows.delete(rows.keys().next().value);
 }
 function canonical(key,id){
  const value=String(id??'');if(rows.has(identity(key,value)))return value;
  const row=[...rows.entries()].findLast(([k,v])=>k.startsWith(key+'\0')&&String(v.message.seq)===value)?.[1];
  return row?String(row.message.messageId):value;
 }
 function evidence({key,messageId}={}){
  const record=observed.get(identity(key,canonical(key,messageId)));
  if(!record||record.expiresAt<=now())return null;
  return {...record,indices:[...record.indices]};
 }
 return {
  observe(payload={}){rememberRows(payload.key,[...(payload.st?.recentMessages||[]),...(payload.st?.unread||[])]);},
  record({key,messageId,images}={}){
   if(messageId==null||String(messageId)==='')return;
   observed.set(identity(key,canonical(key,messageId)),{observedAt:now(),expiresAt:now()+ttl,indices:images.map((image,i)=>Number(image.index)||i+1)});
   for(const [k,v]of observed)if(v.expiresAt<=now())observed.delete(k);
   while(observed.size>256)observed.delete(observed.keys().next().value);
  },
  evidence,
  validateReply({key,replyToMessageId,message}={}){
   if(replyToMessageId==null)return {ok:true};
   let target=message||rows.get(identity(key,replyToMessageId))?.message;
   if(!target&&typeof readHistory==='function')try{
    const history=readHistory({key,limit:100,forLookup:true});
    const [kind,id]=String(key).split(':'),event=history?.ok&&history.messages?.find(e=>String(e.message_id??e.msg_id??e.message_seq)===String(replyToMessageId)&&e.message_type===kind&&(kind==='group'?String(e.group_id)===id:String(e.user_id)===id));
    if(event){target={messageId:String(replyToMessageId),media:(Array.isArray(event.message)?event.message:[]).filter(s=>['image','mface','face'].includes(s?.type)).map(s=>({kind:s.type==='mface'?'sticker':s.type==='face'?'face':'image'}))};rememberRows(key,[target]);}
   }catch{}
   if(!imageIndices(target).length&&target?.quote?.messageId&&/图片|表情/.test(String(target.quote.text||''))){
    const quotedId=String(target.quote.messageId);
    target=rows.get(identity(key,quotedId))?.message||{messageId:quotedId,media:[{kind:'image'}]};
   }
   const indices=imageIndices(target);if(!indices.length)return {ok:true};
   const read=evidence({key,messageId:target.messageId??replyToMessageId});
   return read&&indices.every(index=>read.indices.includes(index))?{ok:true}:{ok:false,reason:'image_reply_requires_analysis',hint:'本条尚未发送：要直接引用的原消息含图片，尚无覆盖这些图片的成功解析结果。先用qq_get_message_images读取同一会话、同一原消息ID='+String(target.messageId??replyToMessageId)+'，结合实际观察再回复；不要把占位符当已看懂，也不要换工具绕过。读取失败时如实说明无法看清，不猜画面。'};
  }
 };
}
