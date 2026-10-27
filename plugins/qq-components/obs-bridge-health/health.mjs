// Invoked only by the local CLI/MCP process; the plugin hook itself does no I/O.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export function resolveConsoleToken(root=ROOT,cfg={}){
 const configured=String(cfg.consoleToken??'').trim();
 const valid=t=>t.length>=16&&t.length<=128&&/^[A-Za-z0-9_-]+$/.test(t);
 if(valid(configured))return configured;
 try{const saved=fs.readFileSync(path.join(root,'state','console-token'),'utf8').trim();return valid(saved)?saved:'';}catch{return '';}
}
export function classifyBridge({reachable,status,data}={}){
 const result={observedAt:new Date().toISOString(),verdict:'unknown',healthy:false,needsRestart:false,components:{console:'unknown',dsh:'unknown',qqTransport:'unknown',qqAccount:'unknown',upstream:'unknown'},reason:'状态缺少必要字段，无法判断；不要把未知当掉线。',nextAction:'read_current_status'};
 if(reachable===false){result.verdict='console_unreachable';result.components.console='unreachable';result.reason='本机控制台未响应；先检查监听、锁与运行进程，不能据此断言 DSH 或 QQ 本身离线。';result.nextAction='inspect_process_and_endpoint';return result;}
 if(reachable!==true)return result;
 result.components.console='reachable';
 if(status===401||status===403){result.verdict='auth_required';result.reason='控制台已响应，但诊断请求未通过鉴权；这不是桥接断线。';result.nextAction='fix_diagnostic_auth';return result;}
 if(status!==200){result.reason='控制台返回非成功响应；先检查本机地址与请求状态。';return result;}
 const sl=data?.snowluma;
 if(typeof data?.dshReady!=='boolean'||!sl||typeof sl.connected!=='boolean')return result;
 Object.assign(result.components,{console:'ok',dsh:data.dshReady?'ready':'unavailable',qqTransport:sl.connected?'connected':'disconnected',qqAccount:sl.accountOnline===true?'online':sl.accountOnline===false?'offline':'unknown',upstream:sl.good===true?'good':sl.good===false?'degraded':'unknown'});
 if(!data.dshReady){result.verdict='dsh_unavailable';result.reason='桥接在线，但 DSH 探活未就绪；检查当前动态地址与认证，不重启正常的 QQ 网关。';result.nextAction='check_dsh_endpoint_and_auth';}
 else if(!sl.connected){result.verdict='qq_disconnected';result.reason='DSH 正常，桥接到 QQ 网关的 WebSocket 未连接；只排查 QQ 网关连接。';result.nextAction='inspect_qq_transport';}
 else if(sl.accountOnline===false){result.verdict='qq_offline';result.reason='QQ 网关连接正常，但账号离线；由机主检查 QQ 登录状态。';result.nextAction='owner_check_qq_login';}
 else if(sl.good===false||sl.degraded===true){result.verdict='upstream_degraded';result.reason='桥接与 DSH 在线，但 QQ 上游接收路径报告退化；重启 bridge 不能证明能修复该上游问题。';result.nextAction='inspect_upstream_health';}
 else if(sl.silent===true||(Number.isFinite(sl.lastPacketAgoMs)&&sl.lastPacketAgoMs>90000)){result.verdict='transport_stale';result.reason='连接标志仍在，但 QQ 心跳/事件已超时；先复查连接看门狗与网关状态。';result.nextAction='recheck_heartbeat';}
 else if(sl.accountOnline===true&&sl.good===true){result.verdict='ready';result.healthy=true;result.reason='控制台、DSH、QQ 连接、账号与上游心跳均正常。没有新聊天或 DSH 事件流空闲不等于断线；模型额度或业务任务报错应单独排查。';result.nextAction='none';}
 return result;
}
export async function readBridgeHealth({root=ROOT,fetchFn=fetch,timeoutMs=3000}={}){
 let cfg;try{cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,''));}catch{return {...classifyBridge({}),reason:'本地配置无法读取或解析；先检查文件权限和 JSON。',nextAction:'check_config_permissions'};}
 const port=Number(cfg.consolePort)||3100;if(!Number.isInteger(port)||port<1||port>65535)throw Error('INVALID_CONSOLE_PORT');
 const token=resolveConsoleToken(root,cfg);let r;
 try{r=await fetchFn('http://127.0.0.1:'+port+'/api/status',{headers:token?{'x-console-token':token}:{},signal:AbortSignal.timeout(timeoutMs),redirect:'manual'});}
 catch(error){return {...classifyBridge({reachable:false,status:0}),errorCode:error.cause?.code||error.name||'NETWORK_ERROR'};}
 let data=null;
 if(r.ok)try{data=await r.json();}catch{return {...classifyBridge({reachable:true,status:r.status}),reason:'控制台已响应，但返回内容不是有效状态 JSON；证据不足，不重复启动。',errorCode:'INVALID_STATUS_BODY'};}
 return classifyBridge({reachable:true,status:r.status,data});
}
