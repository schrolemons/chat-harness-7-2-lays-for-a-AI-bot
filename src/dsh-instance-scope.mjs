import { randomUUID } from 'node:crypto';
import { createInstancePresetWrapper } from './dsh-instance-preset.mjs';
import { claimInstanceRoot, claimScopeRoot, instanceRootForClaim } from './instance-descriptor.mjs';
import { createHostImport } from './dsh-host-import.mjs';

const instancesKey = Symbol.for('qq-bridge.dsh-instance-scopes.v1');

/**
 * Own only an instance scope and its preset registrations. No profile/session/data writes.
 * Strict admission serializes against the shared installation-declaration inventory.
 * Caller context must inject loader, tools and agentPresets. Definitions are native parsed
 * preset definitions. Explicit presetIdMap entries can preserve existing private preset IDs.
 * Starts closed: await all MCP attachments through result.ctx, then call result.activate().
 * Disabling closes retained agents before disposing tools; a later activation of the same
 * instance ID and directory restores their stable scope parent and shared guard state.
 */
export async function createInstanceScope(ctx, { instanceId, root, label = instanceId, definitions = [], presetIdMap = {}, hostImport, rootClaim, dshHome, profile, bundleName, ownScope } = {}) {
  if (typeof instanceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(instanceId)) throw new Error('Invalid instanceId');
  if (!Array.isArray(definitions)) throw new Error('Preset definitions must be an array');
  const presetMap = Object.create(null);
  const usedIds = new Set();
  for (const definition of definitions) {
    if (typeof definition?.id !== 'string' || !definition.id.trim() || !Array.isArray(definition.plugins)) throw new Error('Invalid preset definition');
    if (Object.hasOwn(presetMap, definition.id)) throw new Error('Duplicate source preset ID');
    const id = Object.hasOwn(presetIdMap, definition.id) ? presetIdMap[definition.id] : `${instanceId}:${definition.id}`;
    if (typeof id !== 'string' || !id.trim() || usedIds.has(id)) throw new Error('Invalid or duplicate mapped preset ID');
    presetMap[definition.id] = id; usedIds.add(id);
  }
  const hostRoot = ctx.root;
  if (!Object.hasOwn(hostRoot, instancesKey)) Object.defineProperty(hostRoot, instancesKey, { value: new Map() });
  const instances = hostRoot[instancesKey];
  let state = instances.get(instanceId);
  const ownClaim = !rootClaim;
  const claim = rootClaim ?? await (dshHome === undefined ? claimScopeRoot(ctx, { instanceId, root })
    : claimInstanceRoot(ctx, { instanceId, root, dshHome, profile, bundleName }));
  const directory = instanceRootForClaim(ctx, { instanceId, root }, claim);
  if (state?.active || (state?.root !== undefined && state.root !== directory)) {
    if (ownClaim) await claim();
    if (state?.active) throw new Error(`Instance is already active: ${instanceId}`);
    throw new Error('Instance root changed; retained conversations require their original root');
  }
  if (!state) { state = { root: directory, key: {}, enabled: false, active: null }; instances.set(instanceId, state); }
  const token = {};
  state.active = token; state.enabled = false;
  // Retained generations outlive the declaring plugin's service access context.
  const builtins = ctx.loader?.builtins;
  let scope, wrapper, wrapperName, retained = 0, closing = false, disposal;
  const unregisters = [];
  const cleanBuiltin = () => {
    if (closing && retained === 0 && wrapperName && builtins[wrapperName] === wrapper) delete builtins[wrapperName];
  };
  const dispose = () => {
    if (disposal) return disposal;
    closing = true; state.enabled = false;
    disposal = (async () => {
      const results = await Promise.allSettled(unregisters.map(unregister => unregister()));
      try { await scope?.dispose(); } catch (error) { results.push({ status: 'rejected', reason: error }); }
      cleanBuiltin();
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      // Failed teardown must not admit a replacement while old services might remain.
      if (errors.length) throw new AggregateError(errors, 'Instance disposal failed');
      if (ownClaim) await claim();
      if (state.active === token) state.active = null;
    })();
    return disposal;
  };
  try {
    if (!builtins) throw new Error('The active DSH host loader has no builtins registry');
    const [scopeApi, loaderApi] = await Promise.all([
      createHostImport(ctx, hostImport)('@deepseek-ai/dsh-scope'),
      createHostImport(ctx, hostImport)('@deepseek-ai/cordis-plugin-loader'),
    ]);
    scope = scopeApi.createScope(ctx, state.key);
    // Hand off observation before eager preset registration can fail and roll
    // back. This grants no activation capability or ownership of the root claim.
    const ownership = Object.freeze({
      ctx: scope.ctx,
      ownsContext(context) { return scopeApi.scopeChainOf(scopeApi.scopeOf(context)).includes(state.key); },
      get disposing() { return closing; },
    });
    ownScope?.(scope.rawDispose, ownership);
    wrapperName = `qq-instance-${randomUUID()}`;
    wrapper = createInstancePresetWrapper({ ...loaderApi, ...scopeApi }, {
      state, retain: () => retained++, release: () => { retained--; cleanBuiltin(); },
    });
    builtins[wrapperName] = wrapper;
    for (const definition of definitions) {
      const plugins = structuredClone(definition.plugins);
      unregisters.push(await ctx.agentPresets.register({
        ...definition, id: presetMap[definition.id], name: `${label} · ${definition.name || definition.id}`,
        plugins: [{ id: 'instance', name: `cordis:${wrapperName}`, config: { plugins } }],
      }));
    }
    if (!ownScope) ctx.effect(() => dispose, 'bot-instance.scope');
    return {
      ctx: scope.ctx, presetMap: Object.freeze(presetMap),
      ownsContext: ownership.ownsContext,
      activate() {
        if (closing || state.active !== token) throw new Error('Instance is disposed');
        state.enabled = true;
      },
      deactivate() { if (state.active === token) state.enabled = false; },
      dispose,
    };
  } catch (error) {
    try { await dispose(); } catch (cleanupError) { throw Object.assign(new AggregateError([error, cleanupError], 'Instance setup and rollback failed'), { cleanupError }); }
    throw error;
  }
}
