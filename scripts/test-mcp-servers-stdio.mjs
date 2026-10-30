// 模拟 DSH 的 dsh-mcp-client：以 stdio 拉起桥接的 MCP server，握手并列出工具，
// 验证 qq-bridge MCP server 在新版 DSH 环境下仍能被正常接入（不需要 SnowLuma 在线）。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;

const SERVERS = [
  { serverName: 'snowluma', script: 'src/mcp-snowluma-safe.js' },
  { serverName: 'snowluma-host', script: 'src/mcp-host-server.js' },
  { serverName: 'web-search-safe', script: 'src/mcp-web-search-safe.js' },
  { serverName: 'games', script: 'src/mcp-games.mjs' },
];

let failures = 0;
for (const { serverName, script } of SERVERS) {
  const transport = new StdioClientTransport({
    command: NODE,
    args: [path.join(ROOT, script)],
    cwd: ROOT,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'dsh-mcp-probe', version: '0.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    console.log(`✅ ${serverName}: ${names.length} tools`);
    console.log(`   ${names.join(', ')}`);
    // 校验 DSH 的命名契约：mcp__<serverName>__<rawName>
    const bad = names.filter((n) => !/^[A-Za-z0-9_-]{1,64}$/.test(n));
    if (bad.length) { console.log(`   ⚠️ 不符合 DSH 工具名契约: ${bad.join(', ')}`); failures += 1; }
    if (serverName === 'snowluma') {
      const waitTool = tools.find((tool) => tool.name === 'qq_wait_for_messages');
      const required = waitTool?.inputSchema?.required ?? [];
      const quietTool = tools.find((tool) => tool.name === 'qq_wait_for_quiet');
      if (required.includes('purpose') || !quietTool || !(quietTool.inputSchema?.required || []).includes('token')) {
        console.log('   ❌ 等新消息与确认静默必须分开注册，保留会话令牌验证');
        failures += 1;
      }
      const waitDescription = waitTool?.description ?? '';
      if (!waitDescription.includes('不能有待处理来信时') ||
          !waitDescription.includes('endRound') || !quietTool?.description?.includes('不增加或绕过无人回复结束计数')) {
        console.log('   ❌ qq_wait_for_messages 必须说明 messages 仅用于回复完成后交互等待，待处理消息先处理');
        failures += 1;
      }
    }
  } catch (error) {
    console.log(`❌ ${serverName}: ${error?.message ?? error}`);
    failures += 1;
  } finally {
    try { await client.close(); } catch {}
  }
}
console.log(failures === 0 ? '\n全部 MCP server 接入正常' : `\n${failures} 个 MCP server 异常`);
process.exit(failures === 0 ? 0 : 1);
