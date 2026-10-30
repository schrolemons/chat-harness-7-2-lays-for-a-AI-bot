// Games MCP (stdio): process-local lightweight text games with fixed, bounded tools.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createGamesRuntime, GAMES_TOOL_DESCRIPTIONS } from '../plugins/qq-components/tool-games/games-runtime.mjs';
import { saveCustomGame } from '../plugins/qq-components/tool-games/games-store.mjs';

export const GAMES_TOOL_SCHEMAS = Object.freeze({
  games_catalog: z.object({}).strict(),
  games_start: z.object({
    gameId: z.string().min(2).max(40).describe('使用games_catalog返回的id；spark为轻微电流'),
  }).strict(),
  games_action: z.object({
    sessionId: z.string().uuid(),
    action: z.string().min(1).max(32),
    answer: z.string().max(80).optional(),
    payload: z.record(z.string(), z.unknown()).optional().describe('spark可含bodyPart、durationSec、intensityLevel、waveform；允许值见games_catalog。其他游戏按其合法动作输入。'),
  }).strict(),
  games_status: z.object({ sessionId: z.string().uuid() }).strict(),
  games_stop: z.object({ sessionId: z.string().uuid() }).strict(),
  games_create: z.object({ definition: z.record(z.string(), z.unknown()) }).strict(),
});

function toMcpResult(result) {
  return { isError: result?.ok !== true, content: [{ type: 'text', text: JSON.stringify(result) }] };
}

export function registerGamesTools(server, runtime = createGamesRuntime()) {
  const handlers = {
    games_catalog: () => runtime.catalog(),
    games_start: input => runtime.start(input),
    games_action: input => runtime.action(input),
    games_status: input => runtime.status(input),
    games_stop: input => runtime.stop(input),
    games_create: input => {
      try { return { ok: true, game: saveCustomGame(input.definition), message: '自定义游戏已校验并保存，默认已启用；可在 console 中调整或删除。' }; }
      catch (error) { return { ok: false, code: 'INVALID_GAME_DEFINITION', error: error.message }; }
    },
  };
  for (const [name, inputSchema] of Object.entries(GAMES_TOOL_SCHEMAS)) {
    server.registerTool(name, { description: GAMES_TOOL_DESCRIPTIONS[name], inputSchema }, async input => toMcpResult(handlers[name](input)));
  }
  return runtime;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = new McpServer({ name: 'games', version: '0.1.0' });
  registerGamesTools(server);
  await server.connect(new StdioServerTransport());
}
