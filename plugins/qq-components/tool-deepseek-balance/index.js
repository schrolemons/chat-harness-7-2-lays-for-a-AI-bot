const load=relative=>{const url=new URL(relative,import.meta.url);url.search=new URL(import.meta.url).search;return import(url.href);};
const [{createBalanceQuery,resolveApiKey},{createMilkMonitor},{validateMilkPolicy}]=await Promise.all([load('./client.mjs'),load('./monitor.mjs'),load('./milk-stock.mjs')]);
export {resolveApiKey};
export function createPlugin(ctx,options={}){
 const monitor=createMilkMonitor(ctx,{query:createBalanceQuery({...options,signal:ctx.signal}),clock:options.clock});
 ctx.registerTool('deepseek_balance',{description:'只读查询账户余额和最近变化；有效私聊/群聊可查询调用额度档位，管理员私聊另可看账户金额。按当前形态自然反应，不改账户或额度策略。',schema:{type:'object',properties:{},additionalProperties:false},handler:input=>input?.callerKey?monitor.queryFor({key:input.callerKey}):monitor.query()});
 return {validateConfig:validateMilkPolicy,services:{milkStock:{status:()=>monitor.status(),context:payload=>monitor.context(payload),noteStatus:payload=>monitor.noteStatus(payload),noteWritten:payload=>monitor.noteWritten(payload)}},hooks:{onTick:payload=>monitor.tick(payload),afterSend:payload=>monitor.sent(payload)}};
}
