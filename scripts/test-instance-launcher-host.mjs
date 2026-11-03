import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createLauncher } from '../plugins/qq-launcher/lib/index.js';

async function port() {
  const server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'instance-launcher-'));
  const descriptor = { root, instanceId: extra.id || 'alpha', label: 'Synthetic bot', settingsNamespace: 'alpha-mode',bundleName:'synthetic-bot-module' };
  const ports = { dsh: 48080, console: 48100, snowHttp: 48000, snowWs: 48001, snowWebui: 48099, launcher: extra.launcherPort || await port() };
  await fs.writeFile(path.join(root, '.qq-bridge-instance.json'), JSON.stringify(descriptor));
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({ launcher: { ports }, snowluma: { botUin: '123456789' } }));
  const events = [], hooks = new Map(); let state = 'stopped', disposed = false;
  const runtime = { status: () => ({ state, uncertain: state === 'failed', leaseHeld: state === 'failed', readiness: 'unverified' }),
    async start() { if (disposed) throw Error('disposed'); events.push('start'); state = 'running'; return this.status(); },
    async stop() { events.push('stop'); if (extra.stopError) { state = 'failed'; throw Error('synthetic uncertain stop'); } state = 'stopped'; return this.status(); },
    async dispose() { disposed = true; events.push('dispose'); return this.stop(); }, ...extra.runtime };
  const forbidden = () => { throw Error('legacy takeover invoked'); };
  const ctx = extra.ctx || { on(name, fn) { hooks.set(name, fn); return () => hooks.delete(name); } };
  const handle = (extra.factory||createLauncher)(ctx, { descriptor, runtime, servicePort: 0 }, { settingsRoot: root, spawnRunner: forbidden, execFile: forbidden,
    isQqRunning: forbidden, health: forbidden, tcpProbe: forbidden, ...extra.deps });
  t.after(async () => { await (typeof handle === 'function' ? handle() : handle.dispose()); await fs.rm(root, { recursive: true, force: true }); });
  assert.equal(typeof handle, 'object', 'descriptor path must return an owned handle, never a legacy disposer');
  await handle.ready;
  const url = handle.address();
  async function request(route, body, identity = true) {
    const response = await fetch(url + route, { ...(body === undefined ? {} : { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(identity ? await identityOf(handle) : {}), ...body }) }), signal: AbortSignal.timeout(3000) });
    return { ...await response.json(), code: response.status };
  }
  return { root, descriptor, ports, runtime, events, hooks, handle, url, request, bytes: () => fs.readFile(path.join(root, 'config.json'), 'utf8') };
}
async function identityOf(handle) { return (await (await fetch(handle.address() + '/status')).json()); }

test('shared native discovery is owner-only, fresh, projected and retained across first removal', async t => {
  const channels = new Map(), hooks = new Map(); let disposed = 0;
  const root = { on(name, fn) { hooks.set(name, fn); return () => hooks.delete(name); },
    inject(deps, apply) {
      assert.deepEqual(deps, ['connection', 'webServer']);
      const removals = [];
      apply({ connection: { rpc: { handle(channel, handler) {
        assert.ok(!channels.has(channel), 'one native channel across module copies'); channels.set(channel, handler);
        const remove = async () => { channels.delete(channel); }; removals.push(remove); return remove;
      } } } });
      return { async dispose() { disposed++; await Promise.all(removals.map(fn => fn())); } };
    } };
  const a = await fixture(t, { id: 'a', ctx: { root } });
  const second = await import('../src/instance-launcher-host.mjs?discovery-copy');
  const b = await fixture(t, { id: 'b', ctx: { root }, factory: second.createInstanceLauncher });
  const handler = channels.get('/qq-bot-discovery'); assert.equal(typeof handler, 'function');
  const read = () => handler('list', {}, new AbortController().signal, { principal: { kind: 'owner' } });
  const first = await read(); assert.deepEqual(Object.keys(first.value).sort(), ['a','b']);
  assert.deepEqual(Object.keys(first.value.a).sort(), ['clientModuleId','generation','label','serviceUrl']);
  assert.equal((await handler('list', {}, null, { principal: { kind: 'api' } })).ok, false);
  assert.equal((await handler('write', {}, null, { principal: { kind: 'owner' } })).ok, false);
  await a.handle.dispose(); assert.equal(disposed, 0); assert.deepEqual(Object.keys((await read()).value), ['b']);
  await b.handle.dispose(); assert.equal(disposed, 1); assert.equal(channels.size, 0); assert.equal(hooks.size, 0);
});

test('last discovery cleanup and immediate re-enable serialize the exact native channel owner',async t=>{
  const gate=deferred(),entered=deferred(),channels=new Map();let registrations=0,disposals=0;
  const root={on(){return ()=>{};},inject(deps,apply){
    let remove;apply({connection:{rpc:{handle(channel,handler){assert.equal(channels.has(channel),false);registrations++;channels.set(channel,handler);remove=()=>channels.delete(channel);return remove;}}}});
    return {async dispose(){disposals++;if(disposals===1){entered.resolve();await gate.promise;}remove();}};
  }};
  const a=await fixture(t,{id:'a',ctx:{root}});const stopping=a.handle.dispose();await entered.promise;
  const b=await fixture(t,{id:'b',ctx:{root}});assert.equal(registrations,1);gate.resolve();await stopping;await new Promise(r=>setImmediate(r));
  assert.equal(registrations,2);const result=await channels.get('/qq-bot-discovery')('list',{},null,{principal:{kind:'owner'}});
  assert.deepEqual(Object.keys(result.value),['b']);await b.handle.dispose();assert.equal(channels.size,0);assert.equal(disposals,2);
});

test('owned controls never use legacy takeover and start means spawned rather than healthy', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.events, [], 'enable must not start or send');
  const status = await f.request('/status'); assert.equal(status.instanceId, 'alpha'); assert.equal(status.serviceUrl, f.url);
  assert.equal(typeof status.generation, 'string');
  assert.equal((await f.request('/config')).configured,true);
  const started = await f.request('/start', {}); assert.equal(started.code, 200); assert.equal(started.readiness, 'unverified');
  assert.equal(started.runtime.state, 'running'); assert.equal(started.instanceId, 'alpha');
  await f.request('/stop', {}); assert.deepEqual(f.events, ['start', 'stop']);
  await f.handle.dispose(); assert.deepEqual(f.events, ['start', 'stop'], 'launcher closes admission/listeners; controller owns runtime disposal');
});

test('stale A URL reused by B refuses missing, wrong instance or generation before all mutating effects', async t => {
  const a = await fixture(t), stale = await identityOf(a.handle); await a.handle.dispose();
  const b = await fixture(t, { id: 'beta', launcherPort: a.ports.launcher }), bytes = await b.bytes();
  assert.equal(a.url,b.url,'the exact stale URL must now address B');
  for (const identity of [{}, {instanceId:stale.instanceId,generation:stale.generation}, {instanceId:'beta',generation:stale.generation}]) {
    for (const route of ['/start','/stop','/restart','/config']) {
      const response = await fetch(b.url + route, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...identity,ports:{launcher:await port()},botUin:'987654321'})});
      assert.equal(response.status, 409); assert.equal((await response.json()).instanceId, 'beta');
    }
  }
  assert.deepEqual(b.events, []); assert.equal(await b.bytes(), bytes);
});

test('restart and concurrent controls serialize, and failed stop never starts again', async t => {
  const gate = deferred(), entered = deferred(); let calls = 0;
  const f = await fixture(t, { runtime: { async stop() { calls++; entered.resolve(); await gate.promise; } } });
  const stopping = f.request('/stop', {}); await entered.promise;
  const starting = f.request('/start', {}); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.events, []); gate.resolve(); await stopping; await starting; assert.equal(calls, 1); assert.deepEqual(f.events, ['start']);
  const failed = await fixture(t, { stopError: true });
  const result = await failed.request('/restart', {}); assert.equal(result.code, 500); assert.deepEqual(failed.events, ['stop']);
  assert.equal(result.runtime.uncertain, true); assert.equal(result.runtime.leaseHeld, true);
  const denied = await failed.request('/start', {}); assert.equal(denied.code, 409); assert.deepEqual(failed.events, ['stop']);
});

test('port save drains old response, moves identity and reports pending runtime restart truthfully', async t => {
  const servers = []; let boundary;
  const f = await fixture(t, { deps: { createHttpServer: handler => {
    const server = http.createServer(handler); servers.push(server);
    server.on('request', (req,res) => { if(req.method === 'POST') res.once('prefinish', () => { boundary = servers.map(s => s.listening); }); });
    return server;
  } } });
  await f.request('/start', {}); const before = await identityOf(f.handle), target = await port();
  const saved = await f.request('/config', { revision: (await f.request('/config')).revision, ports: { launcher:target, console:await port() } });
  assert.equal(saved.code, 200); assert.deepEqual(boundary, [true,true]);
  assert.equal(saved.serviceUrl, `http://127.0.0.1:${target}`); assert.notEqual(saved.generation, before.generation);
  assert.equal(saved.needsRestart, true); assert.equal(saved.runtime.state, 'running'); assert.deepEqual(f.events,['start']);
  const response = await fetch(saved.serviceUrl + '/status'); assert.equal((await response.json()).needsRestart, true);
  const stale=await fetch(saved.serviceUrl+'/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({instanceId:'alpha',generation:before.generation})});
  assert.equal(stale.status,409); assert.deepEqual(f.events,['start']);
  const restarted = await fetch(saved.serviceUrl+'/restart',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({instanceId:'alpha',generation:saved.generation})});
  assert.equal((await restarted.json()).needsRestart,false); assert.deepEqual(f.events,['start','stop','start']);
});

test('one host registry producer aggregates instances and removes only its own generation', async t => {
  const hooks=new Map(); let registrations=0;
  const root={on(name,fn){registrations++;hooks.set(name,fn);return()=>hooks.delete(name);}};
  // Installed bundles load separate module copies but share this exact DSH root.
  const {createInstanceLauncher}=await import('../src/instance-launcher-host.mjs?synthetic-second-install');
  const a=await fixture(t,{ctx:{root}}), b=await fixture(t,{id:'beta',ctx:{root},factory:createInstanceLauncher});
  assert.equal(registrations,1); const table=[]; hooks.get('webserver/index-inject')(table);
  assert.equal(table.length,1); assert.equal(table[0].name,'__qqBotInstances'); assert.deepEqual(Object.keys(table[0].value).sort(),['alpha','beta']);
  assert.equal(table[0].value.alpha.clientModuleId,'synthetic-bot-module');
  assert.equal(JSON.stringify(table).includes(a.root),false); assert.equal(JSON.stringify(table).includes('token'),false);
  await a.handle.dispose(); const remaining=[];hooks.get('webserver/index-inject')(remaining);
  assert.deepEqual(Object.keys(remaining[0].value),['beta']); await b.handle.dispose(); assert.equal(hooks.size,0);
});

test('port conflicts and invalid settings preserve config and external listener; hostile origin is refused', async t => {
  const external = http.createServer((req,res)=>res.end('external')); external.listen(0,'127.0.0.1'); await once(external,'listening');
  t.after(()=>new Promise(resolve=>external.close(resolve)));
  const f=await fixture(t), before=await f.bytes();
  const rejected=await f.request('/config',{ports:{launcher:external.address().port}}); assert.equal(rejected.code,400);
  assert.equal(await f.bytes(),before); assert.equal(await (await fetch(`http://127.0.0.1:${external.address().port}`)).text(),'external');
  assert.equal((await f.request('/config',{ports:{console:f.ports.snowHttp}})).code,400); assert.equal(await f.bytes(),before);
  const response=await fetch(f.url+'/start',{method:'POST',headers:{origin:'https://hostile.invalid','content-type':'application/json'},body:JSON.stringify(await identityOf(f.handle))});
  assert.equal(response.status,403); assert.deepEqual(f.events,[]);
});

test('legacy compatibility refuses a declared instance before scanning, spawning or binding', async t => {
  const f=await fixture(t);
  assert.throws(()=>createLauncher({}, {bridgeDir:f.root}, {settingsRoot:f.root,spawnRunner:()=>{throw Error('wrong');}}), /INSTANCE_LAUNCHER_REQUIRED/);
});

test('production Node selection rejects Electron and PATH commands before executing anything', async t => {
  const api=await import('../src/dsh-instance-factories.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
  assert.equal(typeof api.resolveInstanceNode,'function','production factory must choose a verified absolute Node');
  const f=await fixture(t), host={execPath:path.join(f.root,'DeepSeek Harness.exe'),versions:{electron:'synthetic'}};
  for(const nodePath of [undefined,'node',host.execPath])await assert.rejects(api.resolveInstanceNode({descriptor:f.descriptor,config:{nodePath},host}),/NODE_RUNTIME_REQUIRED/);
  assert.equal(await api.resolveInstanceNode({descriptor:f.descriptor,config:{nodePath:process.execPath},host}),await fs.realpath(process.execPath));
});

test('Electron MCP adapter refuses implicit PATH Node before importing or mounting a child', async () => {
  const {mountBundledMcp}=await import('../dsh-mcp-entry.mjs');
  const previous=Object.getOwnPropertyDescriptor(process.versions,'electron');
  Object.defineProperty(process.versions,'electron',{value:'synthetic',configurable:true});
  let mounted=0;
  try { await assert.rejects(mountBundledMcp({plugin(){mounted++;}}, {root:os.tmpdir(),serverName:'snowluma',hostImport:async()=>{throw Error('must reject before import');}}),/NODE_RUNTIME_REQUIRED/); }
  finally {if(previous)Object.defineProperty(process.versions,'electron',previous);else delete process.versions.electron;}
  assert.equal(mounted,0);
});

test('settings refuse transitional runtime changes and malformed JSON without writing or binding', async t => {
  let created=0;
  const f=await fixture(t,{runtime:{status:()=>({state:'starting',uncertain:false})},deps:{createHttpServer:handler=>{created++;return http.createServer(handler);}}});
  const before=await f.bytes();assert.equal((await f.request('/config',{ports:{launcher:await port()}})).code,409);
  assert.equal(await f.bytes(),before);assert.equal(created,1);
  const bad=await fetch(f.url+'/config',{method:'POST',headers:{'content-type':'application/json'},body:'{'});
  assert.equal(bad.status,400);assert.equal(await f.bytes(),before);
});

test('initial listener conflict rejects ready without starting runtime or disturbing its external owner', async t => {
  const external=http.createServer((req,res)=>res.end('independent owner'));external.listen(0,'127.0.0.1');await once(external,'listening');
  t.after(()=>new Promise(resolve=>external.close(resolve)));let starts=0;
  await assert.rejects(fixture(t,{launcherPort:external.address().port,runtime:{start:async()=>{starts++;}}}),{code:'EADDRINUSE'});
  assert.equal(starts,0);assert.equal(await(await fetch(`http://127.0.0.1:${external.address().port}`)).text(),'independent owner');
});

test('concurrent port saves recheck generation at execution and open only one candidate', async t => {
  const gate=deferred(),entered=deferred(),bothRequests=deferred();let created=0,posts=0;
  const f=await fixture(t,{deps:{createHttpServer:handler=>{
    const server=http.createServer(handler);server.on('request',req=>{if(req.method==='POST'&&++posts===2)bothRequests.resolve();});
    if(++created===2){const listen=server.listen.bind(server);server.listen=(...args)=>{entered.resolve();void gate.promise.then(()=>listen(...args));return server;};}
    return server;
  }}});
  const identity=await identityOf(f.handle),revision=(await f.request('/config')).revision;
  const send=launcher=>fetch(f.url+'/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({instanceId:'alpha',generation:identity.generation,revision,ports:{launcher}})});
  try{
    const first=send(await port());await entered.promise;const second=send(await port());await bothRequests.promise;gate.resolve();
    const results=await Promise.all([first,second]);assert.deepEqual(results.map(r=>r.status),[200,409]);assert.equal(created,2);
    const saved=await results[0].json();assert.equal(JSON.parse(await f.bytes()).launcher.ports.launcher,Number(new URL(saved.serviceUrl).port));
  }finally{gate.resolve();}
});

test('atomic save failure closes candidate and preserves old generation, address and config bytes', async t => {
  const f=await fixture(t),before=await f.bytes(),identity=await identityOf(f.handle),target=await port();
  const rename=syncFs.renameSync;
  syncFs.renameSync=(source,destination)=>{if(destination===path.join(f.root,'config.json'))throw Error('synthetic rename denied');return rename(source,destination);};
  let result;
  try{result=await f.request('/config',{ports:{launcher:target}});}finally{syncFs.renameSync=rename;}
  assert.equal(result.code,400);assert.equal(await f.bytes(),before);assert.equal(result.generation,identity.generation);assert.equal(result.serviceUrl,f.url);
  assert.equal((await fs.readdir(f.root)).some(file=>file.endsWith('.tmp')),false);
  const server=http.createServer();server.listen(target,'127.0.0.1');await once(server,'listening');await new Promise(resolve=>server.close(resolve));
});

test('dispose during candidate binding closes admission, cancels write and drains accepted error response', async t => {
  const servers=[];let disposal;
  const f=await fixture(t,{deps:{createHttpServer:handler=>{
    const server=http.createServer(handler);servers.push(server);
    if(servers.length===2)server.once('listening',()=>{disposal=f.handle.dispose();});return server;
  }}});
  const before=await f.bytes(),result=await f.request('/config',{ports:{launcher:await port()}});
  assert.equal(result.code,409);await disposal;assert.equal(f.handle.dispose(),disposal);
  assert.equal(await f.bytes(),before);assert.equal(servers.every(server=>!server.listening),true);assert.deepEqual(f.events,[]);
});

test('runtime fingerprint read failure returns the original configuration error without breaking error response handling',async t=>{
  const f=await fixture(t,{runtime:{status:()=>({state:'running',configRevision:'synthetic-active-revision'})}});
  await fs.writeFile(path.join(f.root,'config.json'),'{');
  const response=await fetch(f.url+'/status',{signal:AbortSignal.timeout(1000)}),body=await response.json();
  assert.equal(response.status,500);assert.equal(body.ok,false);assert.equal(body.needsRestart,true);assert.match(body.error,/配置损坏/);
});
