// Keep the call/result protocol and append a replayable surface replacement.
// The lossless original event remains available in the native session journal.
const EXCERPT_TAG='【历史工具结果节选 v1】';
export function compactHistoricalToolResults(session,{keepRecent=4,maxChars=1600,currentTurn,currentStep,keepCurrentSteps=2}={}){
 const calls=new Map();
 for(const seq of session.surface.nodes){const e=session.eventAt(seq);for(const b of (e?.data?.message||e?.data)?.content||[])if(b.type==='tool-call')calls.set(b.id,{name:b.name,arguments:b.arguments});}
 const rows=session.surface.nodes.map(seq=>({seq,event:session.eventAt(seq)})).filter(({event})=>event?.type==='tool/result');
 let savedChars=0,count=0;
 for(const {seq,event} of rows.slice(0,Math.max(0,rows.length-keepRecent))){
  if(Number.isSafeInteger(currentTurn)&&event.data.turn>=currentTurn){
   if(event.data.turn!==currentTurn||!Number.isSafeInteger(currentStep)||!Number.isSafeInteger(event.data.step)||event.data.step>=currentStep-keepCurrentSteps)continue;
  }
  const message=event.data.message;if(!message?.content||message.isError||message.content.some(b=>b.type==='text'&&b.text.startsWith(EXCERPT_TAG)))continue;
  if(message.content.some(b=>b.type!=='text'))continue;
  const call=calls.get(message.toolCallId),name=String(call?.name||'').split('__').at(-1);
  let taskRead=false;if(name==='qq_task_note')try{taskRead=['list','get','read'].includes(JSON.parse(call.arguments).action);}catch{}
  if(!taskRead&&!/^(?:qq_get_|qq_list_|qq_wait_for_(?:messages|quiet)$|qq_alias_query$|profile_get$|core_(?:read|topics)$|.*search.*$|.*fetch.*$)/.test(name))continue;
  const original=message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  if(original.length<=maxChars)continue;
  const front=Math.floor(maxChars*.65),back=maxChars-front;
  const text=EXCERPT_TAG+'这是过去步骤的读取快照，不是新来信或当前待答状态；当前收件以最新资料为准。完整原文见会话事件 '+seq+'；省略不代表不存在。\n'+original.slice(0,front)+'\n…\n'+original.slice(-back);
  // Failed and action results remain lossless. Only old read results become
  // excerpts; no success flag or call/result identity is changed.
  session.append('tool/result',{...event.data,message:{...message,content:[{type:'text',text}]}},{surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]});
  savedChars+=original.length-text.length;count++;
 }
 return {count,savedChars};
}
