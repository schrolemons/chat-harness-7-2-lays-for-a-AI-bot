// Isolated official-runtime integration; no profiles, conversations, or QQ peers.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createInstanceScope } from '../src/dsh-instance-scope.mjs';

// Use the pinned development host by default; an explicit host root can override it.
const hostPackage = process.env.DSH_HOST_ROOT
  ? path.resolve(process.env.DSH_HOST_ROOT, 'package.json')
  : createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
const anchor = pathToFileURL(hostPackage).href;
const requireHost = createRequire(anchor);
const imp = name => import(pathToFileURL(requireHost.resolve('@deepseek-ai/' + name)).href);
const [{ Context }, { default: Prompt }, { default: Tools }, { default: Loader }, { default: Projections }, { default: Registry }, MCP, scopeApi] = await Promise.all([
  'cordis', 'dsh-system-prompt', 'dsh-tools', 'cordis-plugin-loader', 'dsh-session-projection', 'dsh-agent-preset-registry', 'dsh-mcp-client', 'dsh-scope',
].map(imp));
const calls = [];
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  if (request.id === undefined) { res.writeHead(202).end(); return; }
  let result = {};
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
  if (request.method === 'tools/list') result = { tools: ['probe', 'blocked'].map(name => ({ name, description: 'synthetic', inputSchema: { type: 'object' } })) };
  if (request.method === 'tools/call') { calls.push(req.url); result = { content: [{ type: 'text', text: req.url }] }; }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const contexts = [];
async function makeHost() {
  const root = new Context(); contexts.push(root);
  await root.plugin(Prompt, {}); await root.plugin(Tools, {});
  await root.plugin(Loader, { baseUrl: anchor }); await root.plugin(Projections);
  await root.plugin(Registry, { default: 'ordinary' });
  let ctx;
  await root.plugin({ inject: ['tools', 'loader', 'agentPresets'], apply(owner) { ctx = owner; } });
  await root.fiber.await();
  ctx.loader.builtins['fixture-restrict'] = { inject: ['tools'], apply(child, config) {
    assert.equal(config.entry, 'restrict', 'expressions must resolve in child context, after wrapper binds');
    assert.ok(scopeApi.scopeParentOf(scopeApi.scopeOf(child)));
    child.tools.restrict({ allow: ['mcp__snowluma__probe'] });
  } };
  return ctx;
}
const definitions = [{ id: 'chat', name: 'Chat', plugins: [{ id: 'restrict', name: 'cordis:fixture-restrict', config: { entry: { __jsExpr: 'fiber.entry.options.id' } } }] }];
const originalDefinitions = structuredClone(definitions);
const options = (instanceId, extra = {}) => ({ instanceId, root: path.resolve('synthetic', instanceId), label: instanceId, definitions, ...extra });
const connect = (ctx, endpoint) => ctx.plugin(MCP, { transport: 'streamable-http', serverName: 'snowluma', url: `http://127.0.0.1:${server.address().port}/${endpoint}`, failOnStartupError: true, reconnect: { enabled: false } });
try {
  const owner = await makeHost();
  await connect(owner, 'external');
  const beforeBuiltins = Object.keys(owner.loader.builtins);
  const a = await createInstanceScope(owner, options('public'));
  const b = await createInstanceScope(owner, options('private', { presetIdMap: { chat: 'legacy-chat' } }));
  assert.equal(a.presetMap.chat, 'public:chat'); assert.equal(b.presetMap.chat, 'legacy-chat');
  assert.deepEqual(definitions, originalDefinitions);
  await assert.rejects(createInstanceScope(owner, options('public')), /active/i);
  await connect(a.ctx, 'public'); await connect(b.ctx, 'private');
  a.activate(); b.activate();
  assert.ok((await owner.agentPresets.list()).every(row => !row.broken));
  async function agentFor(id) {
    const agent = { id: 'synthetic-' + id };
    const scope = scopeApi.createScope(owner, agent); agent.ctx = scope.ctx;
    await owner.agentPresets.mount(scope.ctx, id);
    assert.deepEqual(owner.tools.schemas(agent).map(tool => tool.name), ['mcp__snowluma__probe']);
    return { agent, scope };
  }
  const aa = await agentFor(a.presetMap.chat), bb = await agentFor(b.presetMap.chat);
  const run = (agent, name = 'probe') => owner.tools.execute({ callId: 'fixture', name: 'mcp__snowluma__' + name, arguments: {}, agent, signal: new AbortController().signal });
  assert.equal((await run(aa.agent)).isError, false); assert.equal((await run(bb.agent)).isError, false);
  assert.deepEqual(calls, ['/public', '/private']);
  assert.equal((await run(aa.agent, 'blocked')).isError, true);
  await a.dispose(); await a.dispose();
  assert.deepEqual((await owner.agentPresets.list()).map(row => row.id), ['legacy-chat']);
  assert.equal((await run(aa.agent)).isError, true); assert.equal(calls.length, 2);
  assert.throws(() => a.activate(), /disposed/i);
  await assert.rejects(createInstanceScope(owner, options('public', { root: path.resolve('different') })), /root/i);
  const restored = await createInstanceScope(owner, options('public'));
  assert.equal((await run(aa.agent)).isError, true, 'reenable stays closed until caller connects MCP and activates');
  await connect(restored.ctx, 'public2'); restored.activate();
  assert.equal((await run(aa.agent)).isError, false); assert.equal(calls.at(-1), '/public2');
  assert.equal((await run(bb.agent)).isError, false); assert.equal(calls.at(-1), '/private');
  const ordinary = { id: 'ordinary' }; ordinary.ctx = scopeApi.createScope(owner, ordinary).ctx;
  assert.equal((await run(ordinary)).isError, false); assert.equal(calls.at(-1), '/external');
  const otherOwner = await makeHost();
  const other = await createInstanceScope(otherOwner, options('public'));
  await other.dispose();
  // Duplicate preset rollback never unregisters the existing private definition.
  await assert.rejects(createInstanceScope(owner, options('collision', { definitions: [{ id: 'first', plugins: [] }, { id: 'second', plugins: [] }], presetIdMap: { second: 'legacy-chat' } })), /Duplicate agent preset/);
  assert.deepEqual((await owner.agentPresets.list()).map(row => row.id).sort(), ['legacy-chat', 'public:chat']);
  const retry = await createInstanceScope(owner, options('collision', { definitions: [] })); await retry.dispose();
  let releaseImports;
  const importGate = new Promise(resolve => { releaseImports = resolve; });
  const pending = createInstanceScope(owner, options('concurrent', { definitions: [], hostImport: async name => { await importGate; return imp(name.replace('@deepseek-ai/', '')); } }));
  await assert.rejects(createInstanceScope(owner, options('concurrent', { definitions: [] })), /active/i);
  releaseImports(); await (await pending).dispose();
  await assert.rejects(createInstanceScope(owner, options('failed-import', { hostImport: async () => { throw new Error('fixture import failed'); } })), /fixture import failed/);
  const recovered = await createInstanceScope(owner, options('failed-import', { definitions: [] })); await recovered.dispose();
  let instanceOwner;
  const ownerFiber = owner.plugin({ inject: ['tools', 'loader', 'agentPresets'], apply(ctx) { instanceOwner = ctx; } });
  await ownerFiber;
  const automatic = await createInstanceScope(instanceOwner, options('automatic'));
  await connect(automatic.ctx, 'automatic'); automatic.activate();
  const retained = await agentFor(automatic.presetMap.chat);
  assert.equal((await run(retained.agent)).isError, false);
  await ownerFiber.dispose();
  assert.equal((await run(retained.agent)).isError, true, 'owner teardown must close retained agents');
  assert.equal((await run(ordinary)).isError, false); assert.equal(calls.at(-1), '/external');
  await retained.scope.dispose();
  assert.ok(!(await owner.agentPresets.list()).some(row => row.id === automatic.presetMap.chat), 'owner disposal unregisters own presets');
  await restored.dispose(); await b.dispose();
  await aa.scope.dispose(); await bb.scope.dispose();
  assert.deepEqual(Object.keys(owner.loader.builtins), beforeBuiltins, 'retained wrapper registrations reclaimed after last old agent exits');
  console.log('PASS scoped MCP isolation, restrictions, expression context, closed guard, retained-agent restore, rollback, root isolation and owned cleanup');
} finally {
  for (const ctx of contexts.reverse()) await ctx.fiber.dispose();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
