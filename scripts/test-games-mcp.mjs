import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gamesRules = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/qq-components/tool-games/games.json'), 'utf8'));
const rolePrompt = fs.readFileSync(path.join(ROOT, 'roles/AI助手.md'), 'utf8');
const governancePrompt = fs.readFileSync(path.join(ROOT, 'plugins/qq-components/gov-policy/plugin.json'), 'utf8');
assert.equal(gamesRules.games.find(g=>g.id==='spark').name,'轻微电流');
assert.match(gamesRules.sparkPrompt,/无需预先/);assert.doesNotMatch(rolePrompt.split('\n').find(line=>line.includes('挨电/被电'))||'',/仅参与者本人明确愿意|第三人不能代替同意/);assert.doesNotMatch(governancePrompt,/同意限制/);assert.match(rolePrompt,/Games MCP/);assert.match(governancePrompt,/Games MCP/);
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
  assert.match(descriptions.games_start,/无需预先确认/);assert(!tools.find(t=>t.name==='games_start').inputSchema.properties.consentConfirmed);assert.match(descriptions.games_action,/bodyPart.*durationSec.*intensityLevel.*waveform/);
  assert.match(descriptions.games_action, /拒绝|停止/);

  const catalog = await client.callTool({ name: 'games_catalog', arguments: {} });
  const catalogResult = JSON.parse(catalog.content[0].text);
  assert.equal(catalogResult.games.length, 3);

  const spark = await client.callTool({ name: 'games_start', arguments: { gameId: 'spark' } });
  const sparkResult = JSON.parse(spark.content[0].text);
  assert.equal(sparkResult.ok, true);
  const sparkAction = await client.callTool({ name: 'games_action', arguments: { sessionId: sparkResult.sessionId, action: 'spark',payload:{bodyPart:'前臂',durationSec:4,intensityLevel:3,waveform:'rampDown'} } });
  assert.equal(JSON.parse(sparkAction.content[0].text).ok,true);assert.equal(JSON.parse(sparkAction.content[0].text).fictionalEffect.bodyPart,'前臂');
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
