import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { acquireAccountLease, createProcessOwnership, probeProcess } from './instance-ownership.mjs';
import { readLauncherSettings } from '../scripts/launcher-settings.mjs';
import { readInstanceSessionPolicy } from './instance-session-policy.mjs';
import { bindOwnedRuntimeIpc } from './instance-runtime-ipc.mjs';
import { createOwnedMonitorBrowser } from './owned-monitor-browser.mjs';
import { runtimeConfigFingerprint } from './instance-runtime-config.mjs';
import { selectInstanceDshTarget, instanceDshEnvironment } from './instance-dsh-target.mjs';
import {readManifest,appendInstallationEvidence} from './instance-manifest.mjs';

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
export async function verifyManagedSnow(root, snowHome, instanceId) {
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
    return { home: snowHome, entry: path.join(snowHome, manifest.entry), runtime: path.join(snowHome, manifest.runtime), configNamespace:manifest.createdDirectories?.length===1&&manifest.createdDirectories[0]==='config' };
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

export async function writeSnowAccount(snow, cfg, botUin, ports, descriptor) {
  if(!snow.configNamespace)throw fail('SNOW_CONFIG_NAMESPACE_UNPROVEN','Installer-created config namespace is required');
  const directory = path.join(snow.home, 'config');
  await containedPath(snow.home, directory);
  const file = path.join(directory, `onebot_${botUin}.json`);
  const manifest=await readManifest(descriptor.root);
  if(!manifest||manifest.instanceId!==descriptor.instanceId||manifest.dshHome!==descriptor.dshHome)throw fail('MANIFEST_CONFLICT','Snow author requires the selected installation receipt');
  const marker=path.join(snow.home,MANAGED_SNOW_MANIFEST);
  const dependency=manifest.paths.find(row=>row.path===snow.home);
  if(!dependency||dependency.kind!=='dependency'||dependency.source!=='created'||dependency.cleanup!=='owned'||!dependency.createdByTransaction||dependency.manifestPath!==marker||dependency.sha256!==digest(await fs.readFile(marker)))throw fail('SNOW_CONFIG_NAMESPACE_UNPROVEN','Snow namespace must match its installer dependency receipt');
  const receipt=manifest.paths.find(row=>row.path===file);
  if(receipt && (receipt.source!=='created'||receipt.cleanup!=='owned'||!receipt.mutable||receipt.producer!=='managed-snow-account'||!receipt.createdByTransaction))throw fail('SNOW_CONFIG_UNOWNED','Existing config has no author receipt');
  let previous = {};
  try { await regular(file); if(!receipt)throw fail('SNOW_CONFIG_UNOWNED','Existing config is not adopted');previous = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error;if(receipt)throw fail('SNOW_CONFIG_MISSING','Recorded config disappeared'); }
  const token = String(cfg.snowluma?.accessToken || '');
  const listener = (name, port) => ({ name, port, host: '127.0.0.1', path: '/', accessToken: token,
    messageFormat: 'array', reportSelfMessage: false });
  const account = { ...previous, mode: 'snapshot', networks: {
    httpServers: [{ ...listener('http-default', ports.snowHttp), enableWebSocket: false }], httpClients: [],
    wsServers: [{ ...listener('ws-default', ports.snowWs), role: 'Universal' }], wsClients: [] } };
  const bytes=JSON.stringify(account, null, 2) + '\n';
  if(!receipt){
    // Exclusive creation is the producer proof. Failed append preserves the file
    // as ambiguous and blocks launch; retry never adopts it by its filename.
    await fs.writeFile(file,bytes,{mode:0o600,flag:'wx'});
    await appendInstallationEvidence(descriptor.root,{profileEntries:[],links:[],paths:[{path:file,kind:'data',source:'created',cleanup:'owned',mutable:true,producer:'managed-snow-account',createdByTransaction:crypto.randomUUID(),sha256:digest(bytes)}]});
    return;
  }
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
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
  const { descriptor, snowHome, nodePath = process.execPath, presetMap } = options;
  if (!descriptor) throw fail('INVALID_INSTANCE', 'Explicit instance descriptor is required');
  const { root, instanceId, registryDir, settingsNamespace } = descriptor;
  for (const key of ['root','instanceId','registryDir','settingsNamespace']) {
    if (options[key] !== undefined && options[key] !== descriptor[key]) throw fail('INVALID_INSTANCE', 'Runtime identity differs from its descriptor');
  }
  const policy = readInstanceSessionPolicy({descriptor,env:presetMap ? {QQ_BRIDGE_PRESET_MAP:JSON.stringify(presetMap)} : {}});
  if (!path.isAbsolute(root || '') || !path.isAbsolute(registryDir || '') || !path.isAbsolute(nodePath || '')
    || typeof instanceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(instanceId)) throw fail('INVALID_INSTANCE', 'Explicit absolute instance paths and a valid instance ID are required');
  const presetJson = JSON.stringify(policy.presetMap);
  const probe = options.probeProcess || probeProcess;
  const probePort = options.probePort || portInUse;
  const spawnProcess = options.spawnProcess || spawn;
  const stopTimeout = options.stopTimeoutMs ?? 10000;
  if (!Number.isFinite(stopTimeout) || stopTimeout < 1) throw fail('INVALID_INSTANCE', 'Invalid owned process stop timeout');
  let state = 'stopped', disposed = false, uncertain = false, lastError = null;
  let lease = null, starting = null, stopping = null, cleaning = null, disposing = null, generation = 0;
  let configRevision = null, selected = null, invocation = null, childEnv = null;
  let admission = false, monitor = null;
  let children = [];
  const status = () => ({ instanceId, state, disposed, uncertain, leaseHeld: !!lease, readiness: 'unverified',
    botUin: selected?.botUin || '', ports: selected ? { ...selected.ports } : null, configRevision, lastError,
    children: [...children.map(entry => ({ kind: entry.kind, pid: entry.child.pid || null,
      registered: !!entry.record, running: !!running(entry.child) })),...(monitor?.status().children||[])] });
  const load = async () => {
    let cfg;
    try { cfg = JSON.parse((await fs.readFile(path.join(root, 'config.json'), 'utf8')).replace(/^\uFEFF/, '')); }
    catch { throw fail('INSTANCE_CONFIG_INVALID', 'Instance config.json cannot be read'); }
    const dshTarget=selectInstanceDshTarget(cfg,options.getDshOrigin);
    return { cfg, dshTarget, selected: readLauncherSettings(root, cfg,{managed:true}), revision: runtimeConfigFingerprint(cfg,{managed:true,dshTarget}) };
  };
  const remember = error => { lastError = { code: error.code || 'INSTANCE_RUNTIME_FAILED', message: error.message }; };
  const guard = attempt => { if (disposed || attempt !== generation) throw fail('INSTANCE_START_CANCELLED', 'Instance startup was cancelled'); };

  async function terminate(entry) {
    const child = entry.child;
    if (!running(child)) return;
    if (child.connected) {
      const exit = exited(child, stopTimeout);
      child.send(entry.kind === 'snow' ? 'shutdown' : {type:'qq-bridge:shutdown',version:1,instanceId,generation:invocation}, () => {});
      // Windows kill does not run JS shutdown handlers. A missed graceful ACK
      // must retain uncertainty rather than silently abandoning state/workers.
      await exit;
      return;
    }
    const exit = exited(child, stopTimeout);
    if (!child.kill()) { await exit; return; }
    await exit;
  }

  function cleanup() {
    if (cleaning) return cleaning;
    cleaning = (async () => {
      admission = false;
      for (const entry of children) entry.ipc?.closeAdmission();
      await Promise.all(children.map(entry => entry.ipc?.drain()));
      // Stop transport first, then monitor workers, then the gateway.
      const order = [...children.filter(e=>e.kind==='bridge'),...children.filter(e=>!['bridge','snow'].includes(e.kind)).reverse(),...children.filter(e=>e.kind==='snow')];
      for (const entry of order) {
        if(entry.kind==='snow'&&monitor)await monitor.stop();
        if(!entry.record&&running(entry.child))throw fail('OWNERSHIP_UNCERTAIN');
        await entry.ownership.stop(); await entry.ipc?.drain(); entry.ipc?.detach();
      }
      const dirty=children.find(e=>['campus-watch','login-window'].includes(e.kind)&&e.cleanupResult?.clean!==true);
      if(dirty)throw fail(dirty.cleanupResult?'WORKER_CLEANUP_FAILED':'WORKER_CLEANUP_UNKNOWN',dirty.cleanupResult?.error||`${dirty.kind} exited without confirmed cleanup`);
      if (lease) { await lease.release(); lease = null; }
      children = [];
      monitor = null;
      uncertain = false;
    })().catch(error => { uncertain = true; remember(error); throw error; }).finally(() => { cleaning = null; });
    return cleaning;
  }

  async function launch(kind, file, args, spawnOptions) {
    const entry = { kind, child: null, record: null, ownership: null, ipc: null };
    entry.ownership = createProcessOwnership({ instanceId, nonce: lease.nonce, probeProcess: probe,
      terminateProcess: () => terminate(entry) });
    const child = spawnProcess(file, args, spawnOptions);
    entry.child = child;
    children.push(entry);
    let registered,registrationFailed;
    const ready = new Promise((resolve,reject)=>{registered=resolve;registrationFailed=reject;});
    ready.catch(()=>{});
    if(kind!=='snow')entry.ipc=bindOwnedRuntimeIpc({child,instanceId,generation:invocation,
      isActive:()=>admission&&!entry.cleanupResult&&children.includes(entry)&&running(child),
      isOwned:()=>children.includes(entry)&&running(child),
      reportCleanup:['campus-watch','login-window'].includes(kind)?async result=>{
        await ready;
        if(entry.cleanupResult)throw fail('WORKER_CLEANUP_ALREADY_REPORTED');
        entry.cleanupResult=result;
        if(!result.clean){uncertain=true;admission=false;state='failed';remember(fail('WORKER_CLEANUP_FAILED',result.error));}
        return {accepted:true};
      }:undefined,
      recordCreatedSession:['bridge','campus-watch'].includes(kind)?async record=>{await ready;if(!admission)throw fail('RUNTIME_CLOSING');if(typeof options.recordCreatedSession!=='function')throw fail('OWNERSHIP_UNSUPPORTED');return options.recordCreatedSession(record,kind==='campus-watch'?{preset:'campus-summary'}:undefined);}:undefined,
      spawnWorker:async(workerKind,workerArgs)=>{await ready;return spawnWorker(entry,workerKind,workerArgs);},
      openMonitor:['campus-watch','login-window'].includes(kind)?async headless=>{
        await ready;if(!admission)throw fail('RUNTIME_CLOSING');
        try{return await monitor.open(headless);}catch(error){uncertain=true;admission=false;state='failed';remember(error);throw error;}
      }:undefined});
    // Keep asynchronous OS spawn failures handled while the start transaction waits.
    const spawned = new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.on('error', () => {});
    child.once('exit', () => {
      if(['campus-watch','login-window'].includes(kind)&&entry.cleanupResult?.clean!==true){uncertain=true;admission=false;if(state!=='stopping')state='failed';remember(fail(entry.cleanupResult?'WORKER_CLEANUP_FAILED':'WORKER_CLEANUP_UNKNOWN',entry.cleanupResult?.error||`${kind} exited without confirmed cleanup`));}
      if (state === 'running' && ['snow','bridge'].includes(kind)) { admission=false; state = 'failed'; remember(fail('INSTANCE_CHILD_EXITED', `${kind} process exited; stop this instance before retrying`)); }
    });
    try {
      await spawned;
      entry.record = await entry.ownership.registerSpawn(child, { commandPath: args.find(argument=>path.isAbsolute(argument)&&argument.endsWith(kind==='snow'?'index.mjs':kind==='bridge'?'bridge.js':`${kind}.mjs`)) });
      await lease.updateProcesses([entry.record]);registered();
      return entry;
    } catch(error){registrationFailed(error);throw error;}
  }

  async function spawnWorker(requester, kind, args) {
    if(!admission||disposed||!['starting','running'].includes(state))throw fail('RUNTIME_CLOSING');
    const allowed=requester.kind==='bridge'?['campus-watch']:requester.kind==='campus-watch'?['login-window']:requester.kind==='login-window'?['campus-watch']:[];
    if(!allowed.includes(kind)||!Array.isArray(args)||args.length>3||args.some(a=>typeof a!=='string'))throw fail('WORKER_UNSUPPORTED');
    if(kind==='login-window'&&args.length)throw fail('WORKER_ARGUMENT_INVALID');
    if(kind==='campus-watch'){
      const valid=args.length===0||args.length===1&&['--force','--lectures-only'].includes(args[0])||args.length===3&&args[0]==='--force'&&args[1]==='--retry-url'&&/^https?:\/\//.test(args[2]);
      if(!valid)throw fail('WORKER_ARGUMENT_INVALID');
    }
    const script=path.join(root,'scripts',`${kind}.mjs`);await regular(script);
    if(!admission)throw fail('RUNTIME_CLOSING');
    try{
      const entry=await launch(kind,nodePath,[script,...args],{cwd:root,windowsHide:true,detached:false,stdio:['ignore','ignore','ignore','ipc'],env:{...childEnv,QQ_BRIDGE_WORKER_KIND:kind}});
      return {accepted:true,pid:entry.child.pid};
    }catch(error){uncertain=true;state='failed';admission=false;remember(error);throw error;}
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
    invocation = crypto.randomUUID(); admission = true;
    const attempt = ++generation;
    starting = (async () => {
      try {
        const loaded = await load();
        selected = loaded.selected;
        if (!selected.botUin) throw fail('BOT_QQ_REQUIRED', '请先明确配置本实例机器人 QQ；不会自动启动 QQ 客户端');
        const snow = await verifyManagedSnow(root, snowHome, instanceId);
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
        await writeSnowAccount(snow, loaded.cfg, selected.botUin, selected.ports,descriptor);
        guard(attempt);
        const env = instanceDshEnvironment(descriptor,options.env || process.env);
        delete env.NODE_OPTIONS; delete env.NODE_PATH;
        delete env.SNOWLUMA_ACCEPT_EULA; delete env.SNOWLUMA_ACCEPT_PRIVACY;
        for(const key of Object.keys(env))if(key.startsWith('QQ_BRIDGE_')||key.startsWith('SNOWLUMA_'))delete env[key];
        childEnv={...env,QQL_BOT_UIN:selected.botUin,QQ_BRIDGE_INSTANCE_ID:instanceId,QQ_BRIDGE_ROOT:root,QQ_BRIDGE_SETTINGS_NAMESPACE:settingsNamespace,QQ_BRIDGE_RUNTIME_GENERATION:invocation,QQ_BRIDGE_PRESET_MAP:presetJson,QQ_BRIDGE_DSH_TARGET:JSON.stringify(loaded.dshTarget),
          QQ_BRIDGE_SNOW_CONFIG:JSON.stringify({home:snow.home,botUin:selected.botUin,httpUrl:`http://127.0.0.1:${selected.ports.snowHttp}`,wsUrl:`ws://127.0.0.1:${selected.ports.snowWs}`,accessToken:String(loaded.cfg.snowluma?.accessToken||''),consolePort:selected.ports.console})};
        monitor=createOwnedMonitorBrowser({root,instanceId,nonce:lease.nonce,env:childEnv,probeProcess:probe,
          executablePath:options.monitorBrowserPath || path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)','Microsoft','Edge','Application','msedge.exe'),
          updateProcess:record=>lease.updateProcesses([record]),timeoutMs:stopTimeout});
        await launch('snow', snow.runtime, ['--import', pathToFileURL(bootstrap).href, snow.entry], {
          cwd: snow.home, windowsHide: true, detached: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: { ...env, QQL_BOT_UIN: selected.botUin, SNOWLUMA_HOOK_AUTOLOAD: '0', SNOWLUMA_BRIDGE_UIN: selected.botUin,
            SNOWLUMA_BRIDGE_ENTRY: snow.entry, SNOWLUMA_UPDATE_ROOT: snow.home,
            SNOWLUMA_ONEBOT_HTTP_PORT: String(selected.ports.snowHttp), SNOWLUMA_ONEBOT_WS_PORT: String(selected.ports.snowWs),
            SNOWLUMA_WEBUI_PORT: String(selected.ports.snowWebui), SNOWLUMA_WEBUI_HOST: '127.0.0.1', SNOWLUMA_WEBUI_TLS: '0' } });
        guard(attempt);
        await launch('bridge', nodePath, [bridge], { cwd: root, windowsHide: true, detached: false, stdio: ['ignore','ignore','ignore','ipc'], env: childEnv });
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
    admission = false;
    monitor?.closeAdmission();
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
