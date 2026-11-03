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
import crypto from 'node:crypto';
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

test('root disposal closes launcher admission before runtime dispose and still revokes scope after runtime uncertainty', async t => {
  const f=await fixture(t), value=await f.descriptor('owned-disposal'), events=[];
  const {controller}=await f.mount(value,{
    createRuntime:()=>({start:async()=>{},stop:async()=>{throw Error('must use dispose');},dispose:async()=>{events.push('runtime-dispose');throw Error('uncertain owned teardown');}}),
    mountMcp:async ctx=>{await ctx.plugin({apply(){return()=>events.push('scope-dispose');}});},
    mountLauncher:()=>({ready:Promise.resolve(),closeAdmission:()=>events.push('admission-closed'),dispose:async()=>events.push('launcher-dispose')}),
  });
  await controller.ready; const old=await f.agent('owned-disposal:chat');
  await assert.rejects(controller.dispose(),AggregateError);
  assert.deepEqual(events.slice(0,2),['admission-closed','runtime-dispose']); assert.equal(events.at(-1),'launcher-dispose');
  assert.equal(events.filter(x=>x==='scope-dispose').length,7); assert.equal((await f.run(old)).isError,true);
  await assert.rejects(claimInstanceRoot(f.owner,value),/INSTANCE_CONFLICT/);
  await assert.rejects(controller.dispose(),AggregateError);assert.equal(events.filter(x=>x==='runtime-dispose').length,1);
});

test('controller start remains blocked after stop rejection until an explicit successful owned stop', async t => {
  const f=await fixture(t),value=await f.descriptor('stop-latch');let starts=0,fail=true;
  const {controller}=await f.mount(value,{createRuntime:()=>({start:async()=>{starts++;},stop:async()=>{if(fail)throw Error('uncertain stop');}})});
  await controller.ready; await controller.start(); await assert.rejects(controller.stop(),/uncertain stop/);
  await assert.rejects(controller.start(),/STOP_UNCERTAIN/);assert.equal(starts,1);
  fail=false;await controller.stop();await controller.start();assert.equal(starts,2);
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

for (const dirtyRollback of [true, false]) test(`scope construction conflict ${dirtyRollback ? 'retains the claim on native cleanup failure' : 'releases the claim after clean rollback'}`, async t => {
  const f = await fixture(t), value = await f.descriptor(dirtyRollback ? 'construction-dirty' : 'construction-clean');
  let externalDisposed = 0, instanceDisposed = 0;
  f.owner.loader.builtins['fixture-external-preset'] = { apply() { return () => { externalDisposed++; }; } };
  f.owner.loader.builtins['fixture-construction-cleanup'] = { apply() { return () => {
    instanceDisposed++;
    f.owner.logger.error(Error('unrelated construction rollback error'));
    if (dirtyRollback) throw Error('synthetic construction rollback failure');
  }; } };
  const external = { id: 'external-conflict', name: 'External preset', plugins: [{ id: 'external', name: 'cordis:fixture-external-preset' }] };
  const unregisterExternal = await f.owner.agentPresets.register(external);
  const before = await f.owner.agentPresets.list();
  const { controller } = await f.mount({ ...value, presetIdMap: { second: external.id } }, { loadDefinitions: async () => [
    { id: 'first', plugins: [{ id: 'owned', name: 'cordis:fixture-construction-cleanup' }] },
    { id: 'second', plugins: [] },
  ] });
  await assert.rejects(controller.ready, dirtyRollback ? /readiness and rollback failed/ : /Duplicate agent preset/);
  assert.equal(instanceDisposed, 1, 'the first preset must be activated and rolled back before construction rejects');
  assert.deepEqual(await f.owner.agentPresets.list(), before);
  assert.equal(externalDisposed, 0, 'external conflicting definition and generation remain untouched');
  if (dirtyRollback) {
    await assert.rejects(controller.dispose(), error => error instanceof AggregateError && error.errors.some(item => /synthetic construction rollback failure/.test(item.message)));
    assert.equal(controller.status.state, 'failed');
    await assert.rejects(claimInstanceRoot(f.owner, value), /INSTANCE_CONFLICT/);
  } else {
    await controller.dispose();
    assert.equal(controller.status.cleanupError, null);
    await (await claimInstanceRoot(f.owner, value))();
  }
  await unregisterExternal(); assert.equal(externalDisposed, 1);
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
    return module.apply(ctx, config, { hostImport, createRuntime: null, mountLauncher: null, loadDefinitions: async () => structuredClone(definitions), mountTitles: async () => {},
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

test('native root default factories own real synthetic services, seven MCPs, logs and disable without deleting data', {timeout:60000}, async t => {
  const f=await fixture(t), value=await f.descriptor('production-entry');
  const {OWNED_PRESET_SOURCES}=await import('../src/instance-session-policy.mjs');
  const {BUNDLED_MCP}=await import('../dsh-mcp-entry.mjs');
  const {EntryTree}=await hostImport('@deepseek-ai/cordis-plugin-loader');
  const module=await import('../dsh-entry.mjs');
  await fs.writeFile(path.join(value.root,'package.json'),JSON.stringify({name:value.bundleName,type:'module'}));
  const mcp=`import readline from 'node:readline';const lines=readline.createInterface({input:process.stdin});lines.on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;let result={};if(q.method==='initialize')result={protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}};if(q.method==='tools/list')result={tools:[{name:'probe',description:'synthetic',inputSchema:{type:'object'}}]};if(q.method==='tools/call')result={content:[{type:'text',text:JSON.stringify({pid:process.pid,entry:process.argv[1],executable:process.execPath})}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');});`;
  for(const file of Object.values(BUNDLED_MCP)){const target=path.join(value.root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,mcp);}
  await fs.writeFile(path.join(value.root,'node_modules/@playwright/mcp/package.json'),JSON.stringify({name:'@playwright/mcp',type:'module',exports:{'./package.json':'./package.json'}}));
  const snowHome=path.join(value.root,'managed-dependencies','synthetic-snow');await fs.mkdir(snowHome,{recursive:true});
  const nodeFile=path.join(snowHome,path.basename(process.execPath));await fs.copyFile(process.execPath,nodeFile);
  const snow=`console.log('Synthetic WebUI initial credentials: LOCAL-ONLY');console.error('Synthetic gateway startup diagnostic');process.on('message',m=>{if(m==='shutdown')process.exit(0)});setInterval(()=>{},1000);`;
  await fs.writeFile(path.join(snowHome,'index.mjs'),snow);
  const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
  await fs.writeFile(path.join(snowHome,'.qq-bridge-managed.json'),JSON.stringify({version:1,kind:'snowluma',instanceId:value.instanceId,entry:'index.mjs',runtime:path.basename(nodeFile),files:{'index.mjs':digest(snow),[path.basename(nodeFile)]:digest(await fs.readFile(nodeFile))}}));
  await fs.mkdir(path.join(value.root,'scripts'),{recursive:true});await fs.writeFile(path.join(value.root,'scripts/snow-bootstrap.mjs'),'// synthetic preload');
  await fs.writeFile(path.join(value.root,'src/bridge.js'),`console.log('Synthetic bridge startup',process.execPath);process.on('message',m=>{if(m.type==='qq-bridge:shutdown')process.exit(0)});setInterval(()=>{},1000);`);
  const sockets=[];
  for(let i=0;i<6;i++){const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));sockets.push(server);}
  const ports=Object.fromEntries(['dsh','console','snowHttp','snowWs','launcher','snowWebui'].map((key,i)=>[key,sockets[i].address().port]));
  // Leave the shared DSH target listening; runtime must not claim or rebind it.
  for(const server of sockets.slice(1))await new Promise(resolve=>server.close(resolve));
  t.after(()=>new Promise(resolve=>sockets[0].close(resolve)));
  const config={launcher:{ports},snowluma:{botUin:'123456789'},consolePort:ports.console};
  await fs.writeFile(path.join(value.root,'config.json'),JSON.stringify(config));
  await fs.writeFile(path.join(value.root,'preserved-history'),'synthetic existing history');
  let controller;
  f.owner.loader.builtins['fixture-production-root']={Config:module.Config,inject:['loader','tools','agentPresets'],apply(ctx,config){return module.apply(ctx,config,{hostImport,
    loadDefinitions:async()=>OWNED_PRESET_SOURCES.map(id=>({id,name:id,plugins:[]})),mountTitles:async()=>{},onController:handle=>{controller=handle;}});}};
  const tree=new EntryTree(f.owner);
  await tree.root.update([{id:value.entryId,name:'cordis:fixture-production-root',config:{root:value.root,snowHome,nodePath:''}}]);await tree.await();await controller.ready;
  assert.equal(typeof controller.launcherAddress(),'string','production root must mount its default owned launcher');
  const status=async()=>await(await fetch(controller.launcherAddress()+'/status')).json();
  const post=async(route,body={})=>{const identity=await status();const response=await fetch(controller.launcherAddress()+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,instanceId:identity.instanceId,generation:identity.generation}),signal:AbortSignal.timeout(20000)});return {http:response.status,...await response.json()};};
  assert.equal((await status()).runtime.state,'stopped');await assert.rejects(fs.access(path.join(snowHome,'config')),{code:'ENOENT'});
  const started=await post('/start');assert.equal(started.http,200);assert.equal(started.readiness,'unverified');assert.equal(started.runtime.children.length,2);
  const servicePids=started.runtime.children.map(child=>child.pid);await post('/start');assert.deepEqual((await status()).runtime.children.map(child=>child.pid),servicePids);
  const freshPort=async()=>{const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const number=server.address().port;await new Promise(resolve=>server.close(resolve));return number;};
  const rawBefore=await fs.readFile(path.join(value.root,'config.json'),'utf8');
  const normalized=await post('/config',{});assert.equal(normalized.http,200);assert.equal(normalized.needsRestart,false);
  assert.notEqual(await fs.readFile(path.join(value.root,'config.json'),'utf8'),rawBefore);
  assert.equal((await post('/start')).http,200,'same effective settings normalization must not require stop');
  const oldListener=controller.launcherAddress(),oldGeneration=(await status()).generation,newPort=await freshPort();
  const moved=await post('/config',{ports:{launcher:newPort}});
  assert.equal(moved.http,200);assert.equal(moved.serviceUrl,`http://127.0.0.1:${newPort}`);assert.notEqual(moved.generation,oldGeneration);assert.equal(moved.needsRestart,false);
  await assert.rejects(fetch(oldListener+'/status',{signal:AbortSignal.timeout(1000)}),'old listener retires after its accepted save response drains');
  assert.equal((await post('/start')).http,200,'launcher-only move must permit real idempotent duplicate start');
  assert.deepEqual((await status()).runtime.children.map(child=>child.pid),servicePids);
  const changedConsole=await post('/config',{ports:{console:await freshPort()}});assert.equal(changedConsole.needsRestart,true);
  const blockedConsole=await post('/start');assert.equal(blockedConsole.code,'INSTANCE_CONFIG_CHANGED');assert.deepEqual((await status()).runtime.children.map(child=>child.pid),servicePids);
  const reverted=await post('/config',{ports:{console:ports.console}});assert.equal(reverted.needsRestart,false,'compare with the active runtime, not a permanently latched save flag');
  assert.equal((await post('/start')).http,200);
  const changedAccount=await post('/config',{botUin:'987654321'});assert.equal(changedAccount.needsRestart,true);assert.equal((await post('/start')).code,'INSTANCE_CONFIG_CHANGED');
  const restarted=await post('/restart');assert.equal(restarted.http,200);assert.equal(restarted.needsRestart,false);assert.equal(restarted.runtime.botUin,'987654321');
  for(const pid of servicePids)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  servicePids.push(...restarted.runtime.children.map(child=>child.pid));
  const original=controller,entry=tree.resolve(value.entryId);
  await entry.update({...entry.options,config:{...entry.options.config,mode:'simulation',ownerQQ:'12345'}});await tree.await();
  assert.equal(controller,original);assert.deepEqual((await status()).runtime.children.map(child=>child.pid),servicePids.slice(-2));
  const agent=await f.agent('production-entry:qq-chat'),mcpPids=[];
  for(const serverName of names){const result=await f.run(agent,serverName);assert.equal(result.isError,false);const actual=JSON.parse(result.content[0].text);mcpPids.push(actual.pid);assert.equal(actual.executable,await fs.realpath(nodeFile));}
  const log=await fs.readFile(path.join(value.root,'state/runtime-logs/snow.log'),'utf8');assert.match(log,/Synthetic WebUI initial credentials: LOCAL-ONLY/);assert.match(log,/Synthetic gateway startup diagnostic/);
  const bridgeLog=await fs.readFile(path.join(value.root,'state/runtime-logs/bridge.log'),'utf8');assert.match(bridgeLog,/Synthetic bridge startup/);assert.ok(bridgeLog.includes(await fs.realpath(nodeFile)));
  const oldAddress=controller.launcherAddress();await tree.resolve(value.entryId).update({...tree.resolve(value.entryId).options,disabled:true});await tree.await();
  assert.equal(controller.status.state,'disposed');assert.equal(controller.runtimeStatus().state,'disposed');
  for(const pid of [...servicePids,...mcpPids])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  await assert.rejects(fetch(oldAddress+'/status',{signal:AbortSignal.timeout(1000)}));
  assert.equal(await fs.readFile(path.join(value.root,'preserved-history'),'utf8'),'synthetic existing history');
  assert.equal(sockets[0].listening,true);assert.ok(!(await f.owner.agentPresets.list()).some(row=>row.id.startsWith('production-entry:')));
  await (await claimInstanceRoot(f.owner,value))();
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

test('runtime receives exact map and a generation-bound ownership callback',async t=>{
 const f=await fixture(t),value=await f.descriptor('record-seam');let received;
 const {controller}=await f.mount(value,{createRuntime:async options=>{received=options;return {stop:async()=>{}};}});
 await controller.ready;assert.deepEqual({...received.presetMap},{chat:'record-seam:chat'});assert.equal(typeof received.recordCreatedSession,'function');
 await controller.dispose();await assert.rejects(received.recordCreatedSession({sessionId:'late',workspaceId:'old'}),/DISPOSED/);
});

test('real profile settings persist distinct namespaces with volatile refs and stable controller Fibers',async t=>{
 const f=await fixture(t),a=await f.descriptor('settings-alpha'),b=await f.descriptor('settings-beta');
 const [{default:ConfigEditor},{default:Settings},boot,module]=await Promise.all([hostImport('@deepseek-ai/dsh-config-editor'),hostImport('@deepseek-ai/dsh-settings'),hostImport('@deepseek-ai/dsh-app-boot'),import('../dsh-entry.mjs')]);
 const profile=path.join(f.base,'profile');await fs.mkdir(profile);const patchPath=path.join(profile,'cordis.patch.yml'),configPath=path.join(profile,'root.yml');
 await fs.writeFile(path.join(profile,'package.json'),JSON.stringify({name:'synthetic-profile',version:'1.0.0',dsh:{profile:{bundles:[]}}}));await fs.writeFile(configPath,'[]\n');
 const profileContext={name:'fixture',dir:profile,patchPath,installAnchor:hostPackage,cwd:profile,home:path.join(f.base,'home'),startedBundles:[],overlays:[]};
 await f.root.plugin({apply(ctx){ctx.provide('profileContext',profileContext);}});await f.root.plugin(ConfigEditor);await f.root.plugin(Settings);
 const controls=new Map(),starts=new Map();
 f.root.loader.builtins['fixture-settings-root']={Config:module.Config,inject:['loader','tools','agentPresets'],apply(ctx,config){starts.set(config.root,(starts.get(config.root)||0)+1);return module.apply(ctx,config,{hostImport,createRuntime:null,mountLauncher:null,loadDefinitions:async()=>structuredClone(definitions),mountTitles:async()=>{},mountMcp:async()=>{},onController:handle=>controls.set(config.root,handle)});}};
 const patches=[{insert:[a,b].map(value=>({id:value.entryId,name:'cordis:fixture-settings-root',config:{root:value.root,mode:'reserved2',ownerQQ:''}}))}];
 await fs.writeFile(patchPath,yaml.dump(patches));await boot.mountRootInclude(f.root,configPath,patches);await f.root.loader.await();await Promise.all([...controls.values()].map(c=>c.ready));
 const entries=[...f.root.loader.entries()].filter(e=>[a.entryId,b.entryId].includes(e.options.id)),fibers=entries.map(e=>e.fiber),refs=entries.map(e=>e.fiber.config.mode);
 assert.deepEqual(f.root.settings.describe().map(row=>row.ns).sort(),[a.entryId,b.entryId].sort());
 await f.root.settings.update(a.entryId,{mode:'chat',ownerQQ:'123'});
 assert.equal(f.root.settings.describe().find(row=>row.ns===a.entryId).value.mode,'chat');assert.equal(f.root.settings.describe().find(row=>row.ns===b.entryId).value.mode,'reserved2');
 for(let i=0;i<entries.length;i++){assert.equal(entries[i].fiber,fibers[i]);assert.equal(entries[i].fiber.config.mode,refs[i]);assert.equal(starts.get(entries[i].options.config.root),1);}
 assert.equal(controls.get(a.root).status.state,'ready');
 const persisted=yaml.load(await fs.readFile(patchPath,'utf8'));assert.equal(persisted.find(row=>row.id===a.entryId).config.mode,'chat');
 await boot.reconcileProfilePatches(f.root,boot.readProfilePatches('dsh',profileContext),'dsh');
 assert.equal(f.root.settings.describe().find(row=>row.ns===a.entryId).value.ownerQQ,'123');
 await assert.rejects(f.root.settings.update('qq-mode',{mode:'chat'}),/No configurable plugin entry/);
});
