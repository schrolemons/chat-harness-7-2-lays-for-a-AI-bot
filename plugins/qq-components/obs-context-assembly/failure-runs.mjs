// Pure shared rule for the native projection and its Console presentation.
export const failureText=message=>(message.content||[]).filter(block=>block.type==='text').map(block=>block.text).join('\n');
export function failureCode(message){
 const value=failureText(message);let data;try{data=JSON.parse(value);}catch{}
 if(Number(data?.sent)>0||data?.success===true||data?.ok===true)return null;
 if(!((message.isError===true||data?.ok===false||/^Error\s*[:：]/.test(value))&&(message.content||[]).every(block=>block.type==='text')))return null;
 if(/TURN_SEND_LIMIT|turn_limit|最多发送\s*0\s*条|本轮发送额度已用完/.test(value))return 'TURN_SEND_LIMIT';
 return String(data?.code||data?.error?.code||'TOOL_ERROR').slice(0,80);
}
const transparent=message=>!(message.content||[]).length||(message.content||[]).every(block=>block.type==='text'&&!block.text?.trim())||['qq-context-task','qq-context-latest','qq-context-update','qq-context-current','qq-context-retired'].includes(message.source?.kind);
export function consecutiveFailurePlan(rows,{threshold=3}={}){
 const results=new Map();for(const [index,row]of rows.entries())if(row.message?.role==='tool'&&row.message.toolCallId){const id=row.message.toolCallId,list=results.get(id)||[];list.push({...row,index});results.set(id,list);}
 const groups=[],removeSeqs=[],pairedResults=new Set();let run=[],failures=0;
 const flush=()=>{
  const count=run.reduce((sum,pair)=>sum+pair.weight,0);
  if(run.length>=2&&count>=Math.max(3,threshold)){const older=run.slice(0,-1),last=run.at(-1);groups.push({name:last.name,code:last.code,count,first:run[0],last,callIds:run.map(pair=>pair.callId),eventSeqs:run.flatMap(pair=>[pair.call.seq,pair.result.seq])});removeSeqs.push(...older.flatMap(pair=>[pair.call.seq,pair.result.seq]));}
  run=[];
 };
 for(const [index,row]of rows.entries()){
  const message=row.message||{};
  if(message.role==='tool'){if(!pairedResults.has(row.seq)&&!transparent(message))flush();continue;}
  const calls=(message.content||[]).filter(block=>block.type==='tool-call');
  if(message.role!=='assistant'||calls.length!==1){if(!transparent(message))flush();continue;}
  const call=calls[0];if(typeof call.name!=='string'){flush();continue;}
  const matches=results.get(call.id)||[],result=matches.length===1?matches[0]:null;
  const interrupted=result&&rows.slice(index+1,result.index).some(other=>!transparent(other.message||{}));
  const code=result&&!interrupted&&result.index>index?failureCode(result.message):null;
  if(!code){flush();continue;}
  pairedResults.add(result.seq);failures++;
  const saved=result.message.source?.failureRun,weight=saved&&saved.name===call.name&&saved.code===code&&Number.isSafeInteger(saved.count)&&saved.count>=3?saved.count:1;
  const item={call:row,result,callId:call.id,name:call.name,code,weight,operationIndex:row.operationIndex};
  const prior=run.at(-1),gap=prior&&Number.isSafeInteger(prior.operationIndex)&&Number.isSafeInteger(item.operationIndex)&&item.operationIndex!==prior.operationIndex+1;
  if(prior&&(prior.name!==item.name||prior.code!==code||gap))flush();run.push(item);
 }
 flush();return {groups,removeSeqs,retainedFailures:failures-removeSeqs.length/2};
}
