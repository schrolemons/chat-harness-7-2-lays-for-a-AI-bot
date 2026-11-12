// Diagnostic accounting only. A request/header is logged only when necessary,
// so count actual assistant responses instead of treating headers as calls.
export function summarizeRequestTiming(events,wall){
 const start=events.find(e=>e.type==='turn/start'),end=events.findLast(e=>e.type==='turn/end');
 if(!start||!end)throw Error('Incomplete turn timing');
 const requests=[],tools=[];let stepStart=start.at,header;
 const calls=new Map();
 for(const event of events){
  if(event.at<start.at||event.at>end.at)continue;
  if(event.type==='step/start'){stepStart=event.at;header=undefined;}
  if(event.type==='request/header')header=event.at;
  if(event.type==='assistant/message')requests.push({ms:event.at-(header??stepStart),includesPreparation:header===undefined});
  if(event.type==='tool/call')calls.set(event.callId??event.seq,event);
  if(event.type==='tool/result'){
   const call=calls.get(event.callId)??(calls.size===1?[...calls.values()][0]:undefined);
   if(call){tools.push({name:call.name,ms:event.at-call.at,start:call.at,end:event.at});calls.delete(call.callId??call.seq);}
  }
 }
 // Union intervals so parallel tool dispatch never counts the same time twice.
 let toolMs=0,right=-Infinity;for(const tool of [...tools].sort((a,b)=>a.start-b.start)){toolMs+=Math.max(0,tool.end-Math.max(right,tool.start));right=Math.max(right,tool.end);}
 const requestMs=requests.reduce((n,r)=>n+r.ms,0),nativeMs=end.at-start.at;
 return {totalMs:wall.finished-wall.started,entryMs:start.at-wall.started,nativeMs,requestMs,toolMs,otherNativeMs:nativeMs-requestMs-toolMs,deliveryMs:wall.finished-end.at,requests,tools:tools.map(({name,ms})=>({name,ms}))};
}
