// Keep the call/result protocol and append a replayable surface replacement.
// The lossless original event remains available in the native session journal.
const EXCERPT_TAG='【历史工具结果节选 v1】';
export function compactHistoricalToolResults(session,{keepRecent=4,maxChars=1600}={}){
 const calls=new Map();
 for(const seq of session.surface.nodes){const e=session.eventAt(seq);for(const b of (e?.data?.message||e?.data)?.content||[])if(b.type==='tool-call')calls.set(b.id,b.name);}
 const rows=session.surface.nodes.map(seq=>({seq,event:session.eventAt(seq)})).filter(({event})=>event?.type==='tool/result');
 let savedChars=0,count=0;
 for(const {seq,event} of rows.slice(0,Math.max(0,rows.length-keepRecent))){
  const message=event.data.message;if(!message?.content||message.isError||message.content.some(b=>b.type==='text'&&b.text.startsWith(EXCERPT_TAG)))continue;
  const name=String(calls.get(message.toolCallId)||'').split('__').at(-1);
  if(!/^(?:qq_get_|qq_list_|qq_alias_query$|profile_get$|core_(?:read|topics)$|.*search.*$|.*fetch.*$)/.test(name))continue;
  const original=message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  if(original.length<=maxChars)continue;
  const front=Math.floor(maxChars*.65),back=maxChars-front;
  const text=EXCERPT_TAG+'完整原文见会话事件 '+seq+'；省略不代表不存在。\n'+original.slice(0,front)+'\n…\n'+original.slice(-back);
  // Failed and action results remain lossless. Only old read results become
  // excerpts; no success flag or call/result identity is changed.
  session.append('tool/result',{...event.data,message:{...message,content:[{type:'text',text}]}},{surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]});
  savedChars+=original.length-text.length;count++;
 }
 return {count,savedChars};
}
