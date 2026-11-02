import {createHash} from 'node:crypto';

// Source identities survive model calls, wakes and component reloads. The caller
// supplies only full messages already admitted by the authenticated bridge.
export function createContentUnits(ctx){
 const load=()=>{
  const s={conversations:{},turns:{},contents:{},contentAliases:{},...structuredClone(ctx.state.get().sendLedger||{})};
  for(const c of Object.values(s.contents))if(!c.sourceKeys){c.sourceKeys=Object.values(c.sources||{}).map(hash=>'legacy:'+hash);c.sourceBodies=Object.fromEntries(c.sourceKeys.map(k=>[k,k.slice(7)]));}
  return s;
 };
 const save=s=>ctx.state.set({sendLedger:s});
 const complete=m=>m&&m.isSelf!==true&&Number.isSafeInteger(m.seq)&&m.seq>0&&m.truncated!==true&&m.bodyComplete!==false&&!m.unresolvedReplyIds?.length&&(m.bodyComplete===true||String(m.text??m.plain??'').length!==200);
 const digest=m=>createHash('sha256').update(JSON.stringify([String(m.messageId??''),String(m.text??m.plain??'')])).digest('hex');
 const sourceKey=m=>m.messageId!=null&&String(m.messageId)!==''?'message:'+String(m.messageId):'body:'+digest(m);
 const matchedKey=(c,m)=>c.sourceKeys.includes(sourceKey(m))?sourceKey(m):c.sourceKeys.includes('legacy:'+digest(m))?'legacy:'+digest(m):null;
 const canonical=(s,id)=>{const seen=new Set();while(s.contentAliases[id]&&!seen.has(id)){seen.add(id);id=s.contentAliases[id];}return id;};
 const started=(s,id)=>!!s.contents[id]?.taskGroupAdmission||(s.contentCounts?.[id]||0)>0||Object.values(s.conversations).some(e=>Object.values(e.reservations||{}).some(r=>canonical(s,r.contentId)===id));
 const publicContent=c=>Object.freeze({id:c.id,key:c.key,seqs:Object.freeze([...c.seqs]),kind:c.kind,maxParts:c.maxParts,taskExempt:c.kind==='task'&&!!c.taskGroupAdmission,taskPending:c.kind==='task'&&!c.taskGroupAdmission,taskGroupAdmission:c.taskGroupAdmission?Object.freeze({...c.taskGroupAdmission}):null});
 return {
  declareAutonomous({key,plan,autonomousSource}={}){
   if(!plan||plan.key!==key||!autonomousSource?.id||!['proactiveCheck','startupGreeting','privateFollowup','timeBubble','newsShare','directMessage'].includes(autonomousSource.kind))return {ok:false,reason:'invalid_autonomous_source'};
   const s=load(),id='content:'+createHash('sha256').update(JSON.stringify([key,'event',autonomousSource.kind,String(autonomousSource.id)])).digest('hex').slice(0,32);
   s.contents[id]||={id,key,seqs:[],kind:'chat',maxParts:plan.maxParts??plan.maxMessages,sources:{},event:{id:String(autonomousSource.id),kind:autonomousSource.kind}};
   save(s);return {ok:true,content:publicContent(s.contents[id])};
  },
  declareContents({key,plan,groups=[],messages=[],taskEligible}={}){
   if(!plan||plan.key!==key||!Array.isArray(groups)||!groups.length||!Array.isArray(messages))return {ok:false,reason:'invalid_contents'};
   const admitted=new Map(messages.filter(complete).map(m=>[m.seq,m])),seen=new Set(),s=load(),out=[],selected=new Set();
   const owner=new Map();for(const c of Object.values(s.contents))if(c.key===key&&canonical(s,c.id)===c.id)for(const source of c.sourceKeys)owner.set(source,c.id);
   for(const group of groups){
    if(!Array.isArray(group?.seqs)||!group.seqs.length||!['chat','task'].includes(group.kind))return {ok:false,reason:'invalid_content_group'};
    const seqs=[...group.seqs].sort((a,b)=>a-b);
    for(const seq of seqs){if(!admitted.has(seq))return {ok:false,reason:'source_not_admitted'};if(seen.has(seq))return {ok:false,reason:'source_overlap'};seen.add(seq);}
    const task=group.kind==='task';
    const eligible=seq=>taskEligible?.[seq]===true||taskEligible?.[seq]?.eligible===true;
    if(!task&&seqs.some(eligible))return {ok:false,reason:'task_kind_required'};
    if(task&&!seqs.every(eligible))return {ok:false,reason:'task_not_eligible'};
    const sources=seqs.map(seq=>{const m=admitted.get(seq),legacy='legacy:'+digest(m);return {m,key:owner.has(legacy)?legacy:sourceKey(m)};});
    if(new Set(sources.map(x=>x.key)).size!==sources.length)return {ok:false,reason:'source_overlap'};
    const keys=sources.map(x=>x.key).sort(),priorIds=[...new Set(keys.map(source=>owner.get(source)).filter(Boolean))],prior=priorIds.map(id=>s.contents[id]);
    for(const c of prior)for(const source of sources.filter(x=>c.sourceKeys.includes(x.key)))if(c.sourceBodies[source.key]!==digest(source.m))return {ok:false,reason:'source_changed'};
    const subset=prior.length===1&&keys.every(source=>prior[0].sourceKeys.includes(source));
    if(!subset&&prior.some(c=>c.sourceKeys.some(source=>!keys.includes(source))))return {ok:false,reason:'grouping_conflict'};
    if(priorIds.some(id=>selected.has(id)))return {ok:false,reason:'grouping_conflict'};
    const changedKind=prior.some(c=>c.kind!==group.kind);
    if((!subset||changedKind)&&prior.some(c=>started(s,c.id)))return {ok:false,reason:'content_already_started'};
    let content;
    if(subset){
     content={...prior[0],kind:group.kind};
     const current=content.sourceKeys.map(source=>[...admitted.values()].find(m=>matchedKey(content,m)===source));
     if(current.every(Boolean)){content.seqs=current.map(m=>m.seq).sort((a,b)=>a-b);content.sources=Object.fromEntries(current.map(m=>[m.seq,digest(m)]));}
    }
    else {
     const id='content:'+createHash('sha256').update(JSON.stringify([key,'sources',keys])).digest('hex').slice(0,32);
     content={id,key,seqs,sourceKeys:keys,sourceBodies:Object.fromEntries(sources.map(x=>[x.key,digest(x.m)])),kind:group.kind,maxParts:Math.min(plan.maxParts??plan.maxMessages,...prior.map(c=>c.maxParts)),sources:Object.fromEntries(seqs.map(seq=>[seq,digest(admitted.get(seq))]))};
     for(const old of prior){s.contentAliases[old.id]=id;delete s.contents[old.id];}
    }
    s.contents[content.id]=content;
    for(const source of content.sourceKeys)owner.set(source,content.id);
    priorIds.forEach(id=>selected.add(id));selected.add(content.id);out.push(publicContent(content));
   }
   save(s);return {ok:true,contents:out};
  },
  getContent({key,contentId}={}){const s=load(),c=s.contents[canonical(s,contentId)];return c&&c.key===key?publicContent(c):null;},
  validateReceipts({key,messages=[],receipts=[],taskSources={}}={}){
   const s=load(),admitted=messages.filter(complete),pending=[];
   for(const receipt of receipts)if(receipt?.status==='replied'){
    const message=admitted.find(m=>m.seq===receipt.seq);if(!message)continue;
    const contents=Object.values(s.contents).filter(c=>c.key===key&&c.kind==='task'&&matchedKey(c,message)&&c.sourceBodies[matchedKey(c,message)]===digest(message));
    const eligible=taskSources[message.seq]===true||taskSources[message.seq]?.eligible===true;
    const paid=contents.some(c=>c.taskGroupAdmission&&s.conversations[key]?.taskAdmissions?.[c.id]);
    if((eligible||contents.length>0)&&!paid)pending.push(receipt.seq);
   }
   return pending.length?{ok:false,reason:'task_group_pending',seqs:[...new Set(pending)]}:{ok:true};
  },
  bindContent({key,sourceKey=key,plan,contentId=plan?.contentId,messages,replyToMessageId,taskExempt=false,taskGroupId=plan?.taskGroupId}={}){
   if(!plan||plan.key!==sourceKey)return {ok:false,reason:'invalid_plan'};
   if(!contentId&&replyToMessageId!=null){
    const matches=Array.isArray(messages)?messages.filter(m=>complete(m)&&m.messageId!=null&&String(m.messageId)===String(replyToMessageId)):[];
    if(!matches.length)return {ok:false,reason:'source_not_admitted'};
    const s=load(),ids=new Set();
    for(const message of matches)for(const c of Object.values(s.contents))if(c.key===sourceKey&&matchedKey(c,message))ids.add(canonical(s,c.id));
    if(ids.size!==1)return {ok:false,reason:'content_required'};
    contentId=[...ids][0];
   }
   if(!contentId&&(taskExempt===true||plan?.taskExempt===true||taskGroupId)){
    const admission=this.getTaskGroup?.({key:sourceKey,groupId:taskGroupId});
    return admission?{ok:true,content:null,plan:Object.freeze({...plan,sourceKey,taskExempt:true,taskPending:false,taskGroupId:admission.groupId})}:{ok:false,reason:'task_group_pending'};
   }
   if(!contentId)return {ok:false,reason:'content_required'};
   const content=this.getContent({key:sourceKey,contentId});
   if(!content)return {ok:false,reason:'content_not_found'};
   if(content.taskPending)return {ok:false,reason:'task_group_pending',content};
   if(Array.isArray(messages)){
    const admitted=messages.filter(complete),stored=load().contents[content.id];
    if(stored.sourceKeys.some(source=>!admitted.some(m=>matchedKey(stored,m)===source&&stored.sourceBodies[source]===digest(m))))return {ok:false,reason:'source_not_admitted'};
   }
   return {ok:true,content,plan:Object.freeze({...plan,contentId:content.id,sourceKey,taskExempt:content.taskExempt,taskPending:content.taskPending,taskGroupId:content.taskGroupAdmission?.groupId,maxParts:content.maxParts,maxMessages:content.maxParts,line:plan.line.replace(/合计最多 \d+ 条/,'合计最多 '+content.maxParts+' 条')})};
  }
 };
}
