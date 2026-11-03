import {consecutiveFailurePlan,failureCode} from '../../../plugins/qq-components/obs-context-assembly/failure-runs.mjs';
import {capturedToolResults} from './context-records.js';
import {safeFailureText} from '../../../plugins/qq-components/obs-context-assembly/failure-preview.mjs';
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const prefix=row=>row.role==='system'||['qq-context-stable','qq-context-current','qq-context-latest','qq-context-update'].includes(row.source);
export function projectToolFailures(messages){
 const aliases=new Map(),original=messages.filter(row=>row.source!=='qq-context-tool-history'),known=new Set(original.flatMap(row=>(row.toolCalls||[]).map(call=>call.id))),pairs=new Map();let missing=0;
 for(const archive of messages.filter(row=>row.source==='qq-context-tool-history')){
  if(!archive.archivedToolPairs?.length)missing++;
  for(const pair of archive.archivedToolPairs||[])if(!known.has(pair.callId))pairs.set(pair.callId,pair);
 }
 const restored=[];
 for(const pair of pairs.values())for(const result of [false,true]){
  const seq=result?pair.resultEventSeq:pair.callEventSeq;
  const next=original.find(row=>!prefix(row)&&Number.isSafeInteger(row.provenance?.eventSeq)&&row.provenance.eventSeq>seq);
  const at=next?.position??original.find(row=>row.region==='dynamic')?.position??((original.at(-1)?.position||0)+1);
  restored.push({id:result?pair.resultMessageId:pair.callMessageId,key:'restored:'+pair.callId+(result?':result':':call'),name:pair.name,role:result?'tool':'assistant',kind:result?'result':'call',source:result?'tool':'model',region:'history',position:at-.5,restoredFromArchive:true,restoredEventSeq:seq,provenance:{eventSeq:seq,eventType:result?'tool/result':'assistant/message',...(!result?{toolOperationIndex:pair.operationIndex}:{})},text:result?safeFailureText(pair.errorText):JSON.stringify({type:'tool-call',id:pair.callId,name:pair.name,arguments:safeFailureText(pair.argumentsText)}),...(result?{isError:true,toolResults:[{toolCallId:pair.callId,name:pair.name}]}:{toolCalls:[{id:pair.callId,name:pair.name}]}),effectiveComponents:[],withdrawnComponents:[]});
 }
 restored.sort((a,b)=>a.restoredEventSeq-b.restoredEventSeq).forEach((row,index)=>{row.position+=(index+1)/1000000;});
 const combined=[...original,...restored].sort((a,b)=>a.position-b.position),native=combined.map(row=>{
  const calls=(row.toolCalls||[]).map(call=>String(row.text||'').split('\n').map(parse).find(block=>block?.type==='tool-call'&&block.id===call.id)||{type:'tool-call',...call});
  const results=capturedToolResults(row),result=results.length===1?results[0]:null;
  return {seq:row.key,operationIndex:row.provenance?.toolOperationIndex,message:{role:row.role,source:{kind:row.source,...(row.failureRun?{failureRun:row.failureRun}:{})},content:calls.length?calls:[{type:'text',text:result?.data?JSON.stringify(result.data):row.text||''}],...(result?{toolCallId:result.toolCallId,isError:result.isError}:{})}};
 });
 const plan=consecutiveFailurePlan(native),removed=new Set(plan.removeSeqs),counts=new Map();
 for(const group of plan.groups){counts.set(group.last.call.seq,group.count);counts.set(group.last.result.seq,group.count);for(const pair of group.callIds){const call=combined.find(row=>row.toolCalls?.some(item=>item.id===pair)),result=combined.find(row=>row.toolResults?.some(item=>item.toolCallId===pair));if(call)aliases.set(call.key,group.last.call.seq);if(result)aliases.set(result.key,group.last.result.seq);}}
 for(const row of native){const run=row.message.source.failureRun;if(run?.count>=3&&failureCode(row.message)===run.code){counts.set(row.seq,run.count);const call=combined.find(item=>item.toolCalls?.some(value=>value.id===row.message.toolCallId));if(call)counts.set(call.key,run.count);}}
 return {messages:combined.filter(row=>!removed.has(row.key)).map(row=>counts.has(row.key)?{...row,attemptCount:counts.get(row.key)}:row),aliases,missing};
}
