// The recorder keeps three reference positions; these may point to one request.
function identity(row){
 if(row.requestId)return 'id:'+row.requestId;
 // Never merge old records by timestamp alone.
 return 'legacy:'+JSON.stringify([row.sessionId,row.nonce,row.at,row.turn,row.step,row.requestInRound,row.messages,row.tools,row.modules]);
}
const ordinal=row=>Number.isSafeInteger(row.requestInRound)&&row.requestInRound>0?'第 '+row.requestInRound+' 次模型调用':'模型调用序号未记录';
export function requestStageOptions(stages=[]){
 const groups=new Map();
 for(const stage of stages){
  if(!stage.request)continue;
  const key=identity(stage.request);
  if(!groups.has(key))groups.set(key,{request:stage.request,aliases:[]});
  groups.get(key).aliases.push(stage.kind);
 }
 return [...groups.values()].map(group=>{
  const {request,aliases}=group,latest=aliases.includes('current'),first=aliases.includes('initial'),previous=aliases.includes('previous');
  const kind=latest?'current':first?'initial':'previous';
  const title=latest?first?'最新记录（也是首次）':'最新记录':first?previous?'首次记录（也是上一次）':'首次记录':'上一次记录';
  const time=Number.isFinite(request.at)?new Date(request.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未记录';
  return {...group,kind,title,label:ordinal(request)+' · '+title+' · '+time};
 });
}
export function requestStageSummary(row){
 if(!row)return '尚未采集到模型调用记录。';
 return (row.processingId?'本次持续处理':'旧采集批次')+'：'+ordinal(row)+' · 携带 '+(row.messages?.length||0)+' 条消息记录（含历史） · '+(row.toolCount??row.tools?.length??0)+' 个可用工具';
}
