export const name='learning-tool-restrict';
export const inject=['tools'];
const allowed=name=>/^(?:web_search|web_fetch|mcp__web-search-safe__(?:web_search|web_fetch))$/.test(name);
export function apply(ctx){
  const hidden=new Set();
  const hide=()=>{for(const {name} of ctx.tools.schemas()){
    if(allowed(name)||hidden.has(name))continue;
    hidden.add(name);try{ctx.tools.restrict({deny:[name]});}catch{}
  }};
  ctx.tools.guard(call=>allowed(String(call?.name||''))?undefined:'知识学习会话仅允许公开联网检索，不进行聊天收发、本机操作或跨会话通信。');
  ctx.on('tools/change',hide);hide();
}
