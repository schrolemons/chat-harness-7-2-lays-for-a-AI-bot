// Optional local stdio reader. Install into a trusted DSH profile explicitly.
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createPlugin } from './index.js';
import { loadLocalConfig } from './config.mjs';

const dir = fileURLToPath(new URL('./', import.meta.url));
const specs = new Map();
const { manifest, config } = loadLocalConfig(dir);
await createPlugin({ dir, config, registerTool: (name, spec) => specs.set(name, spec), addPromptBlock: () => {} });
const server = new Server({ name: 'schnie-private-phi', version: manifest.version }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...specs].map(([name, s]) => ({ name, description: s.description, inputSchema: s.schema })) }));
server.setRequestHandler(CallToolRequestSchema, async req => {
  const name = req.params.name;
  if (!specs.has(name)) throw Error('Unknown SCHNIE tool');
  const { config: currentConfig, disabled } = loadLocalConfig(dir);
  if (disabled) return { isError: true, content: [{ type: 'text', text: 'SCHNIE component is disabled' }] };
  // Refresh configuration and content between calls; do not retain stale CORE rules.
  const handlers = new Map();
  await createPlugin({ dir, config: currentConfig, registerTool: (n, s) => handlers.set(n, s.handler), addPromptBlock: () => {} });
  const result = await handlers.get(name)(req.params.arguments || {});
  return { isError: result.ok === false, content: [{ type: 'text', text: JSON.stringify(result) }] };
});
await server.connect(new StdioServerTransport());
