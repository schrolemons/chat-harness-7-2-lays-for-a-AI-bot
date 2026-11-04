// Authenticated transport adapter. Semantic policy and persistent counters remain
// owned by ctx-chat-reply-shape; task admission is owned by the budget component.
export async function declareReplyContents({key,sourceKey,envelope,groups,messages,allowed,callService,admitTaskContents}){
 if(!allowed||!sourceKey||key!==sourceKey||!envelope||envelope.key!==key||envelope.cancelled)return {status:403,body:{ok:false,error:'仅当前已唤醒会话可声明实际读取的用户内容'}};
 if(!Array.isArray(groups)||!groups.length||groups.length>40)return {status:400,body:{ok:false,error:'groups需为1–40份完整用户内容'}};
 const normalized=groups.map(g=>({seqs:g?.seqs,kind:g?.kind||'chat'}));
 const bySeq=new Map(messages.map(message=>[message.seq,message])),taskEligible={...envelope.taskSources};
 for(const group of normalized){
  if(!Array.isArray(group.seqs)||group.seqs.some(seq=>!bySeq.has(seq)))continue;
  const policy=callService('tokenBudget','taskExemption',{text:[...group.seqs].sort((a,b)=>a-b).map(seq=>bySeq.get(seq).plain??bySeq.get(seq).text??'').join('\n'),reason:envelope.reason});
  if(policy?.eligible===true)for(const seq of group.seqs)taskEligible[seq]={...policy,sourceSeq:seq};
 }
 envelope.taskSources=taskEligible;
 const result=callService('replyPlan','declareContents',{key,plan:envelope.replyPlan,groups:normalized,messages,taskEligible});
 if(result?.ok!==true)return {status:409,body:{ok:false,error:result?.reason||'内容分组服务不可用'}};
 const taskContents=result.contents.filter(c=>c.kind==='task');
 let admission={};
 if(taskContents.length){
  if(typeof admitTaskContents!=='function')return {status:503,body:{ok:false,error:'任务接手服务不可用，未获准执行'}};
  admission=await admitTaskContents({key,envelope,contents:taskContents,messages});
  if(admission?.ok===false)return {status:409,body:{ok:false,error:admission.reason||'任务准入未通过'}};
 }
 const contents=result.contents.map(c=>callService('replyPlan','getContent',{key,contentId:c.id})||c);
 return {status:200,body:{ok:true,key,contents,deferred:admission?.deferred||[],deferredDetail:admission?.deferredDetail||[],hint:'每份完整意思分别计数；同义碎片合并，重读不续领。待接手任务不可执行或标为已回复；若额度不足，按 deferredDetail 的原因和可用时间等待。'}};
}
