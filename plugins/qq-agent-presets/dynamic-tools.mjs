// Selection only narrows the already permission-filtered assembly. Execution
// continues through the original registry and its authorization guards.
const CORE=new Set(['qq_reply_contents','qq_send_message','qq_reply','qq_get_unread_messages','qq_get_recent_messages','qq_get_message_detail','qq_report_message_receipts','qq_mark_read','qq_wait_for_messages','qq_wait_for_quiet','qq_select_tools']);
const short=name=>name.split('__').at(-1);
export function selectChatTools(tools,selected=new Set()) {
 return tools.filter(tool=>CORE.has(short(tool.name))||selected.has(tool.name));
}
export function installDynamicChatTools(ctx){
 if(!ctx.tools?.register)return;
 const states=new WeakMap(),stateFor=agent=>{if(!states.has(agent))states.set(agent,{available:[],selected:new Set()});return states.get(agent);};
 ctx.tools.register({name:'qq_select_tools',description:'按名字或关键词加载工具。工具目录已列于系统上下文；加载后下一次请求提供完整参数。不会执行所选工具。',parameters:{type:'object',properties:{query:{type:'string',description:'完整工具名，或空格分隔的关键词'}},required:['query'],additionalProperties:false},output:{schema:{type:'object',properties:{loaded:{type:'array',items:{type:'string'}}},required:['loaded'],additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(args,exec){
  if(!exec.agent)return {loaded:[]};
  const state=stateFor(exec.agent),terms=String(args?.query||'').toLowerCase().split(/[\s,，]+/).filter(Boolean);
  const matches=state.available.filter(t=>terms.some(term=>(t.name+' '+t.description).toLowerCase().includes(term))).slice(0,12);
  for(const tool of matches)state.selected.add(tool.name);
  return {loaded:matches.map(t=>t.name)};
 }});
 ctx.on('agent/status',({agent,status})=>{if(status==='idle')states.delete(agent);});
 ctx.on('system-prompt/assemble',async(_assembly,scope,next)=>{
  const result=await next();if(!scope.agent)return result;
  const state=stateFor(scope.agent);state.available=result.tools;
  const tools=selectChatTools(result.tools,state.selected),hidden=result.tools.filter(t=>!tools.includes(t));
  if(!hidden.length)return result;
  const text='【按需工具目录】常用聊天工具已提供完整参数。其他工具先用 qq_select_tools(query="工具名或关键词") 加载，下一次请求即可调用。目录不授予额外权限。\n'+hidden.map(t=>t.name+'：'+String(t.description||'').split('\n')[0].slice(0,70)).join('\n');
  return {...result,tools,sections:[...result.sections,{name:'whale:tool-directory',text,interpolate:false}]};
 });
}
