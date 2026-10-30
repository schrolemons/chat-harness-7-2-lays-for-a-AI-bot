// Model-surface projection only. Never deletes source events or rewrites tool nodes.
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
