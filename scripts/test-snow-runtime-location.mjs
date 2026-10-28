import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSnowHome } from './snow-runtime-location.mjs';

test('旧 SnowLuma 版本路径失效时发现同工作区新版；多个发行版时不随便选择', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-location-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const make = name => { const home = path.join(root, name); fs.mkdirSync(home); for (const file of ['node.exe', 'index.mjs']) fs.writeFileSync(path.join(home, file), ''); return home; };
  const newer = make('SnowLuma-new-release');
  const cfg = { snowluma: { launcherPath: path.join(root, 'missing-old-version', 'launcher.bat') } };
  assert.equal(resolveSnowHome(cfg, { roots: [root], env: {} }), newer);
  make('SnowLuma-another-release');
  assert.throws(() => resolveSnowHome(cfg, { roots: [root], env: {} }), /多个/);
  assert.equal(resolveSnowHome({ snowluma: { homeDir: newer } }, { roots: [root], env: {} }), newer);
});
