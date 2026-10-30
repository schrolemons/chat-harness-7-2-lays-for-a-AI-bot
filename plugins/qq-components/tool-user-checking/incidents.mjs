import {createHash} from 'node:crypto';
import {slicePromptUnicode} from '../../../src/prompt-unicode.js';
const LABELS={open:'故障待处理',failed:'自动恢复失败',resolved:'恢复记录'};
function clean(value,max=180){return slicePromptUnicode(String(value||'').replace(/(["']?(?:token|agentToken|apiKey|api_key|secret|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s"';,}\n]+/gi,'$1[已隐藏]').replace(/\bBearer\s+\S+/gi,'Bearer [已隐藏]').replace(/\bsk-[a-z0-9_-]{8,}/gi,'[已隐藏]').replace(/[\r\n]+/g,' '),max);}
function time(at){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));}
export function createIncidentNotebook(ctx,append){
 const active=()=>!ctx.signal?.aborted&&ctx.isActive?.()!==false;
 const state=()=>ctx.state.get()||{};
 function flush(){
  if(!active())return {ok:false,disabled:true};
  let queue=[...(state().incidentQueue||[])];
  for(let n=0;n<20&&queue.length;n++){
   const entry=queue[0],max=Math.max(20,Math.min(2000,Number(ctx.config?.maxNoteChars)||500));
   const text=slicePromptUnicode(['【'+LABELS[entry.phase]+'】'+entry.summary,'会话：'+entry.key,'首次发现：'+time(entry.firstAt),'影响：'+entry.impact,'排查／处理：'+entry.nextStep].join('\n'),max);
   let result;try{result=append(text);}catch{result={ok:false};}
   if(result?.ok!==true)return {ok:false,pending:queue.length};
   queue=queue.slice(1);ctx.state.set({incidentQueue:queue});
  }
  return {ok:!queue.length,pending:queue.length};
 }
 function report(input={}){
  if(!active())return {ok:false,disabled:true};
  if(!input.id||!Object.hasOwn(LABELS,input.phase))return {ok:false,error:'故障标识或状态无效'};
  const id=createHash('sha256').update(String(input.id)).digest('hex'),issues=state().incidents||{},old=issues[id];
  if(old?.phase===input.phase)return {ok:!(state().incidentQueue||[]).some(row=>row.id===id),duplicate:true};
  const now=Number(input.at)||Date.now(),firstAt=old?.firstAt||Number(input.firstAt)||now;
  const entry={id,phase:input.phase,firstAt,at:now,key:/^(group|private):[1-9]\d*$/.test(String(input.key))?input.key:'未指定会话',
   summary:clean(input.summary||'阻断聊天的运行故障'),impact:clean(input.impact||'可能无法正常完成回复',100),nextStep:clean(input.nextStep||'保留证据，检查桥接控制中的故障记录',160)};
  ctx.state.set({incidents:{...issues,[id]:{phase:entry.phase,firstAt,lastAt:now}},incidentQueue:[...(state().incidentQueue||[]),entry]});
  return flush();
 }
 return {report,flush};
}
