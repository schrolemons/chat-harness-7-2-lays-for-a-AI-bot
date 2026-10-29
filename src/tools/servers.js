// Whale-owned MCP processes. DSH built-ins and browser/OS tools are not registered here.
export const WHALE_MCP_SERVERS = [
  { id:'mcp-snowluma', name:'snowluma', script:'src/mcp-snowluma-safe.js', layer:'T', audience:'qq', toolCallTimeoutMs:725000 },
  { id:'mcp-snowluma-host', name:'snowluma-host', script:'src/mcp-host-server.js', layer:'T', audience:'qq' },
  { id:'mcp-web-search-safe', name:'web-search-safe', script:'src/mcp-web-search-safe.js', layer:'T', audience:'qq' },
  { id:'mcp-games', name:'games', script:'src/mcp-games.mjs', layer:'T', audience:'qq' },
  { id:'mcp-schnie-private-phi', name:'schnie-private-phi', script:'plugins/qq-components/schnie-core/mcp.mjs', layer:'S', audience:'qq' },
  { id:'mcp-bridge-health', name:'bridge-health', script:'src/mcp-bridge-health.mjs', layer:'O', audience:'admin' },
  { id:'mcp-codex-peer', name:'codex-peer', script:'plugins/qq-components/tool-codex-chat/src/mcp-server.mjs', layer:'T', audience:'admin', toolCallTimeoutMs:30000 },
];
