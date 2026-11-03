// Read-only native metadata and sanitized examples of failures explicitly archived.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {zstdDecompressSync} from 'node:zlib';
const attributionUrl=new URL('./source-attribution.mjs',import.meta.url);attributionUrl.search=new URL(import.meta.url).search;
const {annotateRequestSources}=await import(attributionUrl.href);
const deliveryUrl=new URL('./delivery-history.mjs',import.meta.url);deliveryUrl.search=new URL(import.meta.url).search;
const {createDeliveryHistory,enrichDeliveryHistory}=await import(deliveryUrl.href);
const failuresUrl=new URL('./archived-failures.mjs',import.meta.url);failuresUrl.search=new URL(import.meta.url).search;
const {createArchivedFailureHistory}=await import(failuresUrl.href);
const cache=new Map();
const strings=(value,keys)=>Object.fromEntries(keys.filter(key=>typeof value?.[key]==='string').map(key=>[key,value[key]]));
// Follow the original lifecycle, before later surface replacements can move or retire inputs.
function generationTracker(){
 let turn,step,inputStep,inputs=[],reason,stepResults=[],toolInputs=[];
 const identity=(message,event)=>({id:message.id,eventSeq:event.seq,kind:message.source?.baseSource?.kind||message.source?.kind||'user'});
 return event=>{
  const data=event.data||{},message=data.message||data;
  if(event.type==='turn/start'){turn=data.turn;step=undefined;inputStep=undefined;inputs=[];reason=undefined;stepResults=[];toolInputs=[];}
  if(event.type==='turn/end'){turn=undefined;inputs=[];reason=undefined;stepResults=[];toolInputs=[];}
  if(event.type==='step/start'){step=data.step;toolInputs=stepResults;stepResults=[];}
  if(event.type==='user/message'&&(!event.surfaceOp||event.surfaceOp==='append')&&Number.isSafeInteger(turn)){
   const source=message.source?.baseSource||message.source||{};
   if(source.kind==='qq-context-dialogue'){inputs=inputStep===step?[...inputs.filter(row=>row.kind==='qq-context-dialogue'),identity(message,event)]:[identity(message,event)];inputStep=step;reason=source.reason;}
   else if(source.kind==='qq-context-task'){
    if(reason!==source.reason||!inputs.length)inputs=[identity(message,event)];
    reason=source.reason;
   }else if(source.kind==='user'){inputs=[identity(message,event)];reason=undefined;}
  }
  if(event.type==='tool/result'){
   const raw=(message.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
   let result;try{result=JSON.parse(raw);}catch{}
   // Export only a known control code; never tool text, arguments, credentials or reasoning.
   const code=(message.isError||result?.ok===false||result?.isError)&&raw.match(/\b(message_context_pending|source_not_admitted|content_required|TURN_SEND_LIMIT)\b/)?.[1];
   stepResults.push({...identity(message,event),...(code?{code}:{})});
  }
  if(event.type==='assistant/message'&&Number.isSafeInteger(data.turn))return {turn:data.turn,step:data.step,...(reason?{reason}:{}),inputs:inputs.map(row=>({...row})),toolInputs:toolInputs.map(row=>({...row}))};
 };
}
function sourceMetadata(source={}){
 if(!source||typeof source!=='object')return {};
 const out=strings(source,['kind','pluginId','componentId','reason','compactionId','sourceCommandId','toolName','code','form']);
 if(source.kind==='skill-invocation'&&typeof source.name==='string')out.name=source.name;
 if(Number.isSafeInteger(source.count))out.count=source.count;
 if(Array.isArray(source.changes))out.changes=source.changes.filter(row=>typeof row?.path==='string').map(row=>strings(row,['path','scope','action','digest']));
 if(Array.isArray(source.sections))out.sections=source.sections.filter(row=>typeof row?.name==='string').map(row=>({name:row.name}));
 if(Array.isArray(source.entries))out.entries=source.entries.filter(row=>typeof row?.name==='string').map(row=>({name:row.name}));
 return out;
}
export function readMessageProvenance(root,sessionId){
 const empty=new Map();if(!/^session-[a-f0-9-]{36}$/i.test(sessionId||''))return empty;
 try{
  let home=path.join(os.homedir(),'.dsh');try{home=JSON.parse(fs.readFileSync(path.join(root,'workspace.local.json'),'utf8')).dshHome||home;}catch{}
  const base=path.join(home,'sessions'),folder=fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()).find(e=>fs.existsSync(path.join(base,e.name,sessionId,'session.v4.jsonl.zstd')));
  if(!folder)return empty;const file=path.join(base,folder.name,sessionId,'session.v4.jsonl.zstd'),stat=fs.statSync(file);if(stat.size>32*1024*1024)return empty;
  const old=cache.get(file);if(old?.size===stat.size&&old.mtime===stat.mtimeMs)return old.messages;
  const bytes=fs.readFileSync(file),messages=new Map(),compactions=new Map(),compactionAliases=[],generationFor=generationTracker(),deliveries=createDeliveryHistory(),failures=createArchivedFailureHistory();let offset=0,agentPreset,toolOperationIndex=0;
  for(let frame=0;offset<bytes.length&&frame<100000;frame++){
   const {buffer,engine}=zstdDecompressSync(bytes.subarray(offset),{info:true,maxOutputLength:8*1024*1024});if(!engine.bytesWritten)return empty;offset+=engine.bytesWritten;
   for(const line of buffer.toString('utf8').split('\n')){
    if(!line.trim())continue;const event=JSON.parse(line),data=event.data||{},generation=generationFor(event);
    deliveries.observe(event);
    failures.observe(event);
    const eventMessage=data.message||data,calls=event.type==='assistant/message'?(eventMessage.content||[]).filter(block=>block.type==='tool-call'):[];
    if(event.type==='assistant/message'&&(!event.surfaceOp||event.surfaceOp==='append'))toolOperationIndex+=Math.max(1,calls.length);
    if(event.type==='user/message'&&(!event.surfaceOp||event.surfaceOp==='append')&&['user','qq-context-dialogue'].includes(eventMessage.source?.kind))toolOperationIndex++;
    if(event.type==='session'&&typeof event.agentPreset==='string')agentPreset=event.agentPreset;
    if(event.type==='agent-preset/selected'&&typeof data.agentPreset==='string')agentPreset=data.agentPreset;
    if(['compaction/start','compaction/summary','compaction/end'].includes(event.type)&&typeof data.compactionId==='string'){
     const info=compactions.get(data.compactionId)||{id:data.compactionId};
     if(event.type==='compaction/start')Object.assign(info,{startSeq:event.seq,...(typeof data.sourceCommandId==='string'?{sourceCommandId:data.sourceCommandId,mode:'manual'}:Number.isSafeInteger(data.turn)?{mode:'automatic'}:data.turn===null?{mode:'standalone'}:{})});
     if(event.type==='compaction/summary')Object.assign(info,{summarySeq:event.seq,...strings(data,['provider','model','sourceCommandId']),...(Number.isSafeInteger(data.shadowedRange?.start)&&Number.isSafeInteger(data.shadowedRange?.end)?{shadowedRange:{start:data.shadowedRange.start,end:data.shadowedRange.end}}:{}),...(Array.isArray(data.shadowedSeqs)?{shadowedSeqs:data.shadowedSeqs.filter(Number.isSafeInteger)}:{})});
     if(event.type==='compaction/end')info.endSeq=event.seq;
     compactions.set(data.compactionId,info);
    }
    const candidates=event.type==='agent/inbox/spliced'?data.inserted||[]:/^(?:(?:system|user|developer|assistant|tool)\/message|tool\/result)$/.test(event.type)?[data.message||data]:[];
    for(const message of candidates){
     const compactionId=message.source?.compactionId||message.source?.baseSource?.compactionId;
     if(typeof compactionId==='string')compactionAliases.push({eventSeq:event.seq,compactionId});
     if(typeof message.id!=='string'||messages.has(message.id))continue;
     const toolChanges=(message.content||[]).filter(b=>['tool-addition','tool-removal'].includes(b.type)).map(b=>({type:b.type,toolName:b.toolName}));
     const source=sourceMetadata(message.source);
     const toolResults=typeof message.toolCallId==='string'&&message.role==='tool'?[{toolCallId:message.toolCallId}]:(message.content||[]).filter(block=>block.type==='tool-result'&&typeof block.toolCallId==='string').map(block=>({toolCallId:block.toolCallId}));
     messages.set(message.id,{eventSeq:event.seq,eventType:event.type,recordedAt:event.time||event.timestamp||event.ts,source,...(calls.length===1?{toolOperationIndex}:{}),...(generation?{generation}:{}),...(agentPreset?{agentPreset}:{}),...(Number.isSafeInteger(data.headerSeq)?{headerSeq:data.headerSeq}:{}),...(toolChanges.length?{toolChanges}:{}),...(toolResults.length?{toolResults}:{})});
    }
   }
  }
  if(offset!==bytes.length)return empty;
  for(const evidence of messages.values())if(evidence.source.compactionId&&compactions.has(evidence.source.compactionId))evidence.compaction={...compactions.get(evidence.source.compactionId)};
  messages.deliveries=deliveries.finish();
  messages.archivedFailures=failures.finish();
  messages.compactionAliases=compactionAliases.flatMap(row=>compactions.has(row.compactionId)?[{eventSeq:row.eventSeq,compaction:compactions.get(row.compactionId)}]:[]);
  cache.set(file,{size:stat.size,mtime:stat.mtimeMs,messages});if(cache.size>16)cache.delete(cache.keys().next().value);return messages;
 }catch{return empty;}
}
export function enrichRequestProvenance(root,request){
 if(!request)return request;const original=readMessageProvenance(root,request.sessionId);
 const enrich=row=>row?annotateRequestSources(root,enrichDeliveryHistory({...row,messages:(row.messages||[]).map(message=>{const evidence=original.get(message.id),archivedFailure=original.archivedFailures?.get(message.id),archivedToolPairs=original.archivedFailures?.pairs?.get(message.id);return evidence?{...message,provenance:evidence,...(archivedFailure?{archivedFailure}:{}),...(archivedToolPairs?{archivedToolPairs}:{}),contentBlocks:message.contentBlocks||evidence.toolChanges,...(!message.toolResults?.length&&evidence.toolResults?{toolResults:evidence.toolResults}:{})}:message;})},original.deliveries,[...original.values(),...(original.compactionAliases||[])])):row;
 return {...enrich(request),requestStages:request.requestStages?.map(stage=>({...stage,request:enrich(stage.request)})),recentRequests:request.recentRequests?.map(enrich)};
}
