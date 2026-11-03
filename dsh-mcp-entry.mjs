import path from 'node:path';import {fileURLToPath} from 'node:url';import {browserMcpArgs} from './scripts/browser-mcp-config.mjs';
import {createRequire} from 'node:module';
export const name='qq-bridge-mcp';export const inject=['loader'];
export const BUNDLED_MCP=Object.freeze({
 snowluma:'src/mcp-snowluma-safe.js','snowluma-host':'src/mcp-host-server.js','web-search-safe':'src/mcp-web-search-safe.js',
 games:'src/mcp-games.mjs',playwright:'node_modules/@playwright/mcp/cli.js','bridge-health':'src/mcp-bridge-health.mjs','personal-core':'plugins/qq-components/personal-core/mcp.mjs'
});
export async function apply(ctx,config={}){
 const script=BUNDLED_MCP[config.serverName];if(!script)throw Error('Unknown bundled MCP: '+config.serverName);
 const root=path.dirname(fileURLToPath(import.meta.url));
 // Native DSH/pnpm installs may hoist dependencies beside qq-bridge.
 const entrypoint=config.serverName==='playwright'
  ?path.join(path.dirname(createRequire(import.meta.url).resolve('@playwright/mcp/package.json')),'cli.js')
  :path.join(root,script);
 const module=await ctx.loader.import('@deepseek-ai/dsh-mcp-client',import.meta.url,{});
 // Cordis owns the child's scope. A Fiber is not a plugin cleanup effect.
 await ctx.plugin(ctx.loader.unwrapExports(module),{serverName:config.serverName,transport:'stdio',command:config.nodePath||(process.versions.electron?'node':process.execPath),args:[entrypoint,...(config.serverName==='playwright'?browserMcpArgs(root):[])],...(config.serverName==='snowluma'?{toolCallTimeoutMs:725000}:{})});
}
