export function createPlugin(ctx){
 const instructions='【桥接诊断】先调用 mcp__bridge-health__bridge_health（管理端）或在本工程运行 node scripts/bridge-health.mjs --json。ready 就停止连接修复；401/403 是鉴权问题，3080 不一定是当前 DSH 端口，旧错误日志和事件流空闲不能证明现在掉线。不因旧错误反复启动或重启；重启必须先说明影响并等机主同意。';
 ctx.registerTool('bridge_health_help',{description:'获取桥接诊断入口和判断规则；不返回聊天、凭据或系统敏感数据',handler:()=>({ok:true,tool:'mcp__bridge-health__bridge_health',command:'node scripts/bridge-health.mjs --json',rule:instructions})});
 return {hooks:{beforePrompt(p){if(!p?.isOwnerKey)return '';return ['selfReview','selfOptimize'].includes(p.reason)||/桥接|bridge|连不上|掉线|断线|启动失败/i.test(p.incomingText||'')?instructions:'';}}};
}
