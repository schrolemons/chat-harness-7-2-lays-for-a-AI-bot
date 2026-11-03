import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { readLauncherSettings, saveLauncherSettings, validateBotUin, validateLauncherPorts, normalizeQqList } from '../scripts/launcher-settings.mjs';

const failure = (code, status = 409) => Object.assign(Error(code), { code, status });
// Distinct installed packages have distinct module caches; the host owns the
// shared producer, just as it owns the cross-bundle instance root claims.
const registryKey = Symbol.for('qq-bridge.launcher-discovery.v1');
function registerDiscovery(ctx, record) {
  const host=ctx.root||ctx; let registry=Object.hasOwn(host,registryKey)?host[registryKey]:undefined;
  if(!registry) {
    registry={entries:new Map()};
    registry.remove=host.on?.('webserver/index-inject',table=>{
      const value=Object.fromEntries([...registry.entries.values()].map(get=>get()).filter(Boolean).map(({instanceId,...record})=>[instanceId,record]));
      if(Object.keys(value).length)table.push({kind:'global',name:'__qqBotInstances',value});
    });
    Object.defineProperty(host,registryKey,{value:registry,configurable:true});
  }
  const token=Symbol(); registry.entries.set(token,record);
  return ()=>{registry.entries.delete(token);if(!registry.entries.size&&host[registryKey]===registry){registry.remove?.();delete host[registryKey];}};
}
const localOrigin = value => {
  if (!value) return true;
  try { const url = new URL(value); return (['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) || (url.protocol === 'dsh-app:' && url.hostname === 'app'); }
  catch { return false; }
};

/** HTTP capability for one controller generation. Health never starts/adopts a service.
 * The root controller owns runtime disposal; this handle owns only admission/listeners. */
export function createInstanceLauncher(ctx, { descriptor, runtime }, deps = {}) {
  if (!descriptor?.instanceId || !path.isAbsolute(descriptor.root || '') || !runtime?.start || !runtime?.stop || typeof runtime.status !== 'function') throw failure('INSTANCE_LAUNCHER_REQUIRED');
  let generation = crypto.randomUUID();
  const servers = new Set(), bindings = new Map(), closings = new WeakMap();
  let active, closing = false, disposal, queue = Promise.resolve(), stopError, needsRestart = false;
  const address = () => { const value = active?.address(); return value && typeof value !== 'string' ? `http://127.0.0.1:${value.port}` : undefined; };
  const identity = () => ({ instanceId: descriptor.instanceId, serviceUrl: address(), generation });
  const view = () => ({ ok: true, ...identity(), readiness: 'unverified', runtime: runtime.status(), needsRestart });
  const send = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
    res.end(JSON.stringify({ ...body, ...identity() }));
  };
  const serialize = action => { const task = queue.then(action); queue = task.catch(() => {}); return task; };
  const admit = () => { if (closing) throw failure('BOT_INSTANCE_DISPOSED'); };
  const validateIdentity = value => { if(value.instanceId!==descriptor.instanceId||value.generation!==generation)throw failure('INSTANCE_IDENTITY_MISMATCH'); };
  async function readBody(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw failure('JSON_REQUIRED', 400);
    let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16384) throw failure('BODY_TOO_LARGE', 400); }
    let value; try { value=JSON.parse(body); } catch { throw failure('INVALID_JSON',400); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('JSON_OBJECT_REQUIRED', 400);
    validateIdentity(value);
    return value;
  }
  function createServer() {
    const server = (deps.createHttpServer || http.createServer)((req,res) => {
      void handle(req,res).catch(error => send(res, error.status || 500, { ...view(), ok: false, code: error.code, error: error.message }));
    });
    servers.add(server); server.once('close', () => servers.delete(server));
    // Binding failures reject ready/save; keep the emitter observed after binding too.
    server.on('error', () => {}); return server;
  }
  function bind(server, port) {
    const promise = new Promise((resolve,reject) => {
      const fail = error => { server.off('listening', done); reject(error); };
      const done = () => { server.off('error', fail); resolve(); };
      server.once('error',fail); server.once('listening',done);
      try { server.listen(port,'127.0.0.1'); } catch(error) { fail(error); }
    });
    bindings.set(server,promise); promise.finally(() => bindings.delete(server)).catch(() => {}); return promise;
  }
  function closeServer(server) {
    if (closings.has(server)) return closings.get(server);
    const promise = (async () => {
      await bindings.get(server)?.catch(() => {});
      await new Promise((resolve,reject) => {
        server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
        server.closeIdleConnections?.();
      });
      servers.delete(server);
    })();
    closings.set(server,promise); return promise;
  }
  async function save(body,res) {
    admit();
    if (['starting','stopping'].includes(runtime.status().state)) throw failure('INSTANCE_RUNTIME_BUSY');
    const current = readLauncherSettings(descriptor.root);
    if (body.revision && body.revision !== current.revision) throw failure('CONFIG_REVISION_CONFLICT');
    // Validate the whole patch before opening a candidate listener or writing bytes.
    if (body.botUin !== undefined) validateBotUin(body.botUin);
    if (body.ownerQQ !== undefined && String(body.ownerQQ ?? '').trim()) normalizeQqList([body.ownerQQ]);
    for (const key of ['private','groups']) if(body.allow?.[key] !== undefined) normalizeQqList(body.allow[key]);
    const ports = body.ports === undefined ? current.ports : validateLauncherPorts(body.ports,current.ports);
    let candidate;
    try {
      if (ports.launcher !== active.address()?.port) {
        candidate=createServer(); await bind(candidate,ports.launcher);
      }
      admit();
      const saved=saveLauncherSettings(descriptor.root,body);
      if (candidate) {
        const previous=active; active=candidate; candidate=null; generation=crypto.randomUUID();
        // Accepted responses drain on their original socket before retiring it.
        const retire=()=>{ void closeServer(previous).catch(error=>ctx.logger?.error(error)); };
        res.once('finish',retire); res.once('close',retire); if(res.destroyed)retire();
      }
      const changed=JSON.stringify({...saved,revision:undefined,ports:{...saved.ports,launcher:undefined}})!==JSON.stringify({...current,revision:undefined,ports:{...current.ports,launcher:undefined}});
      if (changed && !['stopped','disposed'].includes(runtime.status().state)) needsRestart=true;
      return { ...saved, ...view(), configured:!!saved.botUin, live:false,
        message:needsRestart?'已保存；运行中的服务需重启后应用':'已保存；服务下次启动时应用' };
    } catch(error) { error.status ??= 400; throw error; }
    finally { if(candidate)await closeServer(candidate); }
  }
  async function handle(req,res) {
    if(!localOrigin(req.headers.origin)) { send(res,403,{ok:false,error:'仅允许本机 DSH 页面访问启动器设置'}); return; }
    const route=String(req.url||'').split('?')[0];
    if(req.method==='OPTIONS') { send(res,204,{}); return; }
    if(req.method==='GET' && ['/', '/status','/config'].includes(route)) {
      const settings=route==='/config'?readLauncherSettings(descriptor.root):undefined;
      send(res,200,{...(settings?{...settings,configured:!!settings.botUin,live:false}:{}),...view()}); return;
    }
    if(req.method!=='POST'||!['/start','/stop','/restart','/config'].includes(route)) { send(res,404,{ok:false,error:'not found'}); return; }
    const body=await readBody(req); admit();
    const result=await serialize(async()=>{
      admit(); validateIdentity(body);
      if(route==='/config') { try{return await save(body,res);}catch(error){error.status??=400;throw error;} }
      if(route==='/stop'||route==='/restart') {
        try { await runtime.stop(); stopError=null; } catch(error) { stopError=error; throw error; }
      }
      if(route==='/start'||route==='/restart') {
        if(stopError||runtime.status().uncertain)throw failure('BOT_INSTANCE_STOP_UNCERTAIN');
        await runtime.start(); needsRestart=false;
      }
      return view();
    });
    send(res,200,result);
  }
  active=createServer();
  const ready=bind(active,readLauncherSettings(descriptor.root).ports.launcher);
  ready.catch(()=>{});
  const remove=registerDiscovery(ctx,()=>!closing&&address()?{...identity(),label:descriptor.label,clientModuleId:descriptor.bundleName}:null);
  const closeAdmission=()=>{closing=true;};
  function dispose() {
    closeAdmission();
    return disposal??=(async()=>{ if(typeof remove==='function')remove(); await queue; await Promise.all([...servers].map(closeServer)); })();
  }
  return {ready,dispose,address,closeAdmission};
}
