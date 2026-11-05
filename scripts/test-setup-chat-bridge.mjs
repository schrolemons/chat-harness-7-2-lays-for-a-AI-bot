import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { profileRuntimeRoot, findInstalledProfiles, setupChatBridge } from './setup-chat-bridge.mjs';

test('setup selects only native Chat Bridge bundles registered in the requested DSH home', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-bridge-setup-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  for (const name of ['desktop', 'legacy', 'unregistered']) {
    const profile = path.join(home, 'profiles', name);
    const bundle = path.join(profile, 'node_modules', 'chat-bridge');
    await fs.mkdir(bundle, { recursive: true });
    await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'chat-bridge': '1.0.0' },
      dsh: { profile: { bundles: name === 'unregistered' ? [] : ['chat-bridge'] } },
    }));
    await fs.writeFile(path.join(bundle, 'package.json'), JSON.stringify({
      name: 'chat-bridge', qqBridge: { profileManaged: name !== 'legacy' },
    }));
  }
  const profiles = await findInstalledProfiles(home);
  assert.deepEqual(profiles.map(row => row.name), ['desktop']);
  assert.equal(profileRuntimeRoot(home, 'desktop'), path.join(home, 'bot-instances', 'runtime', 'desktop', 'chat-bridge'));
  assert.throws(() => profileRuntimeRoot(home, '..'), /INVALID_PROFILE/);
  assert.notEqual(profileRuntimeRoot(home, 'desktop'), profileRuntimeRoot(home, 'web'));
});


test('setup refuses a linked management directory without writing into its target', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-bridge-link-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const other = path.join(base, 'other');
  const profile = path.join(home, 'profiles', 'desktop');
  const bundle = path.join(profile, 'node_modules', 'chat-bridge');
  await fs.mkdir(bundle, { recursive: true });
  await fs.mkdir(other);
  await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { 'chat-bridge': '1.0.0' }, dsh: { profile: { bundles: ['chat-bridge'] } },
  }));
  await fs.writeFile(path.join(bundle, 'package.json'), JSON.stringify({
    name: 'chat-bridge', qqBridge: { profileManaged: true },
  }));
  await fs.symlink(other, path.join(home, 'bot-instances'), 'junction');
  await assert.rejects(setupChatBridge({ home, profile: 'desktop' }), /UNSAFE_INSTALL_PATH/);
  assert.deepEqual(await fs.readdir(other), []);
});
