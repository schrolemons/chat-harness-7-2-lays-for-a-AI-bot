// Model-surface projection only. Never deletes source events or rewrites tool nodes.
export function slimLegacyText(text) {
 if(typeof text!=='string'||!text.includes('【会话令牌】')||!text.includes('【本次消息快照】')||!text.includes('【逐条看完，别只回最后一条】'))return null;
 const start=text.indexOf('【本次消息快照】')+'【本次消息快照】'.length;
 const end=text.indexOf('【逐条看完，别只回最后一条】',start);
 try {const data=JSON.parse(text.slice(start,end).trim());if(!data||!Array.isArray(data.messages))return null;
  return '【历史 QQ 消息数据；当轮规则已由当前 context 取代】\n'+JSON.stringify(data);
 }catch{return null;}
}
export function planHistoryReplacements(events,surface) {
 const active=new Set(surface),out=[],seen=new Set();
 for(const event of events) {
  if(!active.has(event.seq)||event.type!=='user/message')continue;
  const message=event.data;
  if(!Array.isArray(message?.content))continue;
  let changed=false;const seqs=[];
  const content=message.content.map(block=>{if(block.type!=='text')return block;let text=slimLegacyText(block.text);if(text===null)return block;changed=true;
   const snapshot=JSON.parse(text.slice(text.indexOf('\n')+1));
   const rows=[...(snapshot.recent||[]),...(snapshot.receiptWindow||[]),...snapshot.messages].filter(Boolean).sort((a,b)=>(a.seq||0)-(b.seq||0));
   const fresh=rows.filter(row=>{if(!Number.isSafeInteger(row.seq))return true;if(seen.has(row.seq))return false;seen.add(row.seq);seqs.push(row.seq);return true;});
   text=fresh.length?'【历史 QQ 消息数据】\n'+JSON.stringify(fresh):'';return {...block,text};});
  if(changed)out.push({seq:event.seq,message:{...message,content,source:{...message.source,kind:'qq-context-dialogue',seqs}},sourceEventSeqs:[event.seq]});
 }
 return out;
}
export function replaceSurface(session,seq,message,position={turn:1,step:0}){
 const intent={surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]};
 // Empty developer nodes have a documented null projection in DSH; empty USER
 // nodes do not. This tombstone adds no instruction and no empty provider turn.
 if(message.content.every(x=>x.type==='text'&&!x.text.trim())){
  const boundary=session.snapshotEvents().findLast(event=>['turn/start','turn/end','step/start','step/end'].includes(event.type));
  if(boundary?.type!=='step/start'||boundary.data.turn!==position.turn||boundary.data.step!==position.step)throw Error('Empty context replacement requires the actual open step');
  session.append('developer/message',{...position,message:{...message,role:'developer',content:[]}},intent);
 }
 else session.append('user/message',message,intent);
}
