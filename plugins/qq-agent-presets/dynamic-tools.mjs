// Selection only narrows the already permission-filtered assembly. Execution
// continues through the original registry and its authorization guards.
const CORE=new Set(['qq_reply_contents','qq_send_message','qq_reply','qq_get_unread_messages','qq_get_recent_messages','qq_get_message_detail','qq_report_message_receipts','qq_mark_read','qq_wait_for_messages','qq_wait_for_quiet','qq_select_tools']);
const SELECT_COMPAT='mcp__snowluma__qq_select_tools';
const short=name=>name.split('__').at(-1);
export function selectChatTools(tools,selected=new Set(),{key=''}={}) {
 return tools.filter(tool=>tool.name!==SELECT_COMPAT&&(selected.has(tool.name)||(CORE.has(short(tool.name))&&!(key.startsWith('private:')&&short(tool.name)==='qq_reply'))));
}
function category(tool){
 const name=tool.name.toLowerCase(),raw=short(name);
 if(/magpie/.test(name))return '共享记忆';
 if(/memory|profile|diary|affair|task_note|interest|slang|alias/.test(raw))return '记忆与档案';
 if(/image|sticker|meme|voice|audio|media/.test(raw))return '图片表情与语音';
 if(/bili|youtube/.test(name))return '视频资料';
 if(/campus|ustc/.test(name))return '校园与网页监管';
 if(/games?/.test(name))return '互动游戏';
 if(/web_|search_web|fetch_url/.test(raw))return '联网检索';
 if(/^qq_(?:task_|schedule|remind|worklog)/.test(raw))return '独立任务与定时';
 if(/^qq_.*(?:group|member|ban|notice)/.test(raw))return '群管理';
 if(/^qq_/.test(raw))return 'QQ社交';
 if(/^(?:fs_|file_|read_file|write_file|glob|grep|pwsh|shell|exec_)/.test(raw))return '本机文件与命令';
 if(/job|task|team|agent|goal|todo|plan/.test(raw))return '任务与工作流';
 if(/plugin|cordis|settings|config|credential|context/.test(raw))return '插件与配置';
 return '其他能力';
}
export function searchChatTools(available,query){
 const terms=String(query||'').toLowerCase().split(/[\s,，]+/).filter(Boolean);
 return available.filter(t=>terms.some(term=>(t.name+' '+t.description+' '+category(t)).toLowerCase().includes(term))).slice(0,12);
}
export function buildToolDirectory(tools){
 const groups=new Map();for(const tool of tools){const label=category(tool);if(!groups.has(label))groups.set(label,[]);groups.get(label).push(tool);}
 return '【按需工具目录】常用聊天工具已有完整参数。其他能力按类别或准确名字用 qq_select_tools 加载；加载只展开参数，不执行、不增加权限。以下仅列类别、数量和少量名字示例；未列出的工具仍可按名字或描述关键词查找。\n'+[...groups].map(([label,list])=>{
  const examples=list.map(t=>short(t.name)).filter(name=>name.length<=36).slice(0,3);
  return label+'（'+list.length+'）：'+(examples.join('、')||'按类别查询');
 }).join('\n');
}
export function installDynamicChatTools(ctx,{contextFor=()=>({})}={}){
 if(!ctx.tools?.register)return;
 const states=new WeakMap(),stateFor=agent=>{if(!states.has(agent))states.set(agent,{available:[],selected:new Set()});return states.get(agent);};
 const selector={name:'qq_select_tools',description:'按名字或关键词加载工具。工具目录已列于系统上下文；加载后下一次请求提供完整参数。不会执行所选工具。',parameters:{type:'object',properties:{query:{type:'string',description:'完整工具名，或空格分隔的关键词'}},required:['query'],additionalProperties:false},output:{schema:{type:'object',properties:{loaded:{type:'array',items:{type:'string'}}},required:['loaded'],additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(args,exec){
  if(!exec.agent)return {loaded:[]};
  const state=stateFor(exec.agent),matches=searchChatTools(state.available,args?.query);
  for(const tool of matches)state.selected.add(tool.name);
  return {loaded:matches.map(t=>t.name)};
 }};
 ctx.tools.register(selector);
 // Some existing sessions prepend the MCP namespace. Resolve that exact old
 // spelling through the same permission-filtered selector, without another schema.
 ctx.tools.register({...selector,name:SELECT_COMPAT});
 ctx.on('agent/status',({agent,status})=>{if(status==='idle')states.delete(agent);});
 ctx.on('system-prompt/assemble',async(_assembly,scope,next)=>{
  const result=await next();if(!scope.agent)return result;
  const state=stateFor(scope.agent);state.available=result.tools.filter(t=>t.name!==SELECT_COMPAT);
  const tools=selectChatTools(result.tools,state.selected,contextFor(scope.agent)||{}),hidden=state.available.filter(t=>!tools.includes(t));
  if(!hidden.length)return {...result,tools};
  const text=buildToolDirectory(hidden);
  return {...result,tools,sections:[...result.sections,{name:'whale:tool-directory',text,interpolate:false}]};
 });
}
