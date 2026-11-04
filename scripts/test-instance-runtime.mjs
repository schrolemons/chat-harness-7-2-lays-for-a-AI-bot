import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readLauncherSettings, saveLauncherSettings } from './launcher-settings.mjs';
import {initializeManifest,appendInstallationEvidence} from '../src/instance-manifest.mjs';
import { readInstanceSessionPolicy } from '../src/instance-session-policy.mjs';
import { probeProcess as nativeProbe } from '../src/instance-ownership.mjs';

const api = await import('../src/instance-runtime.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const matches = code => error => error.code === code;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function fixture(t, { registryDir, botUin = '123456789', instanceId = 'public', native = false, ...options } = {}) {
  assert.equal(typeof api.createInstanceRuntime, 'function', 'managed runtime API is required');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-managed-runtime-'));
  registryDir ||= path.join(root, 'account-registry');
  const snowHome = path.join(root, 'managed-dependencies', 'snowluma');
  await fs.mkdir(path.join(snowHome,'config'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'));
  await fs.mkdir(path.join(root, 'scripts'));
  const entry = 'setInterval(() => {}, 1000);\n';
  await fs.writeFile(path.join(snowHome, 'index.mjs'), entry);
  await fs.writeFile(path.join(snowHome, 'node.exe'), 'fixture-runtime-binary');
  await fs.writeFile(path.join(root, 'src', 'bridge.js'), entry);
  await fs.writeFile(path.join(root, 'scripts', 'snow-bootstrap.mjs'), '// fixture preload\n');
  for (const worker of ['web-watch', 'login-window']) await fs.writeFile(path.join(root, 'scripts', worker + '.mjs'), entry);
  const marker = path.join(snowHome, '.qq-bridge-managed.json');
  await fs.writeFile(marker, JSON.stringify({ version: 1, kind: 'snowluma', instanceId, entry: 'index.mjs', runtime: 'node.exe',createdDirectories:['config'],
    files: { 'index.mjs': hash(entry), 'node.exe': hash('fixture-runtime-binary') } }));
  const configFile = path.join(root, 'config.json');
  const ports = { dsh: 42080, console: 42100, snowHttp: 42000, snowWs: 42001, launcher: 42199, snowWebui: 45099 };
  let config = { launcher: { ports }, consolePort: ports.console, snowluma: { botUin, accessToken: 'fixture-token',
    httpUrl: `http://127.0.0.1:${ports.snowHttp}`, wsUrl: `ws://127.0.0.1:${ports.snowWs}` } };
  await fs.writeFile(configFile, JSON.stringify(config));
  if (!options.freshMigrations) {
    const migrations = path.join(root, 'state', 'migrations');
    await fs.mkdir(migrations, { recursive: true });
    for (const name of ['outbound-mood-v1', 'group-wake-v1']) {
      await fs.writeFile(path.join(migrations, name + '.json'), JSON.stringify({ version: 1, phase: 'complete' }));
    }
  }
  if (options.freshMigrations) for (const id of ['ctx-user-mood', 'life-wake-reasons', 'ctx-chat-reply-shape', 'ctx-chat-topic-drive']) {
    const dir = path.join(root, 'plugins', 'qq-components', id);
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(new URL('../plugins/qq-components/' + id + '/plugin.json', import.meta.url), path.join(dir, 'plugin.json'));
  }
  const live = new Map([[process.pid, { pid: process.pid, startTime: 'fixture-owner', executablePath: process.execPath, parentPid: 1 }]]);
  const calls = [], children = [], exits = [];
  const probe = native ? nativeProbe : async pid => live.get(pid) ?? null;
  const spawnProcess = (file, args, spawnOptions) => {
    calls.push({ file, args, options: spawnOptions });
    if (options.spawnFailureAt === calls.length) throw new Error('fixture spawn failed');
    // The real child sleeps; command args remain present for ownership's exact-entry check.
    const child = spawn(process.execPath, ['-e', options.childCode || "process.on('message', m => {if(m === 'shutdown'||m.type === 'qq-bridge:shutdown') process.exit(0)}); setInterval(() => {}, 1000)", '--', ...args], spawnOptions);
    children.push(child);
    live.set(child.pid, { pid: child.pid, startTime: `fixture-${child.pid}`, executablePath: process.execPath, parentPid: process.pid });
    child.once('exit', () => { live.delete(child.pid); exits.push(child === children[0] ? 'snow' : 'bridge'); });
    return child;
  };
  const descriptor={version:1,instanceId,label:'Fixture bot',profile:'fixture',bundleName:'synthetic-runtime',root,dshHome:options.dshHome||path.join(root,'home'),registryDir,entryId:instanceId,settingsNamespace:instanceId,presetIdMap:{}};
  await fs.writeFile(path.join(root,'.qq-bridge-instance.json'),JSON.stringify(descriptor));
  await initializeManifest(root,descriptor);
  await appendInstallationEvidence(root,{profileEntries:[],links:[],paths:[{path:snowHome,kind:'dependency',source:'created',cleanup:'owned',createdByTransaction:crypto.randomUUID(),manifestPath:marker,sha256:hash(await fs.readFile(marker))}]});
  const runtimeOptions = { descriptor, root, instanceId, registryDir, nodePath: process.execPath, snowHome,
    probePort: async () => false, probeProcess: probe, spawnProcess, stopTimeoutMs: 1500,
    presetMap: readInstanceSessionPolicy({descriptor}).presetMap, ...options.runtimeOptions };
  const runtime = api.createInstanceRuntime(runtimeOptions);
  t.after(async () => {
    try { if(options.cleanupError)await assert.rejects(runtime.dispose(),matches(options.cleanupError));else await runtime.dispose(); }
    finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill(); await exited;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  return { root, snowHome, marker, registryDir, configFile, ports, runtime, calls, children, live, exits,
    options: runtimeOptions,
    writeConfig: async patch => { config = { ...config, ...patch }; await fs.writeFile(configFile, JSON.stringify(config)); },
    claim: () => fs.readFile(path.join(registryDir, `${botUin}.json`), 'utf8') };
}

test('managed runtime exports its lifecycle API', () => {
  assert.equal(typeof api.createInstanceRuntime, 'function');
});

test('Snow can run the same verified Node bytes from an explicit executable path', async t => {
  const f = await fixture(t, { freshMigrations: true });
  await f.writeConfig({ socialV2: { wake: { recommendedKeywords: ['fixture-wake'] } } });
  const selectedNode = path.join(f.root, 'node.exe');
  await fs.copyFile(path.join(f.snowHome, 'node.exe'), selectedNode);
  const config = JSON.parse(await fs.readFile(f.configFile, 'utf8'));
  await f.writeConfig({ snowluma: { ...config.snowluma, nodePath: selectedNode } });
  await f.runtime.start();
  assert.equal(f.calls[0].file, selectedNode);
  assert.equal(JSON.parse(await fs.readFile(f.configFile, 'utf8')).socialV2.wake.recommendedKeywords, undefined);
  assert.equal(f.calls[0].options.cwd, f.snowHome);
  await f.runtime.stop();
  await fs.writeFile(selectedNode, 'different binary');
  await assert.rejects(f.runtime.start(), matches('SNOW_NODE_DIGEST_MISMATCH'));
  assert.equal(f.calls.length, 2);
});

test('Windows onboarding requests a setup viewer without attaching the Snow worker to a console', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const eula = 'fixture terms', privacy = 'fixture privacy';
  await fs.writeFile(path.join(f.snowHome, 'EULA.md'), eula);
  await fs.writeFile(path.join(f.snowHome, 'PRIVACY.md'), privacy);
  const consent = path.join(f.snowHome, 'config', 'consent.json');
  const auth = path.join(f.snowHome, 'config', 'webui.json');
  const version = hash('eula\0' + eula + '\0privacy\0' + privacy + '\0').slice(0, 16);
  const configured = { passwordHash: 'ab'.repeat(64), passwordSalt: 'cd'.repeat(16), mustChangePassword: false };
  await f.runtime.start();
  assert.equal(f.calls[0].options.windowsHide, true);
  assert.equal(f.calls[0].options.env.SNOWLUMA_BRIDGE_CONSOLE, '1');
  assert.equal(f.calls[0].options.detached, false);
  assert.equal(f.calls[1].options.windowsHide, true);
  assert.equal(f.runtime.status().phase, 'waiting-connection');
  await f.runtime.stop();
  await fs.writeFile(auth, JSON.stringify(configured));
  await fs.writeFile(consent, JSON.stringify({ version, acceptedAt: new Date().toISOString() }));
  await f.runtime.start();
  assert.equal(f.calls[2].options.windowsHide, true);
  assert.equal(f.calls[2].options.env.SNOWLUMA_BRIDGE_CONSOLE, '0');
  await f.runtime.stop();
  await fs.writeFile(auth, JSON.stringify({ ...configured, mustChangePassword: true }));
  await f.runtime.start();
  assert.equal(f.calls[4].options.windowsHide, true);
  assert.equal(f.calls[4].options.env.SNOWLUMA_BRIDGE_CONSOLE, '1');
});

test('managed child binds descriptor home and selected target rather than poisoned ambient authority',async t=>{
 const f=await fixture(t,{runtimeOptions:{env:{...process.env,DSH_HOME:path.join(os.tmpdir(),'foreign-home'),DSH_LAUNCH_TOKEN:'foreign-launch',DSH_BASE_URL:'http://foreign.invalid'},getDshOrigin:()=> 'http://127.0.0.1:54321'}});
 await f.writeConfig({launcher:{ports:{...f.ports,dsh:''}},dsh:{baseUrl:'http://127.0.0.1:3080'}});
 await f.runtime.start();const env=f.calls.find(c=>c.args.some(a=>a.endsWith('bridge.js'))).options.env;
 assert.equal(env.DSH_HOME,f.options.descriptor.dshHome);assert.equal(env.DSH_LAUNCH_TOKEN,'');
 assert.equal(JSON.parse(env.QQ_BRIDGE_DSH_TARGET).baseUrl,'http://127.0.0.1:54321');
 assert.equal(env.DSH_BASE_URL,'');
 const b=await fixture(t,{runtimeOptions:{env:{...process.env,DSH_HOME:f.options.descriptor.dshHome,DSH_LAUNCH_TOKEN:'first-home-token'}}});await b.runtime.start();
 const second=b.calls[1].options.env;assert.notEqual(second.DSH_HOME,env.DSH_HOME);assert.equal(second.DSH_HOME,b.options.descriptor.dshHome);assert.equal(second.DSH_LAUNCH_TOKEN,'');
 await b.runtime.stop();await f.runtime.stop();
});

test('disable and replacement runtime preserve session data and installed source without explicit cleanup',async t=>{
 const f=await fixture(t),session=path.join(f.root,'state','owned-session.jsonl');await fs.mkdir(path.dirname(session), { recursive: true });await fs.writeFile(session,'synthetic retained history\n');
 const files=[session,path.join(f.root,'src','bridge.js'),f.marker,f.configFile],before=await Promise.all(files.map(file=>fs.readFile(file)));
 await f.runtime.start();await f.runtime.stop();await f.runtime.dispose();
 const replacement=api.createInstanceRuntime(f.options);try{await replacement.start();await replacement.stop();}finally{await replacement.dispose();}
 for(let i=0;i<files.length;i++)assert.deepEqual(await fs.readFile(files[i]),before[i]);
});

test('missing or altered managed dependency marker refuses startup without adopting an external Snow home', async t => {
  const f = await fixture(t);
  await fs.unlink(f.marker);
  await assert.rejects(f.runtime.start(), matches('MANAGED_DEPENDENCY_REQUIRED'));
  assert.equal(f.calls.length, 0);
  await assert.rejects(fs.access(f.registryDir), { code: 'ENOENT' });
  const external = api.createInstanceRuntime({ ...f.options, snowHome: path.dirname(f.root) });
  await assert.rejects(external.start(), matches('MANAGED_DEPENDENCY_REQUIRED'));
  await external.dispose();
});

test('manifest checks runtime binary and entry digests and the expected instance identity', async t => {
  const f = await fixture(t);
  const original = await fs.readFile(f.marker, 'utf8');
  await fs.writeFile(f.marker, JSON.stringify({ ...JSON.parse(original), instanceId: 'other-instance' }));
  await assert.rejects(f.runtime.start(), matches('MANAGED_DEPENDENCY_INVALID'));
  await fs.writeFile(f.marker, original);
  await fs.writeFile(path.join(f.snowHome, 'node.exe'), 'changed-runtime');
  await assert.rejects(f.runtime.start(), matches('MANAGED_DEPENDENCY_INVALID'));
  assert.equal(f.calls.length, 0);
});

test('start captures only direct owned children with isolated account/config/ports and stop releases the lease after bridge then Snow exit', async t => {
  const f = await fixture(t);
  const state = await f.runtime.start();
  assert.equal(state.state, 'running');
  assert.equal(state.readiness, 'unverified');
  assert.equal(f.calls.length, 2);
  const [snow, bridge] = f.calls;
  assert.equal(snow.file, path.join(f.snowHome, 'node.exe'));
  assert.equal(snow.options.cwd, f.snowHome);
  assert.equal(snow.options.env.SNOWLUMA_UPDATE_ROOT, f.snowHome);
  assert.equal(snow.options.env.SNOWLUMA_BRIDGE_UIN, '123456789');
  assert.equal(snow.options.env.SNOWLUMA_HOOK_AUTOLOAD, '0');
  assert.equal(snow.options.env.SNOWLUMA_ONEBOT_HTTP_PORT, '42000');
  assert.equal(snow.options.env.SNOWLUMA_WEBUI_HOST, '127.0.0.1');
  assert.ok(snow.args[0] === '--import' && snow.args[1].endsWith('/scripts/snow-bootstrap.mjs'));
  assert.equal(bridge.options.cwd, f.root);
  assert.deepEqual(bridge.args, [path.join(f.root, 'src', 'bridge.js')]);
  assert.equal(bridge.options.env.QQ_BRIDGE_INSTANCE_ID, 'public');
  assert.deepEqual(JSON.parse(bridge.options.env.QQ_BRIDGE_PRESET_MAP), readInstanceSessionPolicy({descriptor:f.options.descriptor}).presetMap);
  assert.equal(f.calls.every(call => call.options.detached === false), true);
  const onebot = JSON.parse(await fs.readFile(path.join(f.snowHome, 'config', 'onebot_123456789.json'), 'utf8'));
  assert.equal(onebot.mode, 'snapshot');
  assert.equal(onebot.networks.httpServers[0].host, '127.0.0.1');
  assert.equal(onebot.networks.httpServers[0].port, 42000);
  assert.equal(onebot.networks.wsServers[0].port, 42001);
  assert.equal(JSON.parse(await f.claim()).processes.length, 2);
  await f.runtime.start();
  assert.equal(f.calls.length, 2);
  await f.runtime.stop();
  assert.deepEqual(f.exits, ['bridge', 'snow']);
  assert.equal(f.children.every(child => child.exitCode !== null || child.signalCode !== null), true);
  await assert.rejects(f.claim(), { code: 'ENOENT' });
  assert.equal(f.runtime.status().state, 'stopped');
});

test('stop terminates owned gateway children that do not handle shutdown IPC', async t => {
  const f = await fixture(t, { childCode: 'setInterval(() => {}, 1000)' });
  await f.runtime.start();
  await f.runtime.stop();
  assert.deepEqual(f.exits, ['bridge', 'snow']);
  assert.equal(f.runtime.status().leaseHeld, false);
});

test('same QQ racing starts admit one instance; different QQ instances run concurrently', { timeout: 10000 }, async t => {
  const registryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-shared-account-registry-'));
  const instances = [];
  t.after(async () => {
    await Promise.all(instances.map(f => f.runtime.dispose()));
    await fs.rm(registryDir, { recursive: true, force: true });
  });
  const a = await fixture(t, { registryDir, instanceId: 'private' });
  instances.push(a);
  const b = await fixture(t, { registryDir, instanceId: 'public' });
  instances.push(b);
  const race = await Promise.allSettled([a.runtime.start(), b.runtime.start()]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1,
    JSON.stringify(race.map(result => ({ status: result.status, code: result.reason?.code, message: result.reason?.message }))));
  assert.ok(['ACCOUNT_IN_USE', 'ACCOUNT_BUSY'].includes(race.find(result => result.status === 'rejected').reason.code));
  const other = await fixture(t, { registryDir, botUin: '234567890', instanceId: 'other' });
  instances.push(other);
  assert.equal((await other.runtime.start()).state, 'running');
  assert.equal(a.children.length + b.children.length + other.children.length, 4);
});

test('occupied child-service port is probed read-only and leaves the external listener untouched', async t => {
  const external = http.createServer((req, res) => res.end('external-owner'));
  external.listen(0, '127.0.0.1'); await once(external, 'listening');
  t.after(() => new Promise(resolve => external.close(resolve)));
  const port = external.address().port;
  const f = await fixture(t, { runtimeOptions: { probePort: undefined } });
  await f.writeConfig({ consolePort: port, launcher: { ports: { ...f.ports, console: port } } });
  const before = await fs.readFile(f.configFile, 'utf8');
  await assert.rejects(f.runtime.start(), matches('INSTANCE_PORT_IN_USE'));
  assert.equal(f.calls.length, 0);
  assert.equal(await fs.readFile(f.configFile, 'utf8'), before);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'external-owner');
});

test('stop closes start admission and waits for in-flight child identity registration before releasing the lease', async t => {
  let reached, unblock;
  const atProbe = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { unblock = resolve; });
  const f = await fixture(t);
  let blocked = false;
  const runtime = api.createInstanceRuntime({ ...f.options, probeProcess: async pid => {
    if (pid !== process.pid && !blocked) { blocked = true; reached(); await gate; }
    return f.live.get(pid) ?? null;
  } });
  t.after(() => runtime.dispose());
  const starting = runtime.start();
  const expectedCancellation = assert.rejects(starting, matches('INSTANCE_START_CANCELLED'));
  await atProbe;
  let stopped = false;
  const stopping = runtime.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  assert.equal(JSON.parse(await f.claim()).processes.length, 0);
  await assert.rejects(runtime.start(), matches('INSTANCE_STOPPING'));
  unblock();
  await expectedCancellation;
  await stopping;
  assert.equal(f.calls.length, 1, 'a cancelled start must not spawn the bridge');
  assert.equal(f.children[0].exitCode !== null || f.children[0].signalCode !== null, true);
  await assert.rejects(f.claim(), { code: 'ENOENT' });
});

test('bridge spawn failure rolls back the owned Snow child and account lease', async t => {
  const f = await fixture(t, { spawnFailureAt: 2 });
  await assert.rejects(f.runtime.start(), /fixture spawn failed/);
  assert.equal(f.children.length, 1);
  assert.equal(f.children[0].exitCode !== null || f.children[0].signalCode !== null, true);
  await assert.rejects(f.claim(), { code: 'ENOENT' });
});

test('uncertain stop holds the lease and admits safe retry; disposal permanently closes new starts', async t => {
  const f = await fixture(t);
  await f.runtime.start();
  const record = f.live.get(f.children[1].pid);
  f.live.set(record.pid, { ...record, startTime: 'unexpected-identity' });
  await assert.rejects(f.runtime.stop(), matches('PROCESS_IDENTITY_CHANGED'));
  assert.equal(f.children.every(child => child.exitCode === null && child.signalCode === null), true);
  assert.equal(JSON.parse(await f.claim()).processes.length, 2);
  f.live.set(record.pid, record);
  await f.runtime.stop();
  await f.runtime.dispose();
  await assert.rejects(f.runtime.start(), matches('INSTANCE_DISPOSED'));
});

test('changing configuration while running refuses another start until the owned runtime is stopped', async t => {
  const f = await fixture(t);
  await f.runtime.start();
  await f.writeConfig({ ownerQQ: 345678901 });
  await assert.rejects(f.runtime.start(), matches('INSTANCE_CONFIG_CHANGED'));
  assert.equal(f.calls.length, 2);
  await f.runtime.stop();
  assert.equal((await f.runtime.start()).state, 'running');
  assert.equal(f.calls.length, 4);
});

test('launcher-only port save leaves real owned runtime duplicate start idempotent',async t=>{
  const f=await fixture(t);const before=await f.runtime.start(),pids=before.children.map(child=>child.pid);
  saveLauncherSettings(f.root,{ports:{launcher:42299}});
  const after=await f.runtime.start();assert.equal(after.state,'running');assert.equal(after.configRevision,before.configRevision);
  assert.deepEqual(after.children.map(child=>child.pid),pids);assert.equal(f.calls.length,2);
});

test('saving the same effective settings tolerates added default fields and equivalent owner/list normalization',async t=>{
  const f=await fixture(t);
  await f.writeConfig({ownerQQ:'345678901',allow:{private:['456789012'],groups:[]}});
  const before=await f.runtime.start(),bytes=await fs.readFile(f.configFile,'utf8');
  const selected=readLauncherSettings(f.root);
  saveLauncherSettings(f.root,{...selected,ownerQQ:'345678901',allow:{private:['456789012'],groups:[]}});
  assert.notEqual(await fs.readFile(f.configFile,'utf8'),bytes);
  const after=await f.runtime.start();assert.equal(after.configRevision,before.configRevision);assert.equal(f.calls.length,2);
});

test('semantic runtime revision retains same-port DSH host path protocol, Snow token and other real config changes',async t=>{
  const f=await fixture(t);
  await f.writeConfig({dsh:{baseUrl:'http://127.0.0.1:42080/rpc'}});
  const original=JSON.parse(await fs.readFile(f.configFile,'utf8')),started=await f.runtime.start();
  const changes=[
    {...original,dsh:{baseUrl:'http://localhost:42080/rpc'}},
    {...original,dsh:{baseUrl:'http://127.0.0.1:42080/other'}},
    {...original,dsh:{baseUrl:'https://127.0.0.1:42080/rpc'}},
    {...original,snowluma:{...original.snowluma,accessToken:'changed-synthetic-token'}},
    {...original,allow:{private:[345678901],groups:[]}},
    {...original,sessionCwd:'synthetic-workspace'},
  ];
  for(const cfg of changes){
    await fs.writeFile(f.configFile,JSON.stringify(cfg));
    await assert.rejects(f.runtime.start(),matches('INSTANCE_CONFIG_CHANGED'));
    assert.equal(f.calls.length,2);assert.deepEqual(f.runtime.status().children.map(child=>child.pid),started.children.map(child=>child.pid));
  }
  await fs.writeFile(f.configFile,JSON.stringify(original));assert.equal((await f.runtime.start()).state,'running');
});

test('native process identities stop only real isolated sleeper children while an unrelated sleeper remains alive', { timeout: 30000 }, async t => {
  const external = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(external, 'spawn');
  t.after(async () => { const exited = once(external, 'exit'); external.kill(); await exited; });
  const f = await fixture(t, { native: true, runtimeOptions: { stopTimeoutMs: 3000 } });
  await f.runtime.start();
  await f.runtime.stop();
  assert.equal(external.exitCode, null);
  assert.equal(external.signalCode, null);
  assert.equal(f.children.every(child => child.exitCode !== null || child.signalCode !== null), true);
});


test('bridge receives native IPC and descriptor settings identity; ambient consent and other-instance identity cannot leak',async t=>{
 const f=await fixture(t,{runtimeOptions:{env:{...process.env,SNOWLUMA_ACCEPT_EULA:'true',SNOWLUMA_ACCEPT_PRIVACY:'true',QQ_BRIDGE_ROOT:'foreign',QQ_BRIDGE_SETTINGS_NAMESPACE:'foreign',SNOWLUMA_HOME:'foreign-home',SNOWLUMA_HTTP_URL:'http://foreign.invalid',SNOWLUMA_TOKEN:'foreign-token'}}});
 await f.runtime.start();const [snow,bridge]=f.calls;
 assert.deepEqual(bridge.options.stdio,['ignore','ignore','ignore','ipc']);
 assert.equal(bridge.options.env.QQ_BRIDGE_ROOT,f.root);assert.equal(bridge.options.env.QQ_BRIDGE_SETTINGS_NAMESPACE,'public');
 assert.ok(bridge.options.env.QQ_BRIDGE_RUNTIME_GENERATION);assert.equal(snow.options.env.SNOWLUMA_ACCEPT_EULA,undefined);assert.equal(snow.options.env.SNOWLUMA_ACCEPT_PRIVACY,undefined);assert.equal(bridge.options.env.SNOWLUMA_HOME,undefined);assert.equal(bridge.options.env.SNOWLUMA_HTTP_URL,undefined);assert.equal(bridge.options.env.SNOWLUMA_TOKEN,undefined);
});

test('unexpected Snow exit fails runtime and requires explicit cleanup before restart',async t=>{
 const f=await fixture(t);await f.runtime.start();const exited=once(f.children[0],'exit');f.children[0].kill();await exited;
 assert.equal(f.runtime.status().state,'failed');await assert.rejects(f.runtime.start(),matches('INSTANCE_STOP_REQUIRED'));await f.runtime.stop();assert.equal(f.runtime.status().leaseHeld,false);
});

test('runtime marker rejects missing asset hashes, hardlinks and junction escape before spawn',async t=>{
 const f=await fixture(t),original=JSON.parse(await fs.readFile(f.marker,'utf8'));
 for(const name of ['index.mjs','node.exe']){const m=structuredClone(original);delete m.files[name];await fs.writeFile(f.marker,JSON.stringify(m));await assert.rejects(f.runtime.start(),matches('MANAGED_DEPENDENCY_INVALID'));}
 await fs.writeFile(f.marker,JSON.stringify(original));const binary=path.join(f.snowHome,'node.exe'),outside=path.join(f.root,'outside');await fs.rename(binary,outside);await fs.link(outside,binary);
 await assert.rejects(f.runtime.start(),matches('MANAGED_DEPENDENCY_INVALID'));assert.equal(f.calls.length,0);
});

const ipcModule=new URL('../src/instance-runtime-ipc.mjs',import.meta.url).href;
const workerCode=`(async()=>{const {createRuntimeIpcClient}=await import(${JSON.stringify(ipcModule)});const client=createRuntimeIpcClient({onShutdown:async()=>{if(process.env.QQ_BRIDGE_WORKER_KIND)await client.reportCleanup({clean:true,error:''});process.exit(0)}});process.on('message',async m=>{if(m==='shutdown')process.exit(0);if(m.test==='exit'){if(process.env.QQ_BRIDGE_WORKER_KIND)await client.reportCleanup({clean:true,error:''});process.exit(0);}if(m.test==='worker'){try{process.send({testReply:m.id,result:await client.spawnWorker(m.kind,m.args||[])});}catch(e){process.send({testReply:m.id,error:e.code});}}});setInterval(()=>{},1000);})()`;
function workerRequest(child,kind,args=[]){const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.off('message',listen);reject(Error('fixture IPC timeout'));},8000);const listen=m=>{if(m.testReply===id){clearTimeout(timer);child.off('message',listen);resolve(m);}};child.on('message',listen);child.send({test:'worker',id,kind,args});});}

test('disable drains owned monitor and login workers; other bot and external sleeper remain alive',async t=>{
 const external=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});await once(external,'spawn');t.after(async()=>{const end=once(external,'exit');external.kill();await end;});
 const a=await fixture(t,{childCode:workerCode}),b=await fixture(t,{botUin:'234567890',instanceId:'other',childCode:workerCode});
 await a.runtime.start();await b.runtime.start();
 assert.equal((await workerRequest(a.children[1],'web-watch')).result.accepted,true);
 assert.equal((await workerRequest(a.children[2],'login-window')).result.accepted,true);
 assert.equal((await workerRequest(a.children[1],'arbitrary-command')).error,'WORKER_UNSUPPORTED');
 assert.equal((await workerRequest(a.children[1],'web-watch',['--inspect'])).error,'WORKER_ARGUMENT_INVALID');
 await a.runtime.stop();assert.equal(a.children.length,4);assert.ok(a.children.every(c=>c.exitCode!==null||c.signalCode!==null));assert.ok(b.children.every(c=>c.exitCode===null&&c.signalCode===null));assert.equal(external.exitCode,null);
 await assert.rejects(a.claim(),{code:'ENOENT'});
});

test('worker spawn failure is not acknowledged and lease remains held until verified stop',async t=>{
 const f=await fixture(t,{childCode:workerCode,spawnFailureAt:3});await f.runtime.start();
 const result=await workerRequest(f.children[1],'web-watch');assert.equal(result.error,'IPC_OPERATION_FAILED');assert.equal(f.runtime.status().state,'failed');assert.equal(f.runtime.status().leaseHeld,true);await f.runtime.stop();assert.equal(f.runtime.status().leaseHeld,false);
});
