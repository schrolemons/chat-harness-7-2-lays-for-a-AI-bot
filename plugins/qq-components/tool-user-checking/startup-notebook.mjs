// Stable across module hot loads; different for each actual Node process boot.
const PROCESS_BOOT={bootId:process.pid+':'+performance.timeOrigin,startedAt:performance.timeOrigin};
export function createStartupNotebook(ctx,appendNote,{bootId=PROCESS_BOOT.bootId,startedAt=PROCESS_BOOT.startedAt,clock=Date.now}={}){
 let local;
 return {flush(){
  if(ctx.signal?.aborted||ctx.isActive?.()===false)return;
  const old=ctx.state?.get?.().startupNotebook||local;if(old?.bootId===bootId)return;
  const now=clock(),minutes=old?Math.max(0,Math.round((startedAt-old.startedAt)/60000)):null;
  const when=new Date(startedAt).toLocaleString('zh-CN',{hour12:false});
  const prefix=now-startedAt>120000?'开始记录这次桥接启动':'桥接重新启动了';
  const text=prefix+'（'+when+'）'+(minutes===null?'，这是第一条启动记录。':'，距上次启动'+minutes+'分钟。')+'已记录本次启动；频繁重启可能打断正在进行的任务。';
  const result=appendNote(text);if(result?.ok){local={bootId,startedAt,recordedAt:now,count:(old?.count||0)+1};ctx.state?.set?.({startupNotebook:local});}
 }};
}
