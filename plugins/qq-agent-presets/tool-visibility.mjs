import { WHALE_MCP_SERVERS } from '../../src/tools/servers.js';
const excludedPrefixes = [...WHALE_MCP_SERVERS.filter(server=>server.audience==='admin').map(server=>`mcp__${server.name}__`), 'mcp__playwright__'];

// Re-evaluate after MCP's tools/list changes. Execution guards alone leave unwanted schemas visible.
export function installWhaleToolVisibility(ctx) {
  const restricted=new Set();
  let applying=false;
  const refresh=()=>{
    if(applying || typeof ctx.tools.schemas!=='function')return;
    applying=true;
    try {
      for(const tool of ctx.tools.schemas()) {
        if(!excludedPrefixes.some(prefix=>tool.name.startsWith(prefix)) || restricted.has(tool.name))continue;
        try{ctx.tools.restrict({deny:[tool.name]});restricted.add(tool.name);}catch{}
      }
    }finally{applying=false;}
  };
  refresh();
  ctx.on?.('tools/change',refresh);
}
