// A new admitted, actually visible human batch gets a fresh turn allowance once.
export function createBatchGrants(resolve){
 const grants=new Map();
 return ({key,actionId,currentPlan,baselineSeq=0,messages=[],mood,reason,canRenew=true})=>{
  const candidates=messages.filter(m=>m&&m.isSelf!==true&&Number.isSafeInteger(m.seq)&&m.seq>0);
  const through=Math.max(baselineSeq,...candidates.map(m=>m.seq));const old=grants.get(actionId)||{through:baselineSeq,plan:currentPlan};
  if(!canRenew||through<=old.through)return {changed:false,plan:old.plan,throughSeq:old.through};
  const plan=resolve({key,turnId:actionId+':batch:'+through,incomingText:candidates.map(m=>m.plain||m.text||'').join('\n'),mood,reason});
  grants.set(actionId,{through,plan});if(grants.size>512)grants.delete(grants.keys().next().value);return {changed:true,plan,throughSeq:through};
 };
}
