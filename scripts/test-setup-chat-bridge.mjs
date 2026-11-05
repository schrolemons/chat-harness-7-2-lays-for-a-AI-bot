import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { profileRuntimeRoot, findInstalledProfiles } from './setup-chat-bridge.mjs';

test('setup selects only native Chat Bridge bundles registered in the requested DSH home', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-bridge-setup-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  for (const name of ['desktop', 'legacy', 'unregistered']) {
    const profile = path.join(home, 'profiles', name);
    const bundle = path.join(profile, 'node_modules', 'qq-bridge-public');
    await fs.mkdir(bundle, { recursive: true });
    await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'qq-bridge-public': '1.0.0' },
      dsh: { profile: { bundles: name === 'unregistered' ? [] : ['qq-bridge-public'] } },
    }));
    await fs.writeFile(path.join(bundle, 'package.json'), JSON.stringify({
      name: 'qq-bridge-public', qqBridge: { profileManaged: name !== 'legacy' },
    }));
  }
  const profiles = await findInstalledProfiles(home);
  assert.deepEqual(profiles.map(row => row.name), ['desktop']);
  assert.equal(profileRuntimeRoot(home, 'desktop'), path.join(home, 'bot-instances', 'runtime', 'desktop', 'qq-bridge-public'));
  assert.throws(() => profileRuntimeRoot(home, '..'), /INVALID_PROFILE/);
  assert.notEqual(profileRuntimeRoot(home, 'desktop'), profileRuntimeRoot(home, 'web'));
});
