import {createHash} from 'node:crypto';

const fail=(error,statusCode=400)=>({ok:false,error,statusCode});
const boundedText=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max?v.trim():null;
export function createRepairBatchService({enabled,getState,allEntries,record,persist}){
 return {
  repairBatch(input={}){
   if(!enabled())return fail('Codex 修正接口未启用',403);
   const runId=boundedText(input.runId,96);
   if(!runId||!/^[-\w.:]+$/.test(runId))return fail('runId 必须为 1–96 位字母、数字、点、冒号、横线或下划线');
   if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)return fail('items 必须包含 1–100 个修复结果');
   const items=[],ids=new Set();
   for(const raw of input.items){
    const id=boundedText(raw?.id,128),summary=boundedText(raw?.summary,500),classification=raw?.classification||'code_fix';
    if(!id||ids.has(id)||!summary)return fail('每项必须有唯一 id 和非空 summary（最多500字）');
    if(raw.status!==undefined&&raw.status!=='已修复')return fail('本接口只接受经过验证的已修复结论');
    if(!['code_fix','already_fixed','operational_recovered','not_a_bug'].includes(classification))return fail('classification 无效');
    if(!Array.isArray(raw.evidence)||raw.evidence.length<1||raw.evidence.length>12||raw.evidence.some(x=>!boundedText(x,300)))return fail('每项必须提供 1–12 条非空验证依据（每条最多300字）');
    ids.add(id);items.push({id,summary,classification,evidence:raw.evidence.map(x=>x.trim())});
   }
   const digest=createHash('sha256').update(JSON.stringify(items)).digest('hex'),marker='codex-repair:'+createHash('sha256').update(runId+digest).digest('hex').slice(0,24);
   const s=getState(),entries=allEntries(s),runs=s.codexRepairRuns||{},old=Object.hasOwn(runs,runId)?runs[runId]:null;
   if(old){if(old.digest!==digest)return fail('同一 runId 的修复内容不能改变，请使用新 runId',409);return {ok:true,...old,replayed:true};}
   for(const item of items){const found=entries.find(x=>x.id===item.id);if(!found)return fail('未找到反馈：'+item.id,404);if(found.processingTaskId||found.processingClaimId)return fail('反馈正在由 DSH 研究处理：'+item.id,409);if(found.status==='已删除')return fail('已删除反馈不能通过修复接口结案：'+item.id,409);}
   const pending=items.filter(item=>entries.find(x=>x.id===item.id).status!=='已修复');
   if(input.dryRun===true)return {ok:true,dryRun:true,runId,marker,willResolve:pending.map(x=>x.id),alreadyResolved:items.length-pending.length};
   const now=new Date().toISOString(),events=[];
   for(const item of pending){
    const row=entries.find(x=>x.id===item.id);
    row.status='已修复';row.result=(item.summary+'；验证：'+item.evidence.join('；')).slice(0,500);row.completedAt=now;row.updatedAt=now;
    row.repairRunId=runId;row.repairClassification=item.classification;
    s.hiddenQueueIds=s.hiddenQueueIds.filter(id=>id!==item.id);s.difficultyIds=s.difficultyIds.filter(id=>id!==item.id);
    events.push(record(s,'resolved',row,row.result));
   }
   // Durable log outbox: retrying after a Markdown write failure does not redo transitions.
   const run={runId,digest,marker,at:now,items,events,resolvedCount:pending.length,alreadyResolved:items.length-pending.length,logSynced:false};
   s.codexRepairRuns={...runs,[runId]:run};persist(s);return {ok:true,...run,replayed:false};
  },
  markRepairBatchLogged({runId,marker}={}){
   const s=getState(),run=s.codexRepairRuns?.[runId];if(!run||run.marker!==marker)return fail('修复批次回执不匹配',409);
   run.logSynced=true;run.loggedAt=new Date().toISOString();persist(s);return {ok:true};
  }
 };
}
