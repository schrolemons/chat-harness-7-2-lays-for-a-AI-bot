export const name='memory-tool-restrict';
export const inject=['tools'];
export function apply(ctx){
 ctx.tools.restrict({allow:[]});
 ctx.tools.guard(()=> '记忆整理代理只产出草稿，不能调用工具、发送QQ或派发其他代理。');
 ctx.on('agent/pre-step',async(_payload,next)=>{
  const result=await next();
  // Workspace coding instructions are injected separately from system prompt
  // sections. A data-only worker must not inherit that second instruction path.
  return {...result,messages:result.messages.filter(m=>!['agent-instructions','skill-catalog'].includes(m.source?.kind))};
 },{prepend:true});
 ctx.on('system-prompt/assemble',async(_assembly,_scope,next)=>{
  const result=await next();return {...result,tools:[],contexts:[]};
 },{prepend:true});
}
