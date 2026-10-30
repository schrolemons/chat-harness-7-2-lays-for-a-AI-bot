// Read-only metadata from the native session log. No prompts, arguments or secrets leave this reader.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {zstdDecompressSync} from 'node:zlib';
const cache=new Map();
export function readMessageProvenance(root,sessionId){
 const empty=new Map();if(!/^session-[a-f0-9-]{36}$/i.test(sessionId||''))return empty;
 try{
  let home=path.join(os.homedir(),'.dsh');try{home=JSON.parse(fs.readFileSync(path.join(root,'workspace.local.json'),'utf8')).dshHome||home;}catch{}
  const base=path.join(home,'sessions'),folder=fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()).find(e=>fs.existsSync(path.join(base,e.name,sessionId,'session.v4.jsonl.zstd')));
  if(!folder)return empty;const file=path.join(base,folder.name,sessionId,'session.v4.jsonl.zstd'),stat=fs.statSync(file);if(stat.size>32*1024*1024)return empty;
  const old=cache.get(file);if(old?.size===stat.size&&old.mtime===stat.mtimeMs)return old.messages;
  const bytes=fs.readFileSync(file),messages=new Map();let offset=0;
  for(let frame=0;offset<bytes.length&&frame<100000;frame++){
   const {buffer,engine}=zstdDecompressSync(bytes.subarray(offset),{info:true,maxOutputLength:8*1024*1024});if(!engine.bytesWritten)return empty;offset+=engine.bytesWritten;
   for(const line of buffer.toString('utf8').split('\n')){
    if(!line.trim())continue;const event=JSON.parse(line),data=event.data||{};
    const candidates=event.type==='agent/inbox/spliced'?data.inserted||[]:/^(?:(?:user|developer|assistant|tool)\/message|tool\/result)$/.test(event.type)?[data.message||data]:[];
    for(const message of candidates){
     if(typeof message.id!=='string'||messages.has(message.id))continue;
     const toolChanges=(message.content||[]).filter(b=>['tool-addition','tool-removal'].includes(b.type)).map(b=>({type:b.type,toolName:b.toolName}));
     const source=message.source||{};
     const toolResults=typeof message.toolCallId==='string'&&message.role==='tool'?[{toolCallId:message.toolCallId}]:(message.content||[]).filter(block=>block.type==='tool-result'&&typeof block.toolCallId==='string').map(block=>({toolCallId:block.toolCallId}));
     messages.set(message.id,{eventSeq:event.seq,eventType:event.type,recordedAt:event.time||event.timestamp||event.ts,source:Object.fromEntries(['kind','pluginId','componentId','reason'].filter(k=>typeof source[k]==='string').map(k=>[k,source[k]])),...(Number.isSafeInteger(data.headerSeq)?{headerSeq:data.headerSeq}:{}),...(toolChanges.length?{toolChanges}:{}),...(toolResults.length?{toolResults}:{})});
    }
   }
  }
  if(offset!==bytes.length)return empty;cache.set(file,{size:stat.size,mtime:stat.mtimeMs,messages});if(cache.size>16)cache.delete(cache.keys().next().value);return messages;
 }catch{return empty;}
}
export function enrichRequestProvenance(root,request){
 if(!request)return request;const original=readMessageProvenance(root,request.sessionId);
 const enrich=row=>row?{...row,messages:(row.messages||[]).map(message=>{const evidence=original.get(message.id);return evidence?{...message,provenance:evidence,contentBlocks:message.contentBlocks||evidence.toolChanges,...(!message.toolResults?.length&&evidence.toolResults?{toolResults:evidence.toolResults}:{})}:message;})}:row;
 return {...enrich(request),requestStages:request.requestStages?.map(stage=>({...stage,request:enrich(stage.request)})),recentRequests:request.recentRequests?.map(enrich)};
}
