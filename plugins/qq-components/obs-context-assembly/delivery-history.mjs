// Recover display identities from durable QQ snapshots and confirmed native sends.
// Historical rows are separate from request.messages; no live state or invented numbering.
import {extractToolDeliveries,TEXT_SEND_TOOLS} from '../../../console/layers/O/context-deliveries.js';
import {qqDialogueBlocks} from '../../../console/layers/O/context-qq-blocks.js';
import {redact} from './packet.mjs';
const short=name=>String(name||'').split('__').at(-1);
const valid=value=>Number.isSafeInteger(value)&&value>0;
const minute=time=>new Date(time).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
export function createDeliveryHistory(){
 const calls=new Map(),sent=[],identities=new Map();
 return {
  observe(event){
   const message=event.data?.message||event.data;if(!message)return;
   if(event.type==='assistant/message')for(const call of message.content||[]){
    if(call.type!=='tool-call'||!TEXT_SEND_TOOLS.has(short(call.name)))continue;
    calls.set(call.id,{position:event.seq,role:'assistant',toolCalls:[{id:call.id,name:call.name}],text:JSON.stringify(call)});
   }
   if(event.type==='tool/result'&&calls.has(message.toolCallId)){
    const origin=calls.get(message.toolCallId),returned={position:event.seq,role:'tool',isError:message.isError,toolResults:[{toolCallId:message.toolCallId}],text:(message.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n')};
    for(const row of extractToolDeliveries({},[origin,returned]))sent.push({...row,text:redact(row.text),resultId:message.id,callEventSeq:origin.position,resultEventSeq:event.seq,sentAt:Number(event.time||event.timestamp||event.ts)});
   }
   const source=message.source?.baseSource||message.source;
   if(event.type==='user/message'&&source?.kind==='qq-context-dialogue')for(const block of message.content||[]){
    if(block.type!=='text')continue;
    for(const row of qqDialogueBlocks(block.text).flatMap(part=>part.rows))if(row.isSelf===true&&valid(row.dialogueSeq))identities.set(source.key+':'+row.dialogueSeq,{key:source.key,dialogueSeq:row.dialogueSeq,text:row.plain||row.text,messageId:row.messageId||row.message_id,time:row.time,at:row.at});
   }
  },
  finish(){
   return sent.map(delivery=>{
    const possible=[...identities.values()].filter(row=>row.key===delivery.targetKey&&row.text===delivery.text&&(delivery.messageId&&row.messageId?String(delivery.messageId)===String(row.messageId):Number.isFinite(Number(row.time))?Math.abs(Number(row.time)-delivery.sentAt)<=2000:row.at===minute(delivery.sentAt)));
    const equivalent=sent.filter(row=>row.targetKey===delivery.targetKey&&row.text===delivery.text&&minute(row.sentAt)===minute(delivery.sentAt));
    const match=possible.length===1&&(possible[0].messageId||Number.isFinite(Number(possible[0].time))||equivalent.length===1)?possible[0]:null;
    return {...delivery,...(match?{dialogueSeq:match.dialogueSeq}:{})};
   });
  }
 };
}
export function enrichDeliveryHistory(request,history=[],evidence=[]){
 const messages=request.messages.map(message=>{
  const deliveryRecords=history.filter(row=>row.resultId===message.id&&valid(row.dialogueSeq)).map(row=>({callId:row.callId,index:Number(row.key.split(':').at(-1)),dialogueSeq:row.dialogueSeq}));
  return deliveryRecords.length?{...message,deliveryRecords}:message;
 });
 const archivedDeliveries=[],added=new Set();
 const summaries=new Map(evidence.filter(row=>row.compaction).map(row=>[row.eventSeq,row.compaction]));
 const covered=compact=>{
  const seqs=new Set(compact.shadowedSeqs||[]),queue=[...seqs],visited=new Set();
  while(queue.length){const seq=queue.pop();if(visited.has(seq))continue;visited.add(seq);for(const child of summaries.get(seq)?.shadowedSeqs||[])if(!seqs.has(child)){seqs.add(child);queue.push(child);}}
  return seqs;
 };
 for(const summary of messages){
  const compact=summary.provenance?.compaction;if(!compact)continue;
  const seqs=covered(compact),range=compact.shadowedRange;
  const contains=seq=>seqs.size?seqs.has(seq):range&&range.start<=seq&&seq>=range.start&&seq<=range.end;
  for(const row of history){
   if(!valid(row.dialogueSeq)||row.targetKey!==request.key||!contains(row.callEventSeq)||!contains(row.resultEventSeq)||added.has(row.key))continue;
   added.add(row.key);archivedDeliveries.push({...row,key:'archived:'+row.callId+':'+row.key.split(':').at(-1),name:'bot QQ 消息（摘要历史）',archived:true,summaryId:summary.id,source:'摘要对应的原始发送记录',effectiveComponents:[],withdrawnComponents:[]});
  }
 }
 return {...request,messages,archivedDeliveries};
}
