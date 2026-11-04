import { isAdminToolName } from '../../src/tools/admin-policy.js';
import { WHALE_MCP_SERVERS } from '../../src/tools/servers.js';
const excludedPrefixes = [...WHALE_MCP_SERVERS.filter(server=>server.audience==='admin').map(server=>`mcp__${server.name}__`), 'mcp__playwright__'];

const alwaysDenied = [
  'mcp__snowluma-host__snowluma_status',
  'mcp__bridge-health__bridge_health',
  'snowluma_status',
  'bridge_health',
];

// Re-evaluate after MCP's tools/list changes. Execution guards alone leave unwanted schemas visible.
export function installWhaleToolVisibility(ctx) {
  const restricted=new Set();
  let applying=false;
  const refresh=()=>{
    if(applying)return;
    applying=true;
    try {
      const names = new Set([...alwaysDenied, ...(ctx.tools.schemas?.() || []).map(tool => tool.name)]);
      for (const name of names) {
        if (restricted.has(name) || (!alwaysDenied.includes(name) && !isAdminToolName(name) && !excludedPrefixes.some(prefix => name.startsWith(prefix)))) continue;
        try { ctx.tools.restrict({ deny: [name] }); restricted.add(name); } catch {}
      }
    }finally{applying=false;}
  };
  refresh();
  ctx.on?.('tools/change',refresh);
}
