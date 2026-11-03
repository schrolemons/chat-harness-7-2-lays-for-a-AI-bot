import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { acquireAccountLease, createProcessOwnership, probeProcess } from './instance-ownership.mjs';
import { readLauncherSettings } from '../scripts/launcher-settings.mjs';

export const MANAGED_SNOW_MANIFEST = '.qq-bridge-managed.json';
const fail = (code, message) => Object.assign(new Error(message), { code });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const running = child => child?.pid && child.exitCode === null && child.signalCode === null;
const within = (parent, target) => {
  const relative = path.relative(parent, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function regular(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw fail('MANAGED_DEPENDENCY_INVALID', 'Managed runtime files must be regular, unlinked files');
}

async function containedPath(parent, target) {
  if (!within(parent, target)) throw fail('MANAGED_DEPENDENCY_REQUIRED', 'SnowLuma must be explicitly installed under this instance managed-dependencies directory');
  let current = parent;
  for (const part of path.relative(parent, target).split(path.sep)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw fail('MANAGED_DEPENDENCY_INVALID', 'Managed dependency paths cannot contain links');
  }
  if (!within(await fs.realpath(parent), await fs.realpath(target))) throw fail('MANAGED_DEPENDENCY_INVALID', 'Managed dependency escapes its instance');
}

/** The installer, never this module, creates this marker. Every listed file is
 * hash-checked, including mandatory entry + runtime binaries. No vendor/home
 * discovery, copying, downloading or adoption occurs here. */
async function managedSnow(root, snowHome, instanceId) {
  const managed = path.join(root, 'managed-dependencies');
  if (typeof snowHome !== 'string' || !path.isAbsolute(snowHome) || !within(managed, snowHome)) {
    throw fail('MANAGED_DEPENDENCY_REQUIRED', '未安装本实例专属 SnowLuma 依赖；请先由受管安装器创建并验证副本');
  }
  try {
    await containedPath(root, snowHome);
    const marker = path.join(snowHome, MANAGED_SNOW_MANIFEST);
    await regular(marker);
    const markerStat = await fs.stat(marker);
    if (markerStat.size > 1024 * 1024) throw fail('MANAGED_DEPENDENCY_INVALID', 'Managed manifest is too large');
    const manifest = JSON.parse(await fs.readFile(marker, 'utf8'));
    if (manifest.version !== 1 || manifest.kind !== 'snowluma' || manifest.instanceId !== instanceId
      || manifest.entry !== 'index.mjs' || typeof manifest.runtime !== 'string' || !manifest.runtime
      || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)
      || !Object.hasOwn(manifest.files, manifest.entry) || !Object.hasOwn(manifest.files, manifest.runtime)) {
      throw fail('MANAGED_DEPENDENCY_INVALID', 'Managed SnowLuma manifest does not match this instance');
    }
    for (const [name, expected] of Object.entries(manifest.files)) {
      if (!name || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')
        || path.isAbsolute(name) || !/^[a-f0-9]{64}$/.test(expected)) throw fail('MANAGED_DEPENDENCY_INVALID', 'Invalid managed manifest file entry');
      const file = path.resolve(snowHome, name);
      await containedPath(snowHome, file);
      await regular(file);
      if (digest(await fs.readFile(file)) !== expected) throw fail('MANAGED_DEPENDENCY_INVALID', 'Managed SnowLuma file verification failed');
    }
    return { home: snowHome, entry: path.join(snowHome, manifest.entry), runtime: path.join(snowHome, manifest.runtime) };
  } catch (error) {
    if (error.code === 'ENOENT') throw fail('MANAGED_DEPENDENCY_REQUIRED', '未安装或未完整验证本实例专属 SnowLuma 依赖');
    if (error.code?.startsWith('MANAGED_')) throw error;
    throw fail('MANAGED_DEPENDENCY_INVALID', 'Managed SnowLuma manifest cannot be verified');
  }
}

function portInUse(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const finish = (error, used) => { socket.destroy(); error ? reject(error) : resolve(used); };
    socket.once('connect', () => finish(null, true));
    socket.once('error', error => error.code === 'ECONNREFUSED' ? finish(null, false)
      : finish(fail('INSTANCE_PORT_PROBE_FAILED', 'Cannot verify a local instance port')));
    socket.setTimeout(1000, () => finish(fail('INSTANCE_PORT_PROBE_FAILED', 'Local instance port probe timed out')));
  });
}

async function writeSnowAccount(snow, cfg, botUin, ports) {
  const directory = path.join(snow.home, 'config');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await containedPath(snow.home, directory);
  const file = path.join(directory, `onebot_${botUin}.json`);
  let previous = {};
  try { await regular(file); previous = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const token = String(cfg.snowluma?.accessToken || '');
  const listener = (name, port) => ({ name, port, host: '127.0.0.1', path: '/', accessToken: token,
    messageFormat: 'array', reportSelfMessage: false });
  const account = { ...previous, mode: 'snapshot', networks: {
    httpServers: [{ ...listener('http-default', ports.snowHttp), enableWebSocket: false }], httpClients: [],
    wsServers: [{ ...listener('ws-default', ports.snowWs), role: 'Universal' }], wsClients: [] } };
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(account, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

function exited(child, timeout) {
  if (!running(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); child.off('exit', onExit); error ? reject(error) : resolve(); };
    const onExit = () => finish();
    const timer = setTimeout(() => finish(fail('PROCESS_STOP_FAILED', 'Owned child has not exited; its account lease remains held')), timeout);
    child.once('exit', onExit);
  });
}

/**
 * Direct owned children only. start() means spawned+registered, not QQ login or
 * gateway readiness. Callers own DSH/launcher port checks; this module probes
 * bridge console + Snow HTTP/WS/WebUI. It never starts/stops QQ.exe, adopts an
 * external Snow home, invokes the legacy supervisor, or scans process trees.
 *
 * Installer contract: root/managed-dependencies/<name>/.qq-bridge-managed.json:
 * {version:1,kind:'snowluma',instanceId,entry:'index.mjs',runtime:'node.exe',
 *  files:{'index.mjs':sha256,'node.exe':sha256,...allInstalledRuntimeAssets}}.
 * A marker asserts installer ownership, not upstream publisher authenticity.
 */
export function createInstanceRuntime(options = {}) {
  const { root, instanceId, registryDir, snowHome, nodePath = process.execPath, presetMap = {} } = options;
  if (!path.isAbsolute(root || '') || !path.isAbsolute(registryDir || '') || !path.isAbsolute(nodePath || '')
    || typeof instanceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(instanceId)) throw fail('INVALID_INSTANCE', 'Explicit absolute instance paths and a valid instance ID are required');
  if (!presetMap || typeof presetMap !== 'object' || Array.isArray(presetMap)
    || Object.entries(presetMap).some(([key, value]) => !key || typeof value !== 'string' || !value.trim())) throw fail('INVALID_INSTANCE', 'Invalid instance preset map');
  const presetJson = JSON.stringify(presetMap);
  const probe = options.probeProcess || probeProcess;
  const probePort = options.probePort || portInUse;
  const spawnProcess = options.spawnProcess || spawn;
  const stopTimeout = options.stopTimeoutMs ?? 10000;
  if (!Number.isFinite(stopTimeout) || stopTimeout < 1) throw fail('INVALID_INSTANCE', 'Invalid owned process stop timeout');
  let state = 'stopped', disposed = false, uncertain = false, lastError = null;
  let lease = null, starting = null, stopping = null, cleaning = null, disposing = null, generation = 0;
  let configRevision = null, selected = null;
  let children = [];
  const status = () => ({ instanceId, state, disposed, uncertain, leaseHeld: !!lease, readiness: 'unverified',
    botUin: selected?.botUin || '', ports: selected ? { ...selected.ports } : null, configRevision, lastError,
    children: children.map(entry => ({ kind: entry.kind, pid: entry.child.pid || null,
      registered: !!entry.record, running: !!running(entry.child) })) });
  const load = async () => {
    let cfg;
    try { cfg = JSON.parse((await fs.readFile(path.join(root, 'config.json'), 'utf8')).replace(/^\uFEFF/, '')); }
    catch { throw fail('INSTANCE_CONFIG_INVALID', 'Instance config.json cannot be read'); }
    return { cfg, selected: readLauncherSettings(root, cfg), revision: digest(JSON.stringify(cfg)) };
  };
  const remember = error => { lastError = { code: error.code || 'INSTANCE_RUNTIME_FAILED', message: error.message }; };
  const guard = attempt => { if (disposed || attempt !== generation) throw fail('INSTANCE_START_CANCELLED', 'Instance startup was cancelled'); };

  async function terminate(entry) {
    const child = entry.child;
    if (!running(child)) return;
    if (entry.kind === 'snow' && child.connected) {
      child.send('shutdown', () => {});
      try { await exited(child, Math.min(1000, stopTimeout / 2)); return; }
      catch (error) { if (error.code !== 'PROCESS_STOP_FAILED') throw error; }
    }
    const exit = exited(child, stopTimeout);
    if (!child.kill()) { await exit; return; }
    await exit;
  }

  function cleanup() {
    if (cleaning) return cleaning;
    cleaning = (async () => {
      // Separate capabilities preserve this explicit dependency order.
      for (const entry of [...children].reverse()) await entry.ownership.stop();
      if (lease) { await lease.release(); lease = null; }
      children = [];
      uncertain = false;
    })().catch(error => { uncertain = true; remember(error); throw error; }).finally(() => { cleaning = null; });
    return cleaning;
  }

  async function launch(kind, file, args, spawnOptions) {
    const entry = { kind, child: null, record: null, ownership: null };
    entry.ownership = createProcessOwnership({ instanceId, nonce: lease.nonce, probeProcess: probe,
      terminateProcess: () => terminate(entry) });
    const child = spawnProcess(file, args, spawnOptions);
    entry.child = child;
    children.push(entry);
    // Keep asynchronous OS spawn failures handled while the start transaction waits.
    const spawned = new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.on('error', () => {});
    child.once('exit', () => {
      if (state === 'running') { state = 'failed'; remember(fail('INSTANCE_CHILD_EXITED', `${kind} process exited; stop this instance before retrying`)); }
    });
    await spawned;
    entry.record = await entry.ownership.registerSpawn(child, { commandPath: args.at(-1) });
    await lease.updateProcesses([entry.record]);
  }

  function start() {
    if (disposed) return Promise.reject(fail('INSTANCE_DISPOSED', 'Instance runtime is disposed'));
    if (stopping) return Promise.reject(fail('INSTANCE_STOPPING', 'Instance runtime is stopping'));
    if (starting) return starting;
    if (state === 'running') return load().then(value => {
      if (value.revision !== configRevision) throw fail('INSTANCE_CONFIG_CHANGED', 'Stop the instance before applying changed configuration');
      return status();
    });
    if (lease || children.length) return Promise.reject(fail('INSTANCE_STOP_REQUIRED', 'Owned runtime cleanup must succeed before another start'));
    state = 'starting'; lastError = null;
    const attempt = ++generation;
    starting = (async () => {
      try {
        const loaded = await load();
        selected = loaded.selected;
        if (!selected.botUin) throw fail('BOT_QQ_REQUIRED', '请先明确配置本实例机器人 QQ；不会自动启动 QQ 客户端');
        const snow = await managedSnow(root, snowHome, instanceId);
        const bridge = path.join(root, 'src', 'bridge.js');
        const bootstrap = path.join(root, 'scripts', 'snow-bootstrap.mjs');
        await regular(bridge); await regular(bootstrap); await fs.access(nodePath);
        for (const key of ['console', 'snowHttp', 'snowWs', 'snowWebui']) {
          if (await probePort(selected.ports[key])) throw fail('INSTANCE_PORT_IN_USE', `${key} port ${selected.ports[key]} is already in use; existing services were left untouched`);
          guard(attempt);
        }
        const owner = await probe(process.pid);
        if (!owner) throw fail('OWNERSHIP_UNCERTAIN', 'Cannot verify the runtime owner process');
        guard(attempt);
        lease = await acquireAccountLease({ registryDir, botUin: selected.botUin, instanceId, owner, probeProcess: probe });
        guard(attempt);
        await writeSnowAccount(snow, loaded.cfg, selected.botUin, selected.ports);
        guard(attempt);
        const env = { ...(options.env || process.env) };
        delete env.NODE_OPTIONS; delete env.NODE_PATH;
        await launch('snow', snow.runtime, ['--import', pathToFileURL(bootstrap).href, snow.entry], {
          cwd: snow.home, windowsHide: true, detached: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: { ...env, QQL_BOT_UIN: selected.botUin, SNOWLUMA_HOOK_AUTOLOAD: '0', SNOWLUMA_BRIDGE_UIN: selected.botUin,
            SNOWLUMA_BRIDGE_ENTRY: snow.entry, SNOWLUMA_UPDATE_ROOT: snow.home,
            SNOWLUMA_ONEBOT_HTTP_PORT: String(selected.ports.snowHttp), SNOWLUMA_ONEBOT_WS_PORT: String(selected.ports.snowWs),
            SNOWLUMA_WEBUI_PORT: String(selected.ports.snowWebui), SNOWLUMA_WEBUI_HOST: '127.0.0.1', SNOWLUMA_WEBUI_TLS: '0' } });
        guard(attempt);
        await launch('bridge', nodePath, [bridge], { cwd: root, windowsHide: true, detached: false, stdio: 'ignore',
          env: { ...env, QQ_BRIDGE_INSTANCE_ID: instanceId, QQ_BRIDGE_PRESET_MAP: presetJson } });
        guard(attempt);
        if (children.some(entry => !running(entry.child))) throw fail('INSTANCE_CHILD_EXITED', 'An owned child exited during startup');
        if ((await load()).revision !== loaded.revision) throw fail('INSTANCE_CONFIG_CHANGED', 'Configuration changed during startup; owned children are being stopped');
        configRevision = loaded.revision;
        state = 'running';
        return status();
      } catch (error) {
        remember(error);
        try { await cleanup(); }
        catch (cleanupError) { state = 'failed'; throw Object.assign(new AggregateError([error, cleanupError], 'Startup failed; ownership remains uncertain and the lease is retained'), { code: 'INSTANCE_ROLLBACK_FAILED' }); }
        state = disposed ? 'disposed' : stopping ? 'stopping' : 'stopped';
        throw error;
      }
    })().finally(() => { starting = null; });
    return starting;
  }

  function stop() {
    if (stopping) return stopping;
    ++generation;
    state = 'stopping';
    stopping = (async () => {
      await starting?.catch(() => {});
      await cleanup();
      state = disposed ? 'disposed' : 'stopped';
      return status();
    })().catch(error => { state = 'failed'; remember(error); throw error; }).finally(() => { stopping = null; });
    return stopping;
  }
  function dispose() {
    disposed = true;
    if (!disposing) disposing = stop().finally(() => { disposing = null; });
    return disposing;
  }
  return Object.freeze({ start, stop, dispose, status });
}
