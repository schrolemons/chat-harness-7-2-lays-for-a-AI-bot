import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { acquireSnowArtifact, preparePublicInstall, checkPorts } from './install.mjs';
import { assertPlainDirectory } from './plan-instance-install.mjs';
import { readInstanceDescriptor } from '../src/instance-descriptor.mjs';
import { verifyManagedSnow } from '../src/instance-runtime.mjs';
import { PROFILE_BUNDLE, PROFILE_ENTRY, PROFILE_RUNTIME_RECEIPT, profileRuntimeRoot } from '../src/profile-chat-bridge.mjs';

export { profileRuntimeRoot };
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const defaultPorts = { console: 3200, snowHttp: 3201, snowWs: 3202, launcher: 3299, snowWebui: 5299 };

export async function findInstalledProfiles(home) {
  let names;
  try { names = await fs.readdir(path.join(home, 'profiles'), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const matches = [];
  for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9_-]*$/i.test(entry.name)) continue;
    const dir = path.join(home, 'profiles', entry.name);
    try {
      const manifest = await readJson(path.join(dir, 'package.json'));
      if (!manifest.dsh?.profile?.bundles?.includes(PROFILE_BUNDLE) || !manifest.dependencies?.[PROFILE_BUNDLE]) continue;
      const bundleRoot = await fs.realpath(path.join(dir, 'node_modules', PROFILE_BUNDLE));
      const bundle = await readJson(path.join(bundleRoot, 'package.json'));
      if (bundle.name === PROFILE_BUNDLE && bundle.qqBridge?.profileManaged === true)
        matches.push({ name: entry.name, dir, bundleRoot });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return matches;
}

async function availablePorts(home, instanceId, resumeRoot) {
  try {
    await checkPorts(defaultPorts, home, instanceId, resumeRoot);
    return defaultPorts;
  } catch (error) {
    if (error.code !== 'INSTANCE_PORT_CONFLICT') throw error;
  }
  const servers = Object.keys(defaultPorts).map(() => net.createServer());
  try {
    await Promise.all(servers.map(server => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    })));
    return Object.fromEntries(Object.keys(defaultPorts).map((key, index) => [key, servers[index].address().port]));
  } finally {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
}

export async function setupChatBridge({ home, profile, artifact } = {}) {
  home = await fs.realpath(home);
  const selected = (await findInstalledProfiles(home)).find(row => row.name === profile);
  if (!selected) throw Error('Chat Bridge is not installed in the selected DSH profile');
  const target = profileRuntimeRoot(home, profile);
  try {
    const ready = await readJson(path.join(target, PROFILE_RUNTIME_RECEIPT));
    const descriptor = await readInstanceDescriptor(target);
    if (ready.version !== 1 || descriptor.profile !== profile || !same(descriptor.dshHome, home) ||
        descriptor.bundleName !== PROFILE_BUNDLE || descriptor.entryId !== PROFILE_ENTRY)
      throw Error('Existing Chat Bridge runtime identity does not match the selected profile');
    await verifyManagedSnow(target, ready.snowHome, descriptor.instanceId);
    return { target, alreadyPrepared: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  for (let current = parent; current !== home; current = path.dirname(current)) await assertPlainDirectory(current);
  // Validate downloaded bytes before creating the durable runtime and its ownership record.
  const acquired = await acquireSnowArtifact({ root: parent, artifact });
  const instanceId = profile.toLowerCase() + '-chat-bridge';
  let resumed;
  try { await fs.lstat(target); resumed = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lock = path.join(parent, '.chat-bridge-setup.lock');
  await fs.mkdir(lock);
  try {
    const ports = resumed ? await availablePorts(home, instanceId, target) : await availablePorts(home, instanceId);
    const result = await preparePublicInstall({
      sourceRoot: selected.bundleRoot, target, dshHome: home, profile, instanceId, ports,
      label: 'Chat Bridge', bundleName: PROFILE_BUNDLE, entryId: PROFILE_ENTRY,
      artifact: acquired.artifact, nativeProfile: true,
    });
    return { target: result.descriptor.root, alreadyPrepared: false };
  } finally { await fs.rmdir(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = key => { const index = args.indexOf(key); return index === -1 ? undefined : args[index + 1]; };
  try {
    const home = path.resolve(options('--home') || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
    const installed = await findInstalledProfiles(home);
    if (!installed.length) throw Error('Install Chat Bridge in DSH Plugin Manager, then run this setup again.');
    let profile = options('--profile') || (installed.length === 1 ? installed[0].name : undefined);
    if (!profile) {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try {
        console.log(installed.map((row, index) => (index + 1) + '. ' + row.name).join('\n'));
        const selected = Number(await terminal.question('Choose the DSH profile number: '));
        profile = installed[selected - 1]?.name;
      } finally { terminal.close(); }
      if (!profile) throw Error('Invalid profile selection');
    }
    const result = await setupChatBridge({ home, profile, artifact: options('--snow') });
    console.log('Chat Bridge is ready in DSH profile ' + profile + '.');
    console.log('Runtime data: ' + result.target);
    console.log('Open Chat Bridge in DSH to configure and log in to QQ.');
  } catch (error) {
    console.error(error.message);
    if (error.detail) console.error(error.detail);
    process.exitCode = 1;
  }
}
