import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createLauncher } from '../plugins/qq-launcher/lib/index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveLauncherSettings } from './launcher-settings.mjs';

async function fixture(t, extra = {}) {
  const runners = [];
  let stops = 0;
  const settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-control-settings-'));
  t.after(() => fs.rmSync(settingsRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(settingsRoot, 'config.json'), '{}');
  if (!extra.unconfigured) saveLauncherSettings(settingsRoot, { botUin: '10608' });
  const dispose = createLauncher({}, { servicePort: 0 }, {
    settingsRoot, readConfig: () => ({}),
    nodeBinary: process.execPath,
    isQqRunning: async () => true,
    health: async () => ({ healthy: false, verdict: 'console_unreachable' }),
    tcpProbe: async () => false,
    spawnRunner: () => {
      const p = new EventEmitter(); p.pid = 900000 + runners.length; p.unref = () => {};
      runners.push(p); queueMicrotask(() => p.emit('spawn')); return p;
    },
    stop: async () => { stops++; },
    ...extra
  });
  t.after(dispose);
  await once(dispose.server, 'listening');
  const base = `http://127.0.0.1:${dispose.server.address().port}`;
  const post = (route, body) => fetch(base + route, { method: 'POST',
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  }).then(async r => ({ ...await r.json(), httpStatus: r.status }));
  const status = () => fetch(base + '/status').then(r => r.json());
  return { post, status, runners, stops: () => stops, getConfig: () => fetch(base + '/config').then(r => r.json()),
    configOrigin: origin => fetch(base + '/config', { headers: { origin } }) };
}

test('启动立即返回202，连点不会创建第二个守护', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/start')).httpStatus, 202);
  assert.equal((await f.post('/start')).already, true);
  assert.equal(f.runners.length, 1);
});

test('接受 DSH 桌面的本地协议来源，拒绝远程网页读写启动器', async t => {
  const f = await fixture(t);
  assert.equal((await f.configOrigin('dsh-app://app')).status, 200);
  assert.equal((await f.configOrigin('https://untrusted.example')).status, 403);
});

test('未设置机器人 QQ 时启动与重启均返回引导，不创建或关闭进程', async t => {
  const f = await fixture(t, { unconfigured: true });
  for (const route of ['/start', '/restart']) {
    const r = await f.post(route);
    assert.equal(r.httpStatus, 409);
    assert.equal(r.code, 'BOT_QQ_REQUIRED');
  }
  assert.equal(f.runners.length, 0);
  assert.equal(f.stops(), 0);
  assert.equal((await f.getConfig()).configured, false);
});

test('设置接口校验账号，保存后启动只传递指定 bot 账号', async t => {
  const f = await fixture(t, { unconfigured: true });
  assert.equal((await f.post('/config', { botUin: 'not-a-QQ' })).httpStatus, 400);
  assert.equal((await f.post('/config', { botUin: '234567890' })).httpStatus, 200);
  assert.equal((await f.getConfig()).botUin, '234567890');
  assert.equal((await f.post('/start')).httpStatus, 202);
});

test('等待 QQ 过程中关闭会取消启动，不会在迟到的 QQ 检测后拉起 bot', async t => {
  let finish;
  const pending = new Promise(r => { finish = r; });
  const f = await fixture(t, { isQqRunning: () => pending });
  assert.equal((await f.post('/start')).httpStatus, 202);
  assert.equal((await f.post('/stop')).httpStatus, 202);
  finish(true);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(f.runners.length, 0);
  assert.equal(f.stops(), 1);
  assert.equal((await f.status()).stopped, true);
});

test('重启先停止守护和桥接，再只启动一个新守护；旧 exit 不能覆盖新状态', async t => {
  const f = await fixture(t);
  await f.post('/start');
  const old = f.runners[0];
  await f.post('/restart');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(f.stops(), 1);
  assert.equal(f.runners.length, 2);
  old.emit('exit', 1, null);
  assert.equal((await f.status()).starting, true);
  assert.equal((await f.status()).lastError, '');
});

test('关闭成功后清掉黄灯，重复关闭不启动任何进程', async t => {
  const f = await fixture(t);
  await f.post('/stop');
  await new Promise(r => setTimeout(r, 20));
  const state = await f.status();
  assert.equal(state.starting, false);
  assert.equal(state.stopped, true);
  assert.equal(state.light, 'red');
  assert.equal(f.runners.length, 0);
});
