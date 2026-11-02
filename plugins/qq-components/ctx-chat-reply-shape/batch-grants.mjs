// New reads update admitted source context; they never create a batch allowance.
export function createBatchGrants(resolve){
 const grants=new Map();
 return ({key,actionId,currentPlan,baselineSeq=0,messages=[],mood,reason,canRenew=true,taskExempt,taskEligible,taskSources})=>{
  const candidates=messages.filter(m=>m&&m.isSelf!==true&&Number.isSafeInteger(m.seq)&&m.seq>0);
  const through=Math.max(baselineSeq,...candidates.map(m=>m.seq));const old=grants.get(actionId)||{through:baselineSeq,plan:currentPlan};
  const complete=candidates.filter(m=>m.truncated!==true&&m.bodyComplete!==false&&!m.unresolvedReplyIds?.length&&(m.bodyComplete===true||String(m.text??m.plain??'').length!==200));
  const signature=JSON.stringify(complete.map(m=>[m.seq,String(m.messageId??''),String(m.text??m.plain??'')]));
  const promotion=complete.length>0&&!old.plan?.contentId&&signature!==old.signature;
  if(!canRenew||(through<=old.through&&!promotion))return {changed:false,plan:old.plan,throughSeq:old.through};
  const plan=resolve({...currentPlan,key,turnId:currentPlan?.turnId||actionId,incomingText:candidates.map(m=>m.plain||m.text||'').join('\n'),mood,reason,messages:candidates,taskExempt:taskExempt===true,taskGroupId:undefined,taskEligible,taskSources});
  const unbound=candidates.length>1?Object.freeze({...plan,contentId:undefined}):plan;
  grants.set(actionId,{through,signature,plan:unbound});if(grants.size>512)grants.delete(grants.keys().next().value);return {changed:true,plan:unbound,throughSeq:through};
 };
}
