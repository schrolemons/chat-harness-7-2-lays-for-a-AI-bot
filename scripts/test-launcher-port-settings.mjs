import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLauncherSettings, saveLauncherSettings } from './launcher-settings.mjs';

const defaults = { dsh: 3080, console: 3100, snowHttp: 3000, snowWs: 3001, launcher: 3199, snowWebui: 5099 };
function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-port-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = { snowluma: { botUin: '123456789', accessToken: 'fixture-secret' }, ownerQQ: 234567890,
    allow: { private: [345678901], groups: [456789012] }, consoleToken: 'fixture-console', ...overrides };
  const target = path.join(root, 'config.json');
  fs.writeFileSync(target, JSON.stringify(config, null, 2));
  return { root, target, config, read: () => JSON.parse(fs.readFileSync(target, 'utf8')) };
}

test('旧配置读取默认端口，并从已有连接和显式启动器端口读取实际值', t => {
  const { root } = fixture(t);
  assert.deepEqual(readLauncherSettings(root).ports, defaults);
  const result = readLauncherSettings(root, { dsh: { baseUrl: 'http://localhost:4080/api' }, consolePort: 4100,
    snowluma: { httpUrl: 'https://gateway.example.test/api', wsUrl: 'wss://gateway.example.test:4444/ws' },
    launcher: { ports: { launcher: 4199, snowWebui: 6099 } } });
  assert.deepEqual(result.ports, { dsh: 4080, console: 4100, snowHttp: 3000, snowWs: 3001, launcher: 4199, snowWebui: 6099 });
});

test('仅修改端口能往返保存并保留账号、权限、秘密和其他配置，生成原配置备份', t => {
  const f = fixture(t, { dsh: { baseUrl: 'http://localhost:3080', authToken: 'fixture-dsh' },
    launcher: { instanceName: 'example', ports: defaults } });
  const before = fs.readFileSync(f.target, 'utf8');
  const revision = readLauncherSettings(f.root).revision;
  const ports = { dsh: 4080, console: 4100, snowHttp: 4000, snowWs: 4001, launcher: 4199, snowWebui: 6099 };
  const result = saveLauncherSettings(f.root, { ports, revision });
  assert.deepEqual(result.ports, ports);
  assert.notEqual(result.revision, revision);
  assert.equal(result.botUin, '123456789');
  assert.equal(result.ownerQQ, 234567890);
  assert.deepEqual(result.allow, f.config.allow);
  const actual = f.read();
  assert.equal(actual.dsh.baseUrl, 'http://127.0.0.1:4080');
  assert.equal(actual.dsh.authToken, 'fixture-dsh');
  assert.equal(actual.consolePort, 4100);
  assert.equal(actual.snowluma.httpUrl, 'http://127.0.0.1:4000');
  assert.equal(actual.snowluma.wsUrl, 'ws://127.0.0.1:4001');
  assert.equal(actual.snowluma.accessToken, 'fixture-secret');
  assert.equal(actual.consoleToken, 'fixture-console');
  assert.equal(actual.launcher.instanceName, 'example');
  assert.deepEqual(actual.launcher.ports, ports);
  const backups = fs.readdirSync(f.root).filter(name => name.startsWith('config.json.bak-launcher-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(f.root, backups[0]), 'utf8'), before);
  assert.equal(fs.readdirSync(f.root).some(name => name.endsWith('.tmp')), false);
  assert.throws(() => saveLauncherSettings(f.root, { ports: { launcher: 4299 }, revision }), /其他页面/);
});

test('端口拒绝越界、小数、非数字、重复值；验证失败不写入或创建备份', t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.target, 'utf8');
  for (const value of [0, 65536, 1.1, NaN, Infinity, '', null, true, '4e3', '4000.1']) {
    assert.throws(() => saveLauncherSettings(f.root, { ports: { launcher: value } }), /端口/);
  }
  assert.throws(() => saveLauncherSettings(f.root, { ports: { launcher: 3100 } }), /端口.*重复|重复.*端口/);
  assert.equal(fs.readFileSync(f.target, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(f.root), ['config.json']);
  const saved = saveLauncherSettings(f.root, { ports: { launcher: '65535', snowWebui: 1 } });
  assert.equal(saved.ports.launcher, 65535);
  assert.equal(saved.ports.snowWebui, 1);
});

test('未改变远程端口的普通保存保留自定义 URL；明确改端口时才切换对应本机地址', t => {
  const dshUrl = 'https://dsh.example.test:8443/api/?x=1';
  const httpUrl = 'https://snow.example.test:9443/onebot';
  const wsUrl = 'wss://snow.example.test:9444/socket';
  const f = fixture(t, { dsh: { baseUrl: dshUrl, allowRemote: true },
    snowluma: { botUin: '123456789', httpUrl, wsUrl, accessToken: 'fixture-secret' } });
  const settings = readLauncherSettings(f.root);
  saveLauncherSettings(f.root, { ...settings, ownerQQ: '234567891' });
  assert.equal(f.read().dsh.baseUrl, dshUrl);
  assert.equal(f.read().snowluma.httpUrl, httpUrl);
  assert.equal(f.read().snowluma.wsUrl, wsUrl);
  saveLauncherSettings(f.root, { ports: { snowHttp: 4500 } });
  assert.equal(f.read().snowluma.httpUrl, 'http://127.0.0.1:4500');
  assert.equal(f.read().snowluma.wsUrl, wsUrl);
  assert.equal(f.read().dsh.baseUrl, dshUrl);
});

test('未配置机器人时也可预先保存端口，旧接口不带端口仍兼容', t => {
  const f = fixture(t, { snowluma: { accessToken: 'fixture-secret' } });
  const first = saveLauncherSettings(f.root, { ports: { launcher: 4299 } });
  assert.equal(first.botUin, '');
  const result = saveLauncherSettings(f.root, { botUin: '123456789' });
  assert.equal(result.ports.launcher, 4299);
  assert.equal(f.read().snowluma.accessToken, 'fixture-secret');
});

test('多个远程端点共享 HTTPS 端口时，本机端口偏好保持独立且普通保存不改远程地址', t => {
  const f = fixture(t, { dsh: { baseUrl: 'https://dsh.example.test/api' },
    snowluma: { botUin: '123456789', httpUrl: 'https://snow.example.test/api', wsUrl: 'wss://snow.example.test/ws' } });
  const selected = readLauncherSettings(f.root);
  assert.deepEqual(selected.ports, defaults);
  saveLauncherSettings(f.root, selected);
  assert.equal(f.read().dsh.baseUrl, 'https://dsh.example.test/api');
  assert.equal(f.read().snowluma.httpUrl, 'https://snow.example.test/api');
  assert.equal(f.read().snowluma.wsUrl, 'wss://snow.example.test/ws');
});

test('读取手工端口配置时规范化数字字符串并拒绝损坏或重复的本机端口', t => {
  const { root } = fixture(t);
  assert.equal(readLauncherSettings(root, { launcher: { ports: { launcher: '4299' } } }).ports.launcher, 4299);
  for (const invalid of [0, 65536, 'secret-value', null, true]) {
    assert.throws(() => readLauncherSettings(root, { launcher: { ports: { launcher: invalid } } }), /端口/);
  }
  assert.throws(() => readLauncherSettings(root, { launcher: { ports: { launcher: 3100 } } }), /端口.*重复|重复.*端口/);
});
