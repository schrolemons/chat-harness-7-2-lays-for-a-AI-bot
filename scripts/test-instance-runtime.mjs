import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
  await fs.mkdir(snowHome, { recursive: true });
  await fs.mkdir(path.join(root, 'src'));
  await fs.mkdir(path.join(root, 'scripts'));
  const entry = 'setInterval(() => {}, 1000);\n';
  await fs.writeFile(path.join(snowHome, 'index.mjs'), entry);
  await fs.writeFile(path.join(snowHome, 'node.exe'), 'fixture-runtime-binary');
  await fs.writeFile(path.join(root, 'src', 'bridge.js'), entry);
  await fs.writeFile(path.join(root, 'scripts', 'snow-bootstrap.mjs'), '// fixture preload\n');
  for(const kind of ['campus-watch','login-window'])await fs.writeFile(path.join(root,'scripts',kind+'.mjs'),entry);
  const marker = path.join(snowHome, '.qq-bridge-managed.json');
  await fs.writeFile(marker, JSON.stringify({ version: 1, kind: 'snowluma', instanceId, entry: 'index.mjs', runtime: 'node.exe',
    files: { 'index.mjs': hash(entry), 'node.exe': hash('fixture-runtime-binary') } }));
  const configFile = path.join(root, 'config.json');
  const ports = { dsh: 42080, console: 42100, snowHttp: 42000, snowWs: 42001, launcher: 42199, snowWebui: 45099 };
  let config = { launcher: { ports }, consolePort: ports.console, snowluma: { botUin, accessToken: 'fixture-token',
    httpUrl: `http://127.0.0.1:${ports.snowHttp}`, wsUrl: `ws://127.0.0.1:${ports.snowWs}` } };
  await fs.writeFile(configFile, JSON.stringify(config));
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
  const descriptor={version:1,instanceId,label:'Fixture bot',root,dshHome:path.dirname(registryDir),registryDir,entryId:instanceId,settingsNamespace:instanceId,presetIdMap:{}};
  await fs.writeFile(path.join(root,'.qq-bridge-instance.json'),JSON.stringify(descriptor));
  const runtimeOptions = { descriptor, root, instanceId, registryDir, nodePath: process.execPath, snowHome,
    probePort: async () => false, probeProcess: probe, spawnProcess, stopTimeoutMs: 1500,
    presetMap: readInstanceSessionPolicy({descriptor}).presetMap, ...options.runtimeOptions };
  const runtime = api.createInstanceRuntime(runtimeOptions);
  t.after(async () => {
    try { await runtime.dispose(); }
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
  assert.equal(f.calls.every(call => call.options.windowsHide === true && call.options.detached === false), true);
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
const workerCode=`(async()=>{const {createRuntimeIpcClient}=await import(${JSON.stringify(ipcModule)});const client=createRuntimeIpcClient({onShutdown:()=>process.exit(0)});process.on('message',async m=>{if(m==='shutdown'||m.test==='exit')process.exit(0);if(m.test==='worker'){try{process.send({testReply:m.id,result:await client.spawnWorker(m.kind,m.args||[])});}catch(e){process.send({testReply:m.id,error:e.code});}}});setInterval(()=>{},1000);})()`;
function workerRequest(child,kind,args=[]){const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.off('message',listen);reject(Error('fixture IPC timeout'));},3000);const listen=m=>{if(m.testReply===id){clearTimeout(timer);child.off('message',listen);resolve(m);}};child.on('message',listen);child.send({test:'worker',id,kind,args});});}

test('disable drains owned monitor and login workers; other bot and external sleeper remain alive',async t=>{
 const external=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});await once(external,'spawn');t.after(async()=>{const end=once(external,'exit');external.kill();await end;});
 const a=await fixture(t,{childCode:workerCode}),b=await fixture(t,{botUin:'234567890',instanceId:'other',childCode:workerCode});
 await a.runtime.start();await b.runtime.start();
 assert.equal((await workerRequest(a.children[1],'campus-watch')).result.accepted,true);
 assert.equal((await workerRequest(a.children[2],'login-window')).result.accepted,true);
 assert.equal((await workerRequest(a.children[1],'arbitrary-command')).error,'WORKER_UNSUPPORTED');
 assert.equal((await workerRequest(a.children[1],'campus-watch',['--inspect'])).error,'WORKER_ARGUMENT_INVALID');
 await a.runtime.stop();assert.equal(a.children.length,4);assert.ok(a.children.every(c=>c.exitCode!==null||c.signalCode!==null));assert.ok(b.children.every(c=>c.exitCode===null&&c.signalCode===null));assert.equal(external.exitCode,null);
 await assert.rejects(a.claim(),{code:'ENOENT'});
});

test('worker spawn failure is not acknowledged and lease remains held until verified stop',async t=>{
 const f=await fixture(t,{childCode:workerCode,spawnFailureAt:3});await f.runtime.start();
 const result=await workerRequest(f.children[1],'campus-watch');assert.equal(result.error,'IPC_OPERATION_FAILED');assert.equal(f.runtime.status().state,'failed');assert.equal(f.runtime.status().leaseHeld,true);await f.runtime.stop();assert.equal(f.runtime.status().leaseHeld,false);
});

test('worker refusal to shut down prevents a false stopped result after bridge has exited',async t=>{
 const code=workerCode.replace('onShutdown:()=>process.exit(0)',"onShutdown:()=>{if(!process.env.QQ_BRIDGE_WORKER_KIND)process.exit(0)}");
 const f=await fixture(t,{childCode:code,runtimeOptions:{stopTimeoutMs:100}});await f.runtime.start();await workerRequest(f.children[1],'campus-watch');
 await assert.rejects(f.runtime.stop(),matches('PROCESS_STOP_FAILED'));assert.notEqual(f.children[1].exitCode,null);assert.equal(f.children[2].exitCode,null);assert.equal(f.runtime.status().uncertain,true);assert.equal(f.runtime.status().leaseHeld,true);
 const ended=once(f.children[2],'exit');f.children[2].send({test:'exit'});await ended;await f.runtime.stop();
});


test('worker admission closes synchronously and stop drains a worker registering when disabled',async t=>{
 const f=await fixture(t,{childCode:workerCode});let release,entered;const gate=new Promise(r=>release=r),at=new Promise(r=>entered=r);let blocked=false;
 const runtime=api.createInstanceRuntime({...f.options,probeProcess:async pid=>{if(f.children.length===3&&pid===f.children[2].pid&&!blocked){blocked=true;entered();await gate;}return f.live.get(pid)||null;}});t.after(()=>runtime.dispose());
 await runtime.start();const first=workerRequest(f.children[1],'campus-watch');await at;const stopping=runtime.stop();const late=await workerRequest(f.children[1],'campus-watch');assert.equal(late.error,'RUNTIME_CLOSING');assert.equal(f.children.length,3);release();await first;await stopping;assert.equal(runtime.status().leaseHeld,false);
});
