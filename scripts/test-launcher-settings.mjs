import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLauncherSettings, saveLauncherSettings, validateBotUin } from './launcher-settings.mjs';

test('未明确填写时保持未配置，不根据令牌或历史账号猜测', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(readLauncherSettings(root, { snowluma: { accessToken: 'old-token' } }).botUin, '');
});
test('机器人 QQ 校验、原子保存和重新读取，保留其他设置', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ dsh: { baseUrl: 'keep-me' }, ownerQQ: 3456789 }));
  assert.equal(validateBotUin(' 60000 '), '60000');
  for (const invalid of ['', 'abc', '1234', '123.45', '00123456', '123456789012345678901']) assert.throws(() => validateBotUin(invalid));
  saveLauncherSettings(root, { botUin: '60000' });
  assert.equal(readLauncherSettings(root).botUin, '60000');
  saveLauncherSettings(root, { botUin: '234567890' });
  assert.equal(readLauncherSettings(root).botUin, '234567890');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config.json'))).dsh.baseUrl, 'keep-me');
  const revision = readLauncherSettings(root).revision;
  saveLauncherSettings(root, { botUin: '234567890', ownerQQ: '4567890', allow: { private: '60002,234567\n60002', groups: '345678' }, revision });
  assert.equal(readLauncherSettings(root).ownerQQ, 4567890);
  assert.deepEqual(readLauncherSettings(root).allow, { private: [60002, 234567], groups: [345678] });
  assert.throws(() => saveLauncherSettings(root, { botUin: '234567890', revision }), /其他页面/);
});
test('损坏设置拒绝启动，不静默改用其他账号', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'config.json'), '{bad');
  assert.throws(() => readLauncherSettings(root), /配置/);
});
