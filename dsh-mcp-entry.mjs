import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { browserMcpArgs } from './scripts/browser-mcp-config.mjs';
import { createHostImport } from './src/dsh-host-import.mjs';

export const name = 'qq-bridge-mcp';
export const inject = ['loader'];
export const BUNDLED_MCP = Object.freeze({
  snowluma: 'src/mcp-snowluma-safe.js', 'snowluma-host': 'src/mcp-host-server.js', 'web-search-safe': 'src/mcp-web-search-safe.js',
  games: 'src/mcp-games.mjs', playwright: 'node_modules/@playwright/mcp/cli.js', 'bridge-health': 'src/mcp-bridge-health.mjs', 'personal-core': 'plugins/qq-components/personal-core/mcp.mjs',
});

export async function mountBundledMcp(ctx, { root, serverName, nodePath, env = {}, hostImport } = {}) {
  const script = BUNDLED_MCP[serverName];
  if (!script) throw Error('Unknown bundled MCP: ' + serverName);
  if (!path.isAbsolute(root || '')) throw Error('Bundled MCP requires an explicit absolute instance root');
  if (process.versions.electron && (!path.isAbsolute(nodePath || '') || path.resolve(nodePath).toLowerCase() === path.resolve(process.execPath).toLowerCase())) throw Error('NODE_RUNTIME_REQUIRED: explicit Node executable required under Electron');
  // Source-relative ROOT constants must bind to this installation, not merely cwd.
  const entrypoint = serverName === 'playwright'
    ? path.join(path.dirname(createRequire(path.join(root, 'package.json')).resolve('@playwright/mcp/package.json')), 'cli.js')
    : path.join(root, script);
  if (serverName !== 'playwright') {
    const physicalRoot = await fs.realpath(root), physicalEntry = await fs.realpath(entrypoint);
    const relative = path.relative(physicalRoot, physicalEntry);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw Error('Bundled MCP entrypoint escapes its instance root');
  }
  const module = await createHostImport(ctx, hostImport)('@deepseek-ai/dsh-mcp-client');
  await ctx.plugin(ctx.loader.unwrapExports(module), {
    serverName, transport: 'stdio', command: nodePath || process.execPath,
    args: [entrypoint, ...(serverName === 'playwright' ? browserMcpArgs(root) : serverName === 'personal-core' ? ['--root', root] : [])],
    cwd: root, env: { ...env, QQ_BRIDGE_ROOT: root }, failOnStartupError: true,
    ...(serverName === 'snowluma' ? { toolCallTimeoutMs: 725000 } : {}),
  });
}

export const apply = mountBundledMcp;
