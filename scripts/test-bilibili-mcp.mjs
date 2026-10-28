import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { registerBilibiliTools, biliResultToMcp } from '../src/mcp-bilibili-tools.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const namesExpected = ['bili_analyze_video', 'bili_search', 'bili_video_content', 'bili_video_frames', 'bili_video_info'];

const registered = new Map();
const server = { registerTool: (name, config, handler) => registered.set(name, { config, handler }) };
const agentCalls = [];
registerBilibiliTools(server, { enabled: true, agentApi: async (...args) => {
  agentCalls.push(args);
  return { ok: true, result: { status: 'ok', contactSheets: [{ range: { startSeconds: 0, endSeconds: 3 }, frameTimestamps: [1, 2], columns: 2, rows: 1, base64: 'AQID', bytes: 3 }] } };
} });
assert.deepEqual([...registered.keys()].sort(), namesExpected);
const frameTool = registered.get('bili_video_frames');
const validInput = frameTool.config.inputSchema.parse({ token: 'session-token', video: 'BV1xx411c7mD' });
const frameResult = await frameTool.handler(validInput);
assert.equal(frameResult.content.filter(part => part.type === 'image').length, 1);
assert.match(frameResult.content[0].text, /1s.*2s/);
assert.ok(!frameResult.content[0].text.includes('AQID'));
assert.ok(agentCalls[0][1].timeoutMs > 180_000, 'FFmpeg-backed frame calls need an MCP timeout above the 180-second FFmpeg limit');

const analyzeTool = registered.get('bili_analyze_video');
await analyzeTool.handler(analyzeTool.config.inputSchema.parse({ token: 'session-token', video: 'BV1xx411c7mD' }));
assert.ok(agentCalls[1][1].timeoutMs > 180_000, 'full video analysis must retain the extended MCP timeout');

const infoTool = registered.get('bili_video_info');
await infoTool.handler(infoTool.config.inputSchema.parse({ token: 'session-token', video: 'BV1xx411c7mD' }));
assert.equal(agentCalls[2][1].timeoutMs, undefined, 'metadata calls should keep the short default timeout');

const disabled = new Map();
registerBilibiliTools({ registerTool: (name, config, handler) => disabled.set(name, { config, handler }) }, { enabled: false, agentApi: async () => ({}) });
assert.equal(disabled.size, 0);

const failed = biliResultToMcp({ status: 'error', code: 'RATE_LIMITED', error: '稍后重试' });
assert.equal(failed.isError, true);
assert.match(failed.content[0].text, /RATE_LIMITED/);

// MCP stdio registration contract: this only starts the local server and lists tools; it calls no Bilibili endpoint.
const client = new Client({ name: 'bilibili-tool-contract-test', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src/mcp-snowluma-safe.js')], cwd: ROOT, stderr: 'pipe' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const biliTools = tools.filter(tool => tool.name.startsWith('bili_'));
  assert.deepEqual(biliTools.map(tool => tool.name).sort(), namesExpected);
  for (const tool of biliTools) {
    assert.ok(tool.inputSchema.required.includes('token'));
    for (const unsafeField of ['url', 'path', 'command', 'ffmpegPath', 'cookie']) assert.ok(!Object.hasOwn(tool.inputSchema.properties, unsafeField));
  }
  console.log(`Bilibili MCP registration and multimodal contract passed (${biliTools.length} tools).`);
} finally {
  try { await client.close(); } catch {}
}
