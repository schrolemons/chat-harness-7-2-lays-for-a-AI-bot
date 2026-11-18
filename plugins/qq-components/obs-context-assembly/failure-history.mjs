import {consecutiveFailurePlan,readFailureRun,failureRunContent} from './failure-runs.mjs';
export {failureCode} from './failure-runs.mjs';
export const failureHistoryPlan=consecutiveFailurePlan;
export function compactFailedToolHistory(session,position,replace){
 const rows=session.surface.nodes.map(seq=>{const event=session.eventAt(seq);return {seq,event,message:event?.data?.message||event?.data};}).filter(row=>Array.isArray(row.message?.content));
 const plan=failureHistoryPlan(rows);
 for(const seq of plan.removeSeqs){const row=rows.find(item=>item.seq===seq);replace(session,seq,{...row.message,content:[],source:{kind:'qq-context-retired',reason:'consecutive-tool-failure'}},position);}
 for(const group of plan.groups){
  const last=group.last.result,original=last.message,first=readFailureRun(group.first.result.message);
  // Native DSH permits changing content only; source metadata is immutable.
  const message={...original,content:failureRunContent(original,{name:group.name,code:group.code,count:group.count,firstCallSeq:first?.firstCallSeq||group.first.call.seq})};
  session.append('tool/result',{...last.event.data,message},{surfaceOp:{op:'replace',startSeq:last.seq,endSeq:last.seq},sourceEventSeqs:group.eventSeqs});
 }
 return {removedPairs:plan.removeSeqs.length/2,collapsedRuns:plan.groups.length,summaryCount:0};
}
