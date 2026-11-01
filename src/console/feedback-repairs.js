import fs from 'node:fs';

export async function routeFeedbackRepairs({req,url,pluginHost,readBody,sendJson,logPath,appendEvents}){
 if(url.pathname!=='/api/socialV2/self-review-feedback/repairs')return false;
 if(req.headers['x-agent-token']){sendJson({ok:false,error:'该接口仅控制台管理员可用'},403);return true;}
 if(req.method==='GET'){
  sendJson({ok:true,enabled:pluginHost.get('obs-self-review')?.config?.codexRepairEnabled===true,
   method:'POST',path:url.pathname,documentation:'docs/guides/CODEX_REPAIR_API.md',
   authentication:'现有 x-console-token；拒绝 x-agent-token；浏览器写请求须同源',
   example:{runId:'codex-2026-11-01-example',dryRun:true,items:[{id:'问题编号',summary:'修复内容与结论',classification:'code_fix',evidence:['相关回归测试通过','当前运行状态核验结果']}]},
   guarantees:['全批校验后再更新状态','统计由统一账本自动计算','修复日志同步写入现有 _optimization.md','相同runId和内容可安全重试','日志失败返回503和stateCommitted，重试补写且不重复结案']});return true;
 }
 if(req.method!=='POST'){sendJson({ok:false,error:'只支持 GET 或 POST'},405);return true;}
 const body=await readBody(),result=pluginHost.callService('selfReviewFeedback','repairBatch',body);
 if(!result?.ok){sendJson(result||{ok:false,error:'反馈服务不可用'},result?.statusCode||503);return true;}
 if(body.dryRun===true){sendJson(result);return true;}
 try{
  if(!result.logSynced){
   let text='';try{text=fs.readFileSync(logPath(),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
   if(!text.includes(result.marker)){
    const markerEvent={at:result.at,id:result.marker,action:'修复批次验收',queue:'self',detail:'Codex批次 '+result.runId+'；验证结案 '+result.resolvedCount+' 条，已结案跳过 '+result.alreadyResolved+' 条'};
    if(!(appendEvents([markerEvent,...result.events],'Codex 批量修复验收')>0))throw Error('修复日志未写入');
    if(!fs.readFileSync(logPath(),'utf8').includes(result.marker))throw Error('未读到修复日志批次标识');
   }
   const ack=pluginHost.callService('selfReviewFeedback','markRepairBatchLogged',{runId:result.runId,marker:result.marker});if(!ack?.ok)throw Error(ack?.error||'日志回执未保存');
  }
  const state=pluginHost.callService('selfReviewFeedback','listFeedback',{});
  sendJson({ok:true,runId:result.runId,replayed:result.replayed,resolvedCount:result.resolvedCount,alreadyResolved:result.alreadyResolved,logSynced:true,logPath:logPath(),counts:state.counts,historyCount:state.historyCount});
 }catch(error){
  const state=pluginHost.callService('selfReviewFeedback','listFeedback',{});
  sendJson({ok:false,runId:result.runId,stateCommitted:true,logSynced:false,error:'状态已保存，日志尚未同步；请用相同 runId 和内容重试：'+error.message,counts:state?.counts},503);
 }
 return true;
}
