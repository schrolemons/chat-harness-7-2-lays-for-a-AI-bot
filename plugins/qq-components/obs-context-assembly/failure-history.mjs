import {randomUUID} from 'node:crypto';
const text=message=>(message.content||[]).filter(block=>block.type==='text').map(block=>block.text).join('\n');
function failureCode(message){
 const value=text(message);let data;try{data=JSON.parse(value);}catch{}
 if(Number(data?.sent)>0||data?.success===true||data?.ok===true)return null;
 if(!((message.isError===true||data?.ok===false||/^Error\s*[:：]/.test(value))&&(message.content||[]).every(b=>b.type==='text')))return null;
 if(/TURN_SEND_LIMIT|turn_limit|最多发送\s*0\s*条|本轮发送额度已用完/.test(value))return 'TURN_SEND_LIMIT';
 return String(data?.code||data?.error?.code||'TOOL_ERROR').slice(0,80);
}
export function failureHistoryPlan(rows,{keep=2}={}){
 const results=new Map();for(const row of rows)if(row.message?.role==='tool'&&row.message.toolCallId){const id=row.message.toolCallId;if(!results.has(id))results.set(id,[]);results.get(id).push(row);}
 const grouped=new Map();for(const row of rows){
  if(row.message?.role!=='assistant')continue;const calls=(row.message.content||[]).filter(block=>block.type==='tool-call');if(calls.length!==1||typeof calls[0].name!=='string')continue;
  const call=calls[0],matches=results.get(call.id);if(matches?.length!==1)continue;const code=failureCode(matches[0].message);if(!code)continue;
  const key=call.name+'|'+code;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push({call:row,result:matches[0],callId:call.id,name:call.name,code});
 }
 const removeSeqs=[],groups=[];let retainedFailures=0;
 for(const list of grouped.values()){const retained=Math.max(0,Math.floor(keep));retainedFailures+=Math.min(list.length,retained);const removed=list.slice(0,Math.max(0,list.length-retained));if(!removed.length)continue;removeSeqs.push(...removed.flatMap(row=>[row.call.seq,row.result.seq]));groups.push({name:list[0].name,code:list[0].code,count:removed.length,anchorSeq:removed[0].call.seq,eventSeqs:removed.flatMap(row=>[row.call.seq,row.result.seq]),callIds:removed.map(row=>row.callId)});}
 return {removeSeqs,groups,retainedFailures};
}
export function compactFailedToolHistory(session,position,replace,{keep=2}={}){
 const rows=session.surface.nodes.map(seq=>{const event=session.eventAt(seq);return {seq,message:event?.data?.message||event?.data};}).filter(row=>Array.isArray(row.message?.content));
 const plan=failureHistoryPlan(rows,{keep}),anchors=new Map(plan.groups.map(row=>[row.anchorSeq,row]));
 for(const group of plan.groups){
  const old=rows.filter(row=>row.message.source?.kind==='qq-context-tool-history'&&row.message.source.toolName===group.name&&row.message.source.code===group.code);
  group.total=group.count+old.reduce((n,row)=>n+(Number(row.message.source.count)||0),0);
  for(const row of old)replace(session,row.seq,{...row.message,content:[],source:{kind:'qq-context-retired',reason:'merged-tool-errors'}},position);
 }
 for(const seq of plan.removeSeqs){const row=rows.find(row=>row.seq===seq),group=anchors.get(seq);
  replace(session,seq,{id:group?randomUUID():row.message.id,role:'user',content:group?[{type:'text',text:'【重复工具错误已归档】'+group.name+'：已折叠'+group.total+'次失败；只保留最近2次实际调用与错误。失败不代表已完成或已发送；不要重复盲试，原始记录仍保留在日志中。'}]:[],source:{kind:group?'qq-context-tool-history':'qq-context-retired',reason:'repeated-tool-failure',...(group?{toolName:group.name,code:group.code,count:group.total}:{})}},position);
 }
 return {removedPairs:plan.groups.reduce((count,row)=>count+row.count,0),summaryCount:plan.groups.length};
}
