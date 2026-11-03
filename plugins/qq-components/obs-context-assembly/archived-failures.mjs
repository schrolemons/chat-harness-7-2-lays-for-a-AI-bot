// Read-only recovery from exact surface replacements, not adjacent/newer calls.
import {failureCode} from './failure-runs.mjs';
import {safeFailureText} from './failure-preview.mjs';
export function createArchivedFailureHistory(){
 const originals=new Map(),examples=new Map(),pairs=new Map(),inherited=new Map();let batch,operationIndex=0;
 const flush=()=>{
  if(!batch)return;
  for(const archive of batch.archives){
   let selected;const restored=[...(inherited.get(archive.name+'|'+archive.code)||[])];
   for(const [id,call]of batch.calls){
    const results=batch.results.get(id)||[];if(results.length!==1)continue;
    const result=results[0],tool=call.message.content.find(block=>block.type==='tool-call'),group={name:tool.name,code:failureCode(result.message)};
    if(group.name!==archive.name||group.code!==archive.code)continue;
    selected={archiveId:archive.id,name:group.name,code:group.code,callId:id,callEventSeq:call.seq,resultEventSeq:result.seq,operationIndex:call.operationIndex,argumentsText:tool.arguments===undefined?null:safeFailureText(tool.arguments),errorText:safeFailureText(result.message.content.map(block=>block.text).join('\n'))};
    restored.push({...selected,callMessageId:call.message.id,resultMessageId:result.message.id});
   }
   if(selected&&!examples.has(archive.id))examples.set(archive.id,Object.freeze(selected));
   if(restored.length&&!pairs.has(archive.id))pairs.set(archive.id,[...new Map(restored.map(pair=>[pair.callId,pair])).values()].sort((a,b)=>a.callEventSeq-b.callEventSeq));
   inherited.delete(archive.name+'|'+archive.code);
  }
  batch=undefined;
 };
 return {
  observe(event){
   const message=event.data?.message||event.data||{},source=message.source||{},op=event.surfaceOp;
   const folded=op?.op==='replace'&&Number.isSafeInteger(op.startSeq)&&op.startSeq===op.endSeq&&source.reason==='repeated-tool-failure'&&['qq-context-tool-history','qq-context-retired'].includes(source.kind);
   if(!folded)flush();
   if(op?.op==='replace'&&source.reason==='merged-tool-errors'){
    const old=originals.get(op.startSeq)?.message,sourceKey=old?.source?.toolName+'|'+old?.source?.code;
    if(old?.source?.kind==='qq-context-tool-history')inherited.set(sourceKey,[...(inherited.get(sourceKey)||[]),...(pairs.get(old.id)||[])]);
   }
   if(folded){
    batch||={archives:[],calls:new Map(),results:new Map()};
    if(source.kind==='qq-context-tool-history'&&typeof message.id==='string')batch.archives.push({id:message.id,name:source.toolName,code:source.code});
    const original=originals.get(op.startSeq),old=original?.message;
    if(old?.role==='assistant'){
     const calls=old.content.filter(block=>block.type==='tool-call');if(calls.length===1)batch.calls.set(calls[0].id,original);
    }else if(old?.role==='tool'&&old.toolCallId){
     const results=batch.results.get(old.toolCallId)||[];results.push(original);batch.results.set(old.toolCallId,results);
    }
   }
   if(!Number.isSafeInteger(event.seq))return;
   if(event.type==='user/message'&&(!op||op==='append')&&['user','qq-context-dialogue'].includes(source.kind))operationIndex++;
   // Keep tool blocks only. Assistant prose and hidden reasoning are not evidence.
   if(event.type==='assistant/message'&&message.role==='assistant'){
    const calls=(message.content||[]).filter(block=>block.type==='tool-call');
    if(!op||op==='append')operationIndex+=Math.max(1,calls.length);
    if(calls.length===1)originals.set(event.seq,{seq:event.seq,operationIndex,message:{id:message.id,role:'assistant',content:calls}});
   }else if(event.type==='tool/result'&&message.role==='tool'&&typeof message.toolCallId==='string'){
    originals.set(event.seq,{seq:event.seq,message:{id:message.id,role:'tool',toolCallId:message.toolCallId,isError:message.isError,content:message.content||[]}});
   }else if(source.kind==='qq-context-tool-history'){
    originals.set(event.seq,{seq:event.seq,message:{id:message.id,source}});
   }
  },
  finish(){flush();examples.pairs=pairs;return examples;}
 };
}
