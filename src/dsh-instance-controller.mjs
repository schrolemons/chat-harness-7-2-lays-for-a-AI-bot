import {createSessionOwnershipRecorder} from './instance-session-ownership.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { claimInstanceRoot } from './instance-descriptor.mjs';
import { createInstanceScope } from './dsh-instance-scope.mjs';
import { createHostImport } from './dsh-host-import.mjs';
import { loadInstanceDefinitions } from './dsh-instance-definitions.mjs';
import { BUNDLED_MCP, mountBundledMcp } from '../dsh-mcp-entry.mjs';

const fail = code => Object.assign(Error(code), { code });

/** Returns promptly: ready deliberately runs OUTSIDE owner activation.
 * Runtime/launcher factories return owned handles and never adopt external services. */
export async function mountInstanceController(ctx, descriptor, deps = {}) {
  if (descriptor.entryId !== descriptor.settingsNamespace) throw Error('Instance entryId must equal settingsNamespace');
  const ownerFiber = ctx.fiber;
  const hostImport = createHostImport(ctx, deps.hostImport);
  const status = { state: 'initializing', error: null, cleanupError: null };
  let rootClaim, scope, scopeOwnership, runtime, launcher, closing = false, setup, disposal, cleanupTask, runtimeTask = Promise.resolve(), setupCleanupError;
  let cleanupMonitoring = false;
  const cleanupLogs = [];
  let cancel;
  const aborted = new Promise((_, reject) => { cancel = () => reject(fail('BOT_INSTANCE_DISPOSED')); });
  const check = () => { if (closing) throw fail('BOT_INSTANCE_DISPOSED'); };
  const close = () => { closing = true; scope?.deactivate(); cancel(); };
  const cleanup = () => cleanupTask ??= (async () => {
    scope?.deactivate();
    cleanupMonitoring = true;
    const errors = setupCleanupError ? [setupCleanupError] : [];
    const attempt = async action => { try { await action(); } catch (error) { errors.push(error); } };
    await attempt(() => runtimeTask);
    await attempt(() => runtime?.stop());
    await attempt(() => scope?.dispose());
    await attempt(() => launcher?.dispose());
    await attempt(() => removeExporter());
    errors.push(...cleanupLogs);
    if (!errors.length) await attempt(() => rootClaim?.());
    if (errors.length) {
      status.cleanupError = new AggregateError(errors, 'Instance controller disposal failed');
      status.state = 'failed';
      throw status.cleanupError;
    }
  })();
  const dispose = () => {
    if (disposal) return disposal;
    close();
    if (status.state !== 'failed') status.state = 'disposing';
    disposal = (async () => {
      // setup retains late resources; do not discard a raced-out mount result.
      await setup?.catch(() => {});
      await cleanup();
      if (!status.error) status.state = 'disposed';
    })();
    return disposal;
  };
  ctx.effect(() => dispose, 'bot-instance.controller');
  // Cordis deliberately logs and swallows child cleanup failures. Its public
  // structured exporter supplies a Fiber WeakRef: admit errors from this exact
  // scope ancestry during cleanup, never from unrelated plugins by name. The
  // pinned MCP host also reports uncertain startup rollback as a structured
  // error before ready rejects; retain that specific uncertainty across cleanup.
  const removeExporter = ctx.logger.exporter({ levels: { default: 0 }, export(message) {
    if (message.type !== 'error' || !scopeOwnership) return;
    const uncertainClose = message.args.some(value => typeof value === 'string' &&
      /transport closure could not be confirmed|failed generation could not confirm transport closure/.test(value));
    if (!cleanupMonitoring && !scopeOwnership.disposing && !uncertainClose) return;
    let fiber = message.fiber?.deref();
    // Preset generations are physically owned by the native registry. Their
    // public logical scope parent still proves this instance's exact ownership.
    if (fiber && scopeOwnership.ownsContext(fiber.ctx)) {
      cleanupLogs.push(...message.args.map(value => value instanceof Error ? value : Error(String(value))));
      return;
    }
    while (fiber) {
      if (fiber === scopeOwnership.ctx.fiber) {
        cleanupLogs.push(...message.args.map(value => value instanceof Error ? value : Error(String(value))));
        return;
      }
      const parent = fiber.parent?.fiber;
      if (parent === fiber) return;
      fiber = parent;
    }
  } });
  ctx.effect(function* () { yield removeExporter; yield dispose; }, 'bot-instance.cleanup-diagnostics');
  setup = (async () => {
    await Promise.race([Promise.resolve().then(() => ownerFiber.await()), aborted]); check();
    rootClaim = await claimInstanceRoot(ctx, descriptor); check();
    const definitions = await (deps.loadDefinitions || loadInstanceDefinitions)(descriptor.root, hostImport); check();
    scope = await createInstanceScope(ctx, { ...descriptor, definitions, rootClaim, hostImport,
      ownScope(rawDispose, ownership) {
        scopeOwnership = ownership;
        // Native effect collection removes rawDispose from the parallel disposer
        // list. Reverse yield order waits for controller teardown before the child.
        ctx.effect(function* () { yield rawDispose; yield dispose; }, 'bot-instance.ordered-scope');
      },
    }); check();
    let recorder;
    const recordCreatedSession = async record => {
      check();
      recorder ??= createSessionOwnershipRecorder({ctx,descriptor,scope,hostImport,
        hostBaseUrl:ctx.root.baseUrl || ctx.loader?.config?.baseUrl || ctx.loader?.ctx?.baseUrl,
        isActive:()=>!closing && status.state==='ready'});
      const append = await recorder; check(); return append(record);
    };
    runtime = await deps.createRuntime?.({ ctx: scope.ctx, descriptor, config: deps.config, presetMap:scope.presetMap, recordCreatedSession }); check();
    for (const serverName of Object.keys(BUNDLED_MCP)) {
      await (deps.mountMcp || mountBundledMcp)(scope.ctx, { root: descriptor.root, serverName, nodePath: deps.config?.nodePath, env: deps.env, hostImport }); check();
    }
    for (const id of Object.values(scope.presetMap)) {
      const definition = await ctx.agentPresets.resolve(id); check();
      if (!definition || definition.broken) throw Error(`PRESET_BROKEN: ${id}: ${definition?.broken || 'missing definition'}`);
    }
    if (deps.mountTitles) await deps.mountTitles(scope.ctx, { descriptor, presetMap: scope.presetMap });
    else {
      const titles = await hostImport(pathToFileURL(path.join(descriptor.root, 'plugins/qq-agent-presets/session-title-fallback.mjs')).href); check();
      await scope.ctx.plugin(ctx.loader.unwrapExports(titles), { presetIds: Object.values(scope.presetMap), presetIdMap: scope.presetMap });
    }
    check();
    launcher = await deps.mountLauncher?.({ ctx: scope.ctx, descriptor, config: deps.config, controller }); check();
    scope.activate(); status.state = 'ready';
  })();
  const readyWork = setup.catch(async error => {
    scope?.deactivate(); setupCleanupError = error.cleanupError;
    if (!closing) { status.error = error; status.state = 'failed'; closing = true; }
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Instance readiness and rollback failed'); }
    throw error;
  });
  const ready = Promise.race([readyWork, aborted]);
  ready.catch(() => {}); // Observe without changing the public rejection.
  const controller = {
    ready, status,
    start() {
      if (closing || status.state !== 'ready') return Promise.reject(fail('BOT_INSTANCE_NOT_READY'));
      if (!runtime?.start) return Promise.reject(fail('BOT_INSTANCE_RUNTIME_UNAVAILABLE'));
      const task = runtimeTask.then(() => { check(); return runtime.start(); });
      runtimeTask = task.catch(() => {});
      return task;
    },
    stop() { const task = runtimeTask.then(() => runtime?.stop()); runtimeTask = task.catch(() => {}); return task; },
    dispose,
  };
  return controller;
}
