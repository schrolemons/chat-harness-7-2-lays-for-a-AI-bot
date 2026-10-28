import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gamesRules = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/qq-components/tool-games/games.json'), 'utf8'));
const rolePrompt = fs.readFileSync(path.join(ROOT, 'roles/小鲸鱼.md'), 'utf8');
const governancePrompt = fs.readFileSync(path.join(ROOT, 'plugins/qq-components/gov-policy/plugin.json'), 'utf8');
assert.ok(gamesRules.sparkSourcePrompt.some(text => text.includes('沿着对方手腕窜上去')));
assert.ok(gamesRules.sparkSourcePrompt.some(text => text.includes('收手就停')));
assert.ok(gamesRules.governanceSourceRule.includes('第三人不能替未表态的目标同意'));
assert.ok(gamesRules.sparkPrompt.includes('第三人不能代替同意'));
assert.doesNotMatch(rolePrompt, /沿着对方手腕窜上去|吓得原地跳一下/);
assert.doesNotMatch(governancePrompt, /沿着对方手腕窜上去|始终是纯虚构、玩具级的文字小火花/);
assert.match(rolePrompt, /Games MCP/);
assert.match(governancePrompt, /Games MCP/);
const client = new Client({ name: 'games-mcp-contract-test', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, 'src/mcp-games.mjs')],
  cwd: ROOT,
  stderr: 'pipe',
});

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map(tool => tool.name).sort();
  assert.deepEqual(names, ['games_action', 'games_catalog', 'games_create', 'games_start', 'games_status', 'games_stop']);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must reject unknown arguments`);
  }
  const descriptions = Object.fromEntries(tools.map(tool => [tool.name, tool.description]));
  assert.match(descriptions.games_start, /consentConfirmed|本人.*同意|本人.*愿意/);
  assert.match(descriptions.games_action, /拒绝|停止/);

  const catalog = await client.callTool({ name: 'games_catalog', arguments: {} });
  const catalogResult = JSON.parse(catalog.content[0].text);
  assert.equal(catalogResult.games.length, 3);

  const refused = await client.callTool({ name: 'games_start', arguments: { gameId: 'spark' } });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /CONSENT_REQUIRED/);

  const spark = await client.callTool({ name: 'games_start', arguments: { gameId: 'spark', consentConfirmed: true } });
  const sparkResult = JSON.parse(spark.content[0].text);
  assert.equal(sparkResult.ok, true);
  const sparkAction = await client.callTool({ name: 'games_action', arguments: { sessionId: sparkResult.sessionId, action: 'spark' } });
  assert.equal(JSON.parse(sparkAction.content[0].text).ok, true);
  const sparkStatus = await client.callTool({ name: 'games_status', arguments: { sessionId: sparkResult.sessionId } });
  assert.equal(JSON.parse(sparkStatus.content[0].text).gameId, 'spark');
  const sparkStop = await client.callTool({ name: 'games_stop', arguments: { sessionId: sparkResult.sessionId } });
  assert.equal(JSON.parse(sparkStop.content[0].text).ok, true);

  const dice = await client.callTool({ name: 'games_start', arguments: { gameId: 'dice' } });
  const diceId = JSON.parse(dice.content[0].text).sessionId;
  const roll = await client.callTool({ name: 'games_action', arguments: { sessionId: diceId, action: 'roll' } });
  assert.ok(JSON.parse(roll.content[0].text).roll >= 1);

  const riddle = await client.callTool({ name: 'games_start', arguments: { gameId: 'riddle' } });
  const riddleId = JSON.parse(riddle.content[0].text).sessionId;
  const answer = await client.callTool({ name: 'games_action', arguments: { sessionId: riddleId, action: 'answer', answer: '影子' } });
  assert.equal(JSON.parse(answer.content[0].text).correct, true);

  console.log('Games MCP handshake and multi-tool state flow passed (6 tools; built-in and custom games).');
} finally {
  try { await client.close(); } catch {}
}
