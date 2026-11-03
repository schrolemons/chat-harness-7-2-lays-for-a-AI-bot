// Synthetic installations and the pinned official host only. No QQ/model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeManifest } from '../src/instance-manifest.mjs';
import { claimInstanceRoot } from '../src/instance-descriptor.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostPackage = process.env.DSH_HOST_ROOT ? path.join(process.env.DSH_HOST_ROOT, 'package.json') : createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
const requireHost = createRequire(hostPackage), anchor = pathToFileURL(hostPackage).href;
const hostImport = name => import(pathToFileURL(requireHost.resolve(name)).href);
const [{ Context }, { default: Prompt }, { default: Tools }, { default: Loader }, { default: Projections }, { default: Registry }, MCP, scopeApi] = await Promise.all(
  ['cordis', 'dsh-system-prompt', 'dsh-tools', 'cordis-plugin-loader', 'dsh-session-projection', 'dsh-agent-preset-registry', 'dsh-mcp-client', 'dsh-scope'].map(name => hostImport('@deepseek-ai/' + name)));
const names = ['snowluma', 'snowluma-host', 'web-search-safe', 'games', 'playwright', 'bridge-health', 'personal-core'];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const definitions = [{ id: 'chat', name: 'Chat', plugins: [{ id: 'check', name: 'cordis:fixture-check', config: { entry: { __jsExpr: 'fiber.entry.options.id' } } }] }];
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-controller-'));
  const root = new Context(), calls = [], mounts = [], controls = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    if (request.id === undefined) { res.writeHead(202).end(); return; }
    let result = {};
    if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'synthetic', version: '1' } };
    if (request.method === 'tools/list') result = { tools: [{ name: 'probe', description: 'synthetic', inputSchema: { type: 'object' } }] };
    if (request.method === 'tools/call') { calls.push(req.url); result = { content: [{ type: 'text', text: req.url }] }; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await root.plugin(Prompt); await root.plugin(Tools); await root.plugin(Loader, { baseUrl: anchor });
  await root.plugin(Projections); await root.plugin(Registry, { default: 'ordinary' });
  let owner; await root.plugin({ inject: ['loader', 'tools', 'agentPresets'], apply(ctx) { owner = ctx; } });
  owner.loader.builtins['fixture-check'] = { apply(ctx, config) { assert.equal(config.entry, 'check'); assert.ok(scopeApi.scopeParentOf(scopeApi.scopeOf(ctx))); } };
  owner.loader.builtins['fixture-broken'] = { apply() { throw Error('synthetic broken preset'); } };
  const connect = (ctx, label, serverName) => ctx.plugin(MCP, { transport: 'streamable-http', serverName, url: `http://127.0.0.1:${server.address().port}/${label}/${serverName}`, failOnStartupError: true, reconnect: { enabled: false } });
  async function descriptor(id) {
    const value = { version: 1, instanceId: id, label: id, root: path.join(base, id), dshHome: path.join(base, 'host'), profile: 'synthetic', bundleName: 'synthetic-' + id, entryId: id + '-mode', settingsNamespace: id + '-mode', presetIdMap: {} };
    await fs.mkdir(value.root); await initializeManifest(value.root, value);
    await fs.writeFile(path.join(value.root, '.qq-bridge-instance.json'), JSON.stringify(value));
    return value;
  }
  async function mount(value, extra = {}) {
    const { mountInstanceController } = await import('../src/dsh-instance-controller.mjs');
    let controller;
    const fiber = owner.plugin({ inject: ['loader', 'tools', 'agentPresets'], async apply(ctx) {
      controller = await mountInstanceController(ctx, value, { hostImport, loadDefinitions: async () => structuredClone(definitions), mountMcp: async (scope, options) => { mounts.push([value.instanceId, options.serverName]); await connect(scope, value.instanceId, options.serverName); }, mountTitles: async () => {}, ...extra });
      return () => controller.dispose();
    } });
    await fiber; controls.push(controller);
    return { controller, fiber };
  }
  async function agent(id) {
    const value = { id: 'agent-' + id }, scope = scopeApi.createScope(owner, value); value.ctx = scope.ctx;
    await owner.agentPresets.mount(scope.ctx, id); return value;
  }
  const run = (agent, serverName = 'snowluma') => owner.tools.execute({ callId: 'fixture', name: `mcp__${serverName}__probe`, arguments: {}, agent, signal: new AbortController().signal });
  t.after(async () => { for (const controller of controls) await controller.dispose().catch(() => {}); await root.fiber.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(path.dirname(base), os.tmpdir()); await fs.rm(base, { recursive: true, force: true }); });
  return { root, owner, base, descriptor, mount, agent, run, calls, mounts, connect };
}

test('generated bundle has one metadata-named controller and no global MCP or preset siblings', async () => {
  const { buildDshBundle } = await import('./build-dsh-bundle.mjs');
  buildDshBundle({ check: true });
  const pkg = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  const rows = yaml.load(await fs.readFile(path.join(repo, 'cordis.patch.yml'), 'utf8')).flatMap(p => p.insert || []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, pkg.name);
  assert.equal(rows[0].id, pkg.qqBridge.instance.entryId);
});

test('root activation settles before readiness, seven canonical MCPs are isolated and old agents fail closed across disable', async t => {
  const f = await fixture(t), gate = deferred(), entered = deferred();
  await f.connect(f.owner, 'external', 'snowluma');
  const a = await f.descriptor('alpha'), b = await f.descriptor('beta');
  const aa = await f.mount(a, { mountMcp: async (ctx, options) => { if (options.serverName === 'snowluma') { entered.resolve(); await gate.promise; } await f.connect(ctx, 'alpha', options.serverName); } });
  await entered.promise;
  assert.equal(aa.fiber.state, 2, 'root row must not await its readiness task');
  await assert.rejects(aa.controller.start(), /NOT_READY/);
  const old = await f.agent('alpha:chat');
  assert.equal((await f.run(old)).isError, true); assert.deepEqual(f.calls, []);
  const bb = await f.mount(b); await bb.controller.ready;
  gate.resolve(); await aa.controller.ready;
  const other = await f.agent('beta:chat');
  for (const name of names) { assert.equal((await f.run(old, name)).isError, false); assert.equal((await f.run(other, name)).isError, false); }
  assert.deepEqual(f.calls, names.flatMap(name => [`/alpha/${name}`, `/beta/${name}`]));
  await aa.fiber.dispose();
  assert.equal(aa.controller.status.state, 'disposed');
  assert.deepEqual((await f.owner.agentPresets.list()).map(row => row.id), ['beta:chat']);
  const before = f.calls.length; assert.equal((await f.run(old)).isError, true); assert.equal(f.calls.length, before);
  const restored = await f.mount(a); await restored.controller.ready;
  assert.equal((await f.run(old)).isError, false);
  const ordinary = { id: 'ordinary', ctx: scopeApi.createScope(f.owner, {}).ctx };
  assert.equal((await f.run(ordinary)).isError, false); assert.equal(f.calls.at(-1), '/external/snowluma');
});

test('MCP startup failure and broken/pending presets reject ready and release only after rollback', async t => {
  const f = await fixture(t);
  for (const kind of ['mcp', 'broken', 'pending']) {
    const value = await f.descriptor(kind);
    const extra = kind === 'mcp' ? { mountMcp: async (ctx, options) => { if (options.serverName === 'games') throw Error('synthetic MCP failure'); await f.connect(ctx, kind, options.serverName); } }
      : { loadDefinitions: async () => [{ id: 'chat', plugins: [{ id: kind, name: kind === 'broken' ? 'cordis:fixture-broken' : 'cordis:fixture-pending' }] }] };
    f.owner.loader.builtins['fixture-pending'] = { inject: ['syntheticMissing'], apply() {} };
    const { controller } = await f.mount(value, extra);
    await assert.rejects(controller.ready, /MCP failure|PRESET_BROKEN/);
    assert.equal(controller.status.state, 'failed');
    assert.ok(!(await f.owner.agentPresets.list()).some(row => row.id === kind + ':chat'));
    await (await claimInstanceRoot(f.owner, value))();
  }
});

test('disable during pending MCP waits for late attachment and stops runtime before scope teardown', async t => {
  const f = await fixture(t), gate = deferred(), entered = deferred(), events = [];
  const value = await f.descriptor('pending-mount');
  const { controller, fiber } = await f.mount(value, {
    createRuntime: async () => ({ stop: async () => { events.push('runtime-stop'); }, start: async () => {} }),
    mountMcp: async (ctx) => { entered.resolve(); await gate.promise; await ctx.plugin({ apply() { events.push('late-mount'); return () => events.push('scope-dispose'); } }); },
  });
  await entered.promise;
  const disposing = fiber.dispose();
  await assert.rejects(controller.ready, /DISPOSED/);
  await assert.rejects(claimInstanceRoot(f.owner, value), /INSTANCE_CONFLICT/);
  gate.resolve(); await disposing;
  assert.deepEqual(events, ['late-mount', 'runtime-stop', 'scope-dispose']);
  assert.equal(controller.status.state, 'disposed');
  await (await claimInstanceRoot(f.owner, value))();
});

test('cleanup failure stays failed and preserves root claim rather than reporting disposed', async t => {
  const f = await fixture(t), value = await f.descriptor('cleanup-failure');
  const { controller } = await f.mount(value, { createRuntime: async () => ({ stop: async () => { throw Error('synthetic uncertain runtime'); } }) });
  await controller.ready;
  await assert.rejects(controller.dispose(), AggregateError);
  assert.equal(controller.status.state, 'failed'); assert.ok(controller.status.cleanupError instanceof AggregateError);
  await assert.rejects(claimInstanceRoot(f.owner, value), /INSTANCE_CONFLICT/);
});

test('definition loader preserves native expressions and only rewrites local plugin names', async () => {
  const { loadInstanceDefinitions } = await import('../src/dsh-instance-definitions.mjs');
  const actual = await loadInstanceDefinitions(repo, hostImport);
  assert.equal(actual.length, 6); assert.ok(actual.some(row => row.id === 'campus-summary'));
  for (const definition of actual) {
    const original = yaml.load(await fs.readFile(path.join(repo, 'plugins/qq-agent-presets/presets', definition.id + '.patch.yml'), 'utf8'))[0].insert[0].config;
    const rewrite = rows => rows.map(row => ({ ...row, name: row.name.startsWith('qq-agent-presets/') ? pathToFileURL(path.join(repo, 'plugins', row.name)).href : row.name, ...(row.group ? { config: rewrite(row.config) } : {}) }));
    assert.deepEqual(definition, { ...original, plugins: rewrite(original.plugins) });
  }
});

test('instance title fallback only touches mapped IDs, including no cwd-based adoption', async () => {
  const { apply } = await import('../plugins/qq-agent-presets/session-title-fallback.mjs');
  const hooks = {}, changed = [];
  apply({ on: (name, fn) => { hooks[name] = fn; }, sessionTitle: { get: s => s.title, rename(s, title) { changed.push(s.id); return s.title = { title, eventSeq: 1 }; } } }, { presetIds: ['alpha:learning'], presetIdMap: { 'qq-learning': 'alpha:learning' } });
  const session = (id, preset, title) => ({ id, header: { agentPreset: preset, cwd: path.join(repo, 'state/workspaces') }, events: [], title });
  for (const preset of ['qq-learning', 'beta:learning', undefined]) hooks['session/created'](session('unrelated', preset));
  const own = session('own', 'alpha:learning'); hooks['session/created'](own);
  assert.deepEqual(changed, ['own']); assert.match(own.title.title, /知识与黑话学习/);
  for (const kind of ['user', 'provider']) hooks['session/created'](session(kind, 'alpha:learning', { title: 'Untitled', source: { kind }, eventSeq: 2 }));
  assert.deepEqual(changed, ['own']);
});

test('root Config composes volatile mode fields with ordinary controller configuration', async () => {
  const { Config } = await import('../dsh-entry.mjs');
  assert.ok(Config?.dict?.mode?.meta?.volatile);
  assert.ok(Config?.dict?.ownerQQ?.meta?.volatile);
  assert.equal(Config.dict.root.meta.volatile, undefined);
  assert.equal(Config.dict.nodePath.meta.volatile, undefined);
  const result = await Config['~standard'].validate({ mode: 'simulation', ownerQQ: 'synthetic', root: repo, nodePath: process.execPath });
  assert.equal(result.issues, undefined); assert.equal(result.value.root, repo); assert.equal(result.value.nodePath, process.execPath);
});

test('native child disposer errors cannot be swallowed into a successful controller disposal', async t => {
  const f = await fixture(t), value = await f.descriptor('native-dispose-failure');
  const { controller } = await f.mount(value, { mountMcp: async (ctx, { serverName }) => {
    await ctx.intercept('logger', { level: -1 }).plugin({ apply() { return () => { if (serverName === 'games') throw Error('synthetic child cleanup failure'); }; } });
  } });
  await controller.ready;
  await assert.rejects(controller.dispose(), AggregateError);
  assert.equal(controller.status.state, 'failed');
  assert.ok(controller.status.cleanupError.errors.some(error => /synthetic child cleanup failure/.test(error.message)));
  await assert.rejects(claimInstanceRoot(f.owner, value), /INSTANCE_CONFLICT/);
});

test('registry-owned preset generation cleanup errors retain their logical instance claim', async t => {
  const f = await fixture(t), value = await f.descriptor('preset-cleanup');
  f.owner.loader.builtins['fixture-preset-cleanup'] = { apply() { return () => { throw Error('synthetic preset cleanup failure'); }; } };
  const { controller } = await f.mount(value, { loadDefinitions: async () => [{ id: 'chat', plugins: [{ id: 'owned', name: 'cordis:fixture-preset-cleanup' }] }] });
  await controller.ready;
  await assert.rejects(controller.dispose(), AggregateError);
  assert.ok(controller.status.cleanupError.errors.some(error => /synthetic preset cleanup failure/.test(error.message)));
  await assert.rejects(claimInstanceRoot(f.owner, value), /INSTANCE_CONFLICT/);
});

test('native cleanup observations ignore external failures and keep the guard closed before runtime stop', async t => {
  const f = await fixture(t), value = await f.descriptor('ordered'), events = [];
  let old;
  const { controller, fiber } = await f.mount(value, {
    createRuntime: async () => ({ stop: async () => {
      events.push('runtime');
      assert.equal((await f.run(old)).isError, true);
      f.owner.logger.error(Error('unrelated plugin error during cleanup'));
      await assert.rejects(claimInstanceRoot(f.owner, value), /INSTANCE_CONFLICT/);
    } }),
    mountMcp: async (ctx, { serverName }) => { await ctx.plugin({ apply() { return async () => {
      events.push(serverName);
      await assert.rejects(claimInstanceRoot(f.owner, value), /INSTANCE_CONFLICT/);
    }; } }); },
  });
  await controller.ready; old = await f.agent('ordered:chat');
  await fiber.dispose();
  assert.equal(events[0], 'runtime'); assert.deepEqual(events.slice(1).sort(), [...names].sort());
  assert.equal(controller.status.state, 'disposed'); await (await claimInstanceRoot(f.owner, value))();
});

test('native loader root entry exposes controller readiness without holding activation open', async t => {
  const f = await fixture(t), value = await f.descriptor('native-entry');
  const module = await import('../dsh-entry.mjs'), { EntryTree } = await hostImport('@deepseek-ai/cordis-plugin-loader');
  const gate = deferred(), entered = deferred(); let controller;
  f.owner.loader.builtins['fixture-root'] = { Config: module.Config, inject: ['loader', 'tools', 'agentPresets'], apply(ctx, config) {
    return module.apply(ctx, config, { hostImport, loadDefinitions: async () => structuredClone(definitions), mountTitles: async () => {},
      mountMcp: async (scope, { serverName }) => { if (serverName === 'snowluma') { entered.resolve(); await gate.promise; } await f.connect(scope, value.instanceId, serverName); },
      onController: handle => { controller = handle; },
    });
  } };
  const tree = new EntryTree(f.owner);
  await tree.root.update([{ id: value.entryId, name: 'cordis:fixture-root', config: { root: value.root, mode: 'simulation', ownerQQ: '' } }]);
  await tree.await(); await entered.promise;
  const entry = tree.resolve(value.entryId);
  assert.equal(entry.fiber.state, 2); assert.equal(controller.status.state, 'initializing');
  assert.equal(entry.fiber.config.mode.get(), 'simulation');
  gate.resolve(); await controller.ready;
  await entry.update({ ...entry.options, disabled: true }); await tree.await();
  assert.equal(controller.status.state, 'disposed');
  assert.ok(!(await f.owner.agentPresets.list()).some(row => row.id === 'native-entry:chat'));
});

test('default adapter launches seven synthetic stdio scripts bound to the descriptor root', async t => {
  const f = await fixture(t), value = await f.descriptor('stdio');
  const { BUNDLED_MCP } = await import('../dsh-mcp-entry.mjs');
  await fs.writeFile(path.join(value.root, 'package.json'), JSON.stringify({ name: value.bundleName, type: 'module' }));
  const script = `import readline from 'node:readline';
const lines = readline.createInterface({input:process.stdin});
lines.on('line', line => { const q=JSON.parse(line); if(q.id===undefined)return; let result={};
if(q.method==='initialize')result={protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}};
if(q.method==='tools/list')result={tools:[{name:'probe',description:'synthetic',inputSchema:{type:'object'}}]};
if(q.method==='tools/call')result={content:[{type:'text',text:JSON.stringify({cwd:process.cwd(),entry:process.argv[1],root:process.env.QQ_BRIDGE_ROOT,pid:process.pid})}]};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n'); });`;
  for (const file of Object.values(BUNDLED_MCP)) { const target = path.join(value.root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, script); }
  await fs.writeFile(path.join(value.root, 'node_modules/@playwright/mcp/package.json'), JSON.stringify({ name: '@playwright/mcp', type: 'module', exports: { './package.json': './package.json' } }));
  const { controller } = await f.mount(value, { mountMcp: undefined }); await controller.ready;
  const agent = await f.agent('stdio:chat');
  const pids = [];
  for (const serverName of names) {
    const result = await f.run(agent, serverName); assert.equal(result.isError, false);
    const text = result.content.find(item => item.type === 'text').text;
    const actual = JSON.parse(text);
    pids.push(actual.pid);
    assert.equal(actual.cwd, value.root); assert.equal(actual.root, value.root); assert.equal(actual.entry, path.join(value.root, BUNDLED_MCP[serverName]));
  }
  await controller.dispose(); assert.equal(controller.status.state, 'disposed');
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'native disposal must observe the synthetic stdio process exit');
  await fs.writeFile(path.join(value.root, BUNDLED_MCP.games), 'process.exit(7);');
  const failed = await f.mount(value, { mountMcp: undefined });
  await assert.rejects(failed.controller.ready, /initial connection or tool synchronization failed/);
  assert.equal(failed.controller.status.state, 'failed');
  assert.equal((await f.run(agent)).isError, true);
  await (await claimInstanceRoot(f.owner, value))();
  await fs.writeFile(path.join(value.root, BUNDLED_MCP.games), script);
  const restored = await f.mount(value, { mountMcp: undefined }); await restored.controller.ready;
  await failed.controller.dispose();
  assert.equal((await f.run(agent)).isError, false, 'disposing an old failed controller cannot close the replacement generation');
});

test('definition parser retains native YAML expressions through nested local plugin rows', async t => {
  const f = await fixture(t), value = await f.descriptor('expressions');
  await fs.cp(path.join(repo, 'plugins/qq-agent-presets/presets'), path.join(value.root, 'plugins/qq-agent-presets/presets'), { recursive: true });
  const file = path.join(value.root, 'plugins/qq-agent-presets/presets/campus-summary.patch.yml');
  await fs.writeFile(file, `- insert:
  - name: '@deepseek-ai/dsh-agent-preset'
    config:
      id: campus-summary
      plugins:
        - id: group
          name: cordis:group
          group: true
          config:
            - id: summary
              name: qq-agent-presets/summary-tool-restrict.mjs
              disabled: !!js fiber.entry.options.id === 'other'
              config:
                untouchedName: qq-agent-presets/not-a-module
                input: !!js fiber.entry.options.id
`);
  const { loadInstanceDefinitions } = await import('../src/dsh-instance-definitions.mjs');
  const definitions = await loadInstanceDefinitions(value.root, hostImport);
  const row = definitions.find(row => row.id === 'campus-summary').plugins[0].config[0];
  assert.deepEqual(row.disabled, { __jsExpr: "fiber.entry.options.id === 'other'" });
  assert.deepEqual(row.config.input, { __jsExpr: 'fiber.entry.options.id' });
  assert.equal(row.config.untouchedName, 'qq-agent-presets/not-a-module');
  assert.equal(row.name, pathToFileURL(path.join(value.root, 'plugins/qq-agent-presets/summary-tool-restrict.mjs')).href);
});

test('bundle generation derives distinct real package and client identities from explicit install metadata', async t => {
  const f = await fixture(t), value = await f.descriptor('package-identity');
  for (const folder of ['dsh/agent-presets', 'plugins/qq-agent-presets/presets']) await fs.cp(path.join(repo, folder), path.join(value.root, folder), { recursive: true });
  await fs.mkdir(path.join(value.root, 'plugins/qq-launcher/lib'), { recursive: true });
  await fs.copyFile(path.join(repo, 'plugins/qq-launcher/lib/client.js'), path.join(value.root, 'plugins/qq-launcher/lib/client.js'));
  const pkg = { name: 'synthetic-install-package', qqBridge: { instance: { entryId: 'synthetic-settings', settingsNamespace: 'synthetic-settings' } } };
  await fs.writeFile(path.join(value.root, 'package.json'), JSON.stringify(pkg));
  const { buildDshBundle } = await import('./build-dsh-bundle.mjs');
  buildDshBundle({ root: value.root });
  const rows = yaml.load(await fs.readFile(path.join(value.root, 'cordis.patch.yml'), 'utf8'))[0].insert;
  assert.deepEqual(rows, [{ id: 'synthetic-settings', name: pkg.name, config: {} }]);
  assert.ok((await fs.readFile(path.join(value.root, 'dsh-client.js'), 'utf8')).includes('id: ' + JSON.stringify(pkg.name)));
  assert.ok(buildDshBundle({ root: value.root, check: true }).every(result => !result.changed));
  assert.throws(() => buildDshBundle({ root: value.root, descriptor: { entryId: 'a', settingsNamespace: 'a', bundleName: 'alias-only' } }), /matching package/);
});

for (const startupFailure of [false, true]) test(`actual native MCP ${startupFailure ? 'startup rollback' : 'close'} timeout retains its claim even with logging disabled`, async t => {
  const f = await fixture(t), value = await f.descriptor('transport-close-failure');
  const file = path.join(value.root, 'fixture.mjs'), helperPidFile = path.join(value.root, 'helper-pid');
  await fs.writeFile(file, `import readline from 'node:readline'; import fs from 'node:fs'; import {spawn} from 'node:child_process';
const helper=spawn(process.execPath,['-e','setTimeout(()=>{},11000)'],{detached:true,windowsHide:true,stdio:['ignore',process.stdout,process.stderr]});fs.writeFileSync(${JSON.stringify(helperPidFile)},String(helper.pid));helper.unref();
const lines=readline.createInterface({input:process.stdin});
lines.on('line', line=>{const q=JSON.parse(line);if(q.id===undefined)return;if(q.method==='tools/list'&&process.env.SYNTHETIC_FAIL_START){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32603,message:'synthetic startup failure'}})+'\\n');return;}let result={};if(q.method==='initialize')result={protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}};if(q.method==='tools/list')result={tools:[]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');});
lines.on('close',()=>process.exit(0));`);
  const { controller } = await f.mount(value, { mountMcp: async (ctx, { serverName }) => {
    if (serverName !== 'snowluma') return;
    await ctx.intercept('logger', { level: -1 }).plugin(MCP, { transport: 'stdio', serverName, command: process.execPath, args: [file], cwd: value.root, env: startupFailure ? { SYNTHETIC_FAIL_START: '1' } : {}, failOnStartupError: true, reconnect: { enabled: false } });
  } });
  try {
    if (startupFailure) await assert.rejects(controller.ready, /readiness and rollback failed/);
    else await controller.ready;
    await assert.rejects(controller.dispose(), AggregateError);
    assert.equal(controller.status.state, 'failed');
    assert.ok(controller.status.cleanupError.errors.some(error => /transport closure could not be confirmed|could not confirm transport closure/.test(error.message)));
    await assert.rejects(claimInstanceRoot(f.owner, value), /INSTANCE_CONFLICT/);
  } finally {
    // The synthetic pipe-holder has a fixed lifetime. Observe only; do not kill by PID.
    const pid = Number(await fs.readFile(helperPidFile, 'utf8'));
    let exited = false;
    for (let i = 0; i < 150; i++) { try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') { exited = true; break; } throw error; } await delay(100); }
    assert.equal(exited, true, 'synthetic pipe holder must finish within its bounded lifetime');
  }
  await assert.rejects(claimInstanceRoot(f.owner, value), /INSTANCE_CONFLICT/, 'a late close signal must not erase the failed cleanup outcome');
});

test('root entry refuses an uninitialized directory without bootstrap writes', async t => {
  const f = await fixture(t), directory = path.join(f.base, 'uninitialized'); await fs.mkdir(directory);
  const { apply } = await import('../dsh-entry.mjs');
  await assert.rejects(apply(f.owner, { root: directory }), /ENOENT/);
  assert.deepEqual(await fs.readdir(directory), []);
});
