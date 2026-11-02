import {classifyBridge} from '../plugins/qq-components/obs-bridge-health/health.mjs';

export function normalizeBridgeRecovery(config={}){
 if(!config||typeof config!=='object'||Array.isArray(config))return {...normalizeBridgeRecovery(),enabled:false};
 const finite=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
 return {enabled:config.enabled===undefined||config.enabled===true,timeoutMs:finite(config.timeoutMs,90000,30000,900000),
  maxRestarts:Math.floor(finite(config.maxRestarts,2,1,2)),windowMs:600000};
}

// This policy consumes the bridge's own status only. It never opens QQ files,
// reads message history or restarts QQ, SnowLuma or DSH.
export function createBridgeRecovery({state={},save=()=>{},...config}={}){
 if(!state||typeof state!=='object')state={};
 const policy=normalizeBridgeRecovery(config);
 const current={version:1,attempts:(Array.isArray(state.attempts)?state.attempts:[]).filter(x=>Number.isFinite(x)&&x>0),
  failureSince:null,lastProbeAt:null,limited:false,lastVerdict:'unknown',deliberateInhibit:state.deliberateInhibit===true,...policy};
 const persist=()=>save(structuredClone(current));
 return {observe({now=Date.now(),probe,enabled=policy.enabled}={}){
  const gap=Number.isFinite(current.lastProbeAt)&&(now-current.lastProbeAt>30000||now<current.lastProbeAt);
  if(gap)current.failureSince=null;
  current.lastProbeAt=now;
  current.enabled=enabled;
  current.attempts=current.attempts.filter(at=>now-at<policy.windowMs);
  const health=classifyBridge(probe),data=probe?.data;
  if(probe?.reachable===true&&probe?.status===200){
   if(data?.socialV2Paused===true||['closed','closed-agent'].includes(data?.mode))current.deliberateInhibit=true;
   else if(data?.socialV2Paused===false&&typeof data?.mode==='string')current.deliberateInhibit=false;
  }
  current.lastVerdict=health.verdict;
  const permitted=new Set(['console_unreachable','dsh_unavailable','qq_disconnected','qq_offline','upstream_degraded','transport_stale']);
  if(!enabled || current.deliberateInhibit || health.healthy || !permitted.has(health.verdict)){
   current.failureSince=null;current.limited=false;persist();
   return {action:'none',reason:health.verdict};
  }
  current.failureSince??=now;
  if(now-current.failureSince<policy.timeoutMs){persist();return {action:'none',reason:health.verdict,deadline:current.failureSince+policy.timeoutMs};}
  if(current.attempts.length>=policy.maxRestarts){
   const first=!current.limited;current.limited=true;persist();
   return {action:first?'blocked':'none',reason:'restart_budget_exhausted',attempts:current.attempts.length};
  }
  // Persist the attempt before executing a restart, so crashes cannot erase
  // the budget and create an unbounded restart loop.
  current.attempts.push(now);current.failureSince=null;current.limited=false;persist();
  return {action:'restart',target:'bridge',reason:health.verdict,attempts:current.attempts.length,timeoutMs:policy.timeoutMs};
 },snapshot:()=>structuredClone(current)};
}

export async function restartBridgeChild({child,requestGraceful,sleep,now=Date.now,timeoutMs=5000,isCurrent=()=>true}){
 if(!isCurrent() || !child || child.exitCode!==null || child.signalCode!==null)return false;
 let accepted=false;
 try{accepted=await requestGraceful()===true;}catch{}
 if(accepted){
  const until=now()+timeoutMs;
  while(child.exitCode===null&&child.signalCode===null&&now()<until)await sleep(100);
 }
 if(isCurrent()&&child.exitCode===null&&child.signalCode===null)child.kill();
 return true;
}
