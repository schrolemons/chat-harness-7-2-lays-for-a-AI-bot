// Match the bridge notification limits while keeping retries idempotent.
export function notificationBatches(changes) {
  const items=[];
  for(const change of changes){
    const chunks=String(change.msg).match(/[\s\S]{1,1800}/g)||[''];
    chunks.forEach((text,index)=>items.push({id:chunks.length===1?change.deliveryId:`${change.deliveryId}:part-${index+1}`,text,sourceAt:change.sourceAt,expiresAt:change.sourceAt+86400000}));
  }
  const batches=[];for(let i=0;i<items.length;i+=20)batches.push(items.slice(i,i+20));return batches;
}
