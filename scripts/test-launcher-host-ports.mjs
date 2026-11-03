import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createLauncher } from '../plugins/qq-launcher/lib/index.js';

const defaultPorts = new Set([3080, 3100, 3000, 3001, 3199, 5099]);
async function listen(server, port = 0) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function unusedPort(excluded = new Set()) {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return defaultPorts.has(port) || excluded.has(port) ? unusedPort(excluded) : port;
}
async function request(base, body) {
  const response = await fetch(base + '/config', { ...(body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(2500) });
  return { code: response.status, ...await response.json() };
}
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-host-ports-'));
  const target = path.join(root, 'config.json');
  fs.writeFileSync(target, JSON.stringify(options.initial || {}));
  const hooks = new Map();
  const ctx = { on(event, handler) { hooks.set(event, handler); return () => hooks.delete(event); } };
  const deps = { settingsRoot: root, isQqRunning: async () => false, tcpProbe: async () => false,
    health: async () => ({ healthy: false }), ...options.deps };
  let dispose = createLauncher(ctx, options.config || { servicePort: 0 }, deps);
  const server = dispose.server;
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, target, hooks, base, server, current: () => dispose.server, dispose: () => dispose(),
    read: () => fs.readFileSync(target, 'utf8'),
    reload: async config => { await dispose(); dispose = createLauncher(ctx, config, deps); await once(dispose.server, 'listening'); } };
}

test('GET/POST 返回实际监听地址，端口单独保存时先接通新地址并关闭旧监听', async t => {
  const servers = [];
  let responseBoundary;
  const f = await fixture(t, { deps: { createHttpServer: handler => {
    const server = http.createServer(handler); servers.push(server);
    server.on('request', (req, res) => {
      if (req.method === 'POST') res.once('prefinish', () => {
        responseBoundary = { oldListening: servers[0].listening, newListening: servers[1]?.listening,
          persistedPort: JSON.parse(f.read()).launcher?.ports?.launcher };
      });
    });
    return server;
  } } });
  const initial = await request(f.base);
  assert.equal(initial.serviceUrl, f.base);
  assert.equal(initial.configured, false);
  const port = await unusedPort();
  const closed = once(f.server, 'close');
  const result = await request(f.base, { ports: { launcher: port }, revision: initial.revision });
  assert.equal(result.code, 200);
  assert.equal(result.configured, false);
  assert.equal(result.serviceUrl, `http://127.0.0.1:${port}`);
  assert.deepEqual(responseBoundary, { oldListening: true, newListening: true, persistedPort: port });
  const table = [];
  f.hooks.get('webserver/index-inject')(table);
  assert.equal(table[0].value, result.serviceUrl);
  assert.equal((await request(result.serviceUrl)).ports.launcher, port);
  await closed;
  assert.equal(f.server.listening, false);
  assert.notEqual(f.current(), f.server);
});

test('并发端口保存只接受一个版本，其余请求不能创建另一份候选监听', async t => {
  const servers = [];
  const f = await fixture(t, { deps: { createHttpServer: handler => {
    const server = http.createServer(handler); servers.push(server); return server;
  } } });
  const { revision } = await request(f.base);
  const firstPort = await unusedPort(), secondPort = await unusedPort(new Set([firstPort]));
  const results = await Promise.all([firstPort, secondPort].map(launcher => request(f.base, { revision, ports: { launcher } })));
  assert.deepEqual(results.map(x => x.code).sort(), [200, 409]);
  assert.equal(servers.length, 2);
  const accepted = results.find(x => x.code === 200);
  assert.equal(JSON.parse(f.read()).launcher.ports.launcher, accepted.ports.launcher);
  assert.equal((await request(accepted.serviceUrl)).serviceUrl, accepted.serviceUrl);
  const unused = accepted.ports.launcher === firstPort ? secondPort : firstPort;
  const external = http.createServer(); await listen(external, unused); await close(external);
});

test('模拟原子替换被文件系统拒绝时保留旧配置和监听，并释放候选端口', async t => {
  const f = await fixture(t);
  const before = f.read(), port = await unusedPort();
  const rename = fs.renameSync;
  const failure = t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === f.target) throw Object.assign(new Error('fixture rename denied'), { code: 'EACCES' });
    return rename(source, target);
  });
  let result;
  try { result = await request(f.base, { ports: { launcher: port } }); }
  finally { failure.mock.restore(); }
  assert.equal(result.code, 400);
  assert.match(result.error, /rename denied/);
  assert.equal(f.read(), before);
  assert.equal((await request(f.base)).serviceUrl, f.base);
  assert.equal(fs.readdirSync(f.root).some(name => name.endsWith('.tmp')), false);
  const external = http.createServer(); await listen(external, port); await close(external);
});

test('外部监听占用新端口时保留原配置和原服务，外部服务继续可用', async t => {
  const external = http.createServer((req, res) => res.end('external-owner'));
  const port = await listen(external);
  t.after(() => close(external));
  const f = await fixture(t);
  const before = f.read();
  const result = await request(f.base, { ports: { launcher: port } });
  assert.equal(result.code, 400);
  assert.match(result.error, /端口|EADDRINUSE/);
  assert.equal(f.read(), before);
  assert.equal((await request(f.base)).serviceUrl, f.base);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'external-owner');
  assert.deepEqual(fs.readdirSync(f.root), ['config.json']);
});

test('过期 revision 在尝试绑定之前拒绝，不创建候选监听', async t => {
  let created = 0;
  const f = await fixture(t, { deps: { createHttpServer: handler => { created++; return http.createServer(handler); } } });
  const before = f.read();
  const port = await unusedPort();
  const result = await request(f.base, { revision: 'stale-revision', ports: { launcher: port } });
  assert.equal(result.code, 409);
  assert.equal(created, 1);
  assert.equal(f.read(), before);
  const external = http.createServer();
  await listen(external, port);
  await close(external);
});

test('重新创建使用已保存的端口，显式端口 0 仍可请求临时端口；bootstrap 使用实际地址', async t => {
  const f = await fixture(t);
  const port = await unusedPort();
  const saved = await request(f.base, { botUin: '123456789', ports: { launcher: port } });
  assert.equal(saved.code, 200);
  await f.reload({ servicePort: Number(new URL(f.base).port) });
  assert.equal(f.current().address().port, port);
  const table = [];
  assert.equal(typeof f.hooks.get('webserver/index-inject'), 'function');
  f.hooks.get('webserver/index-inject')(table);
  assert.deepEqual(table, [{ kind: 'global', name: '__qqLauncherServiceUrl', value: `http://127.0.0.1:${port}` }]);
  await f.reload({ servicePort: 0 });
  const actual = `http://127.0.0.1:${f.current().address().port}`;
  assert.equal((await request(actual)).serviceUrl, actual);
  const temporaryTable = [];
  f.hooks.get('webserver/index-inject')(temporaryTable);
  assert.equal(temporaryTable[0].value, actual);
});

test('新监听已绑定但保存校验失败时关闭候选监听，保持原配置和服务', async t => {
  const f = await fixture(t);
  const before = f.read(), port = await unusedPort();
  const result = await request(f.base, { ports: { launcher: port }, ownerQQ: 'invalid-owner' });
  assert.equal(result.code, 400);
  assert.equal(f.read(), before);
  assert.equal((await request(f.base)).serviceUrl, f.base);
  const reuse = http.createServer();
  await listen(reuse, port);
  await close(reuse);
});

test('卸载在候选监听就绪时取消保存并清理全部自有监听及 bootstrap', async t => {
  let created = 0, disposeAtBind;
  const servers = [];
  const f = await fixture(t, { deps: { createHttpServer: handler => {
    const server = http.createServer(handler); servers.push(server);
    if (++created === 2) server.once('listening', () => { disposeAtBind = f.dispose(); });
    return server;
  } } });
  const before = f.read(), port = await unusedPort();
  const result = await request(f.base, { ports: { launcher: port } });
  assert.equal(result.code, 409);
  await disposeAtBind;
  assert.equal(f.read(), before);
  assert.equal(servers.length, 2);
  assert.equal(servers.every(server => !server.listening), true);
  assert.equal(f.hooks.has('webserver/index-inject'), false);
  const reuse = http.createServer(); await listen(reuse, port); await close(reuse);
});

test('初次绑定尚未完成就卸载时，卸载 Promise 等待监听结束并保持幂等', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-host-early-dispose-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'config.json'), '{}');
  const dispose = createLauncher({}, { servicePort: 0 }, { settingsRoot: root });
  const server = dispose.server;
  const draining = dispose();
  assert.equal(dispose(), draining);
  await draining;
  assert.equal(server.listening, false);
});
