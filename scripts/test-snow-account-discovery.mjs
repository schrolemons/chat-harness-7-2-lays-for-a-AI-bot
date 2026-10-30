import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverSnowLumaConnection } from '../src/snowluma-conn.js';

test('指定 bot 不匹配时拒绝成功响应，也不能试其他账号的令牌', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-scope-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'config'));
  for (const uin of ['20011', '654321']) fs.writeFileSync(path.join(home, 'config', `onebot_${uin}.json`),
    JSON.stringify({ networks: { httpServers: [{ accessToken: uin, port: 3000 }] } }));
  const original = globalThis.fetch, used = [];
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, opts) => {
    used.push(opts.headers.authorization);
    return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { user_id: 654321 } }) };
  };
  const result = await discoverSnowLumaConnection({ cfg: { snowluma: { botUin: '20011' } }, homeDirs: [home] });
  assert.equal(result.ok, false);
  assert.deepEqual(used, ['Bearer 20011']);
});

test('配置中的机器人 QQ 优先于继承的旧环境变量', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-config-priority-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'config'));
  for (const uin of ['20011', '654321']) fs.writeFileSync(path.join(home, 'config', `onebot_${uin}.json`),
    JSON.stringify({ networks: { httpServers: [{ accessToken: uin, port: 3000 }] } }));
  const originalFetch = globalThis.fetch, originalUin = process.env.QQL_BOT_UIN, used = [];
  t.after(() => { globalThis.fetch = originalFetch; if (originalUin === undefined) delete process.env.QQL_BOT_UIN; else process.env.QQL_BOT_UIN = originalUin; });
  process.env.QQL_BOT_UIN = '654321';
  globalThis.fetch = async (_url, opts) => {
    used.push(opts.headers.authorization);
    return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { user_id: 20011 } }) };
  };
  const result = await discoverSnowLumaConnection({ cfg: { snowluma: { botUin: '20011' } }, homeDirs: [home] });
  assert.equal(result.ok, true);
  assert.deepEqual(used, ['Bearer 20011']);
});
