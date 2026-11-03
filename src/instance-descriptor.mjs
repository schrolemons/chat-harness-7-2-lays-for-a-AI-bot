import fs from 'node:fs/promises';
import path from 'node:path';
import { readManifest, INSTANCE_MANIFEST_FILE } from './instance-manifest.mjs';
import { findRootDeclaration, withInstallationRootInventory } from './instance-root-inventory.mjs';

export const INSTANCE_DESCRIPTOR_FILE = '.qq-bridge-instance.json';
const claimsKey = Symbol.for('qq-bridge.instance-root-claims.v1');
const capabilities = new WeakMap();
const fail = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });
const text = value => typeof value === 'string' && value.trim().length > 0;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const absolute = value => text(value) && path.isAbsolute(value);
const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const overlaps = (a, b) => {
  const contains = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
  return contains(a, b) || contains(b, a);
};

async function physicalRoot(root, allowMissing) {
  try {
    const physical = await fs.realpath(root);
    if (!(await fs.stat(physical)).isDirectory()) throw fail('ROOT_INVALID', 'Root must be a directory');
    return physical;
  } catch (error) {
    if (!allowMissing || error.code !== 'ENOENT') throw error;
    const parent = path.dirname(root);
    if (parent === root) throw error;
    return path.join(await physicalRoot(parent, true), path.basename(root));
  }
}

/** Explicit file only. No edition, profile, PID or same-name installation discovery. */
export async function readInstanceDescriptor(root) {
  if (!absolute(root)) throw fail('DESCRIPTOR_INVALID', 'Root must be absolute');
  const physical = await physicalRoot(root, false);
  const file = path.join(physical, INSTANCE_DESCRIPTOR_FILE);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw fail('DESCRIPTOR_INVALID', 'Descriptor must be an ordinary JSON file');
  let value;
  try { value = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw fail('DESCRIPTOR_INVALID', 'Malformed JSON'); }
  if (!value || value.version !== 1 || !validId(value.instanceId) || !text(value.label)
    || ['bundleName', 'entryId', 'settingsNamespace', 'profile'].some(field => !text(value[field]))
    || !absolute(value.root) || !absolute(value.dshHome)
    || canonical(await physicalRoot(value.root, false)) !== canonical(physical)
    || !value.presetIdMap || typeof value.presetIdMap !== 'object' || Array.isArray(value.presetIdMap)
    || Object.entries(value.presetIdMap).some(([source, id]) => !text(source) || !text(id))
    || new Set(Object.values(value.presetIdMap)).size !== Object.values(value.presetIdMap).length) {
    throw fail('DESCRIPTOR_INVALID', 'Invalid explicit instance identity');
  }
  const registryDir = path.join(value.dshHome, 'bot-instances', 'account-leases');
  if (value.registryDir !== undefined && (!absolute(value.registryDir) || canonical(value.registryDir) !== canonical(registryDir))) throw fail('DESCRIPTOR_INVALID', 'Account leases must be shared under the selected DSH home');
  const workspaces = Object.fromEntries(['chat', 'learning', 'task', 'summary'].map(kind => [kind,
    value.workspaces?.[kind] ?? path.join(physical, 'state', 'workspaces', value.instanceId, kind)]));
  if (Object.values(workspaces).some(directory => !absolute(directory))) throw fail('DESCRIPTOR_INVALID', 'Workspace directories must be absolute');
  return { version: 1, ...Object.fromEntries(['instanceId', 'label', 'bundleName', 'entryId', 'settingsNamespace', 'profile', 'dshHome'].map(field => [field, value[field]])),
    root: physical, registryDir, presetIdMap: { ...value.presetIdMap }, workspaces };
}

async function claim(ctx, descriptor, allowMissing) {
  if (!ctx?.root || !validId(descriptor?.instanceId) || !absolute(descriptor?.root)) throw fail('ROOT_INVALID', 'Host, instance ID and absolute root are required');
  const host = ctx.root;
  if (!Object.hasOwn(host, claimsKey)) Object.defineProperty(host, claimsKey, { value: { entries: new Map(), queue: Promise.resolve() } });
  const registry = host[claimsKey];
  const { instanceId, root } = descriptor;
  const lexical = canonical(root);
  if (registry.entries.has(instanceId)) throw fail('INSTANCE_CONFLICT', `Instance is already active or resolving: ${instanceId}`);
  for (const other of registry.entries.values()) if (overlaps(lexical, other.lexical)) throw fail('ROOT_CONFLICT', 'Instance roots must be physically separate and non-nested');
  // Reserve synchronously, before realpath or manifest I/O; rollback deletes only this token.
  const token = { lexical, directory: null };
  registry.entries.set(instanceId, token);
  const resolve = registry.queue.then(async () => {
    if (allowMissing) {
      try {
        await fs.lstat(root);
        throw fail('ROOT_INVALID', 'Existing installation scopes require an explicit descriptor and strict root admission');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const physical = await physicalRoot(root, allowMissing);
    const directory = canonical(physical);
    if (!allowMissing && [lexical, directory].some(value => value.split(path.sep).includes('.worktrees'))) throw fail('ROOT_CONFLICT', 'A development worktree cannot be a runtime installation');
    for (const other of registry.entries.values()) if (other !== token && overlaps(directory, other.directory ?? other.lexical)) throw fail('ROOT_CONFLICT', 'Instance roots resolve to overlapping physical directories');
    const verifyManifest = async (selected, identity = descriptor) => {
      const manifest = await readManifest(physical).catch(error => {
        if (allowMissing && error.code === 'ENOENT') return null;
        throw error;
      });
      if (manifest && (manifest.instanceId !== instanceId || ['profile', 'dshHome', 'bundleName'].some(field => identity[field] !== undefined
        && (field === 'dshHome' ? canonical(identity[field]) !== canonical(manifest[field]) : identity[field] !== manifest[field])))) throw fail('ROOT_CONFLICT', 'Persistent installation identity belongs to another descriptor');
      if (selected && (!manifest || manifest.installationId !== selected.installationId)) throw fail('ROOT_DECLARATION_INCOMPLETE', 'Ready declaration must match its exact installation receipt');
      // Inspect exact ancestor markers only to reject nesting, never to adopt their data.
      for (let parent = path.dirname(physical); parent !== path.dirname(parent); parent = path.dirname(parent)) {
        for (const marker of [INSTANCE_MANIFEST_FILE, INSTANCE_DESCRIPTOR_FILE]) {
          try { await fs.lstat(path.join(parent, marker)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
          throw fail('ROOT_CONFLICT', 'Root is nested inside another declared installation');
        }
      }
    };
    if (allowMissing) await verifyManifest();
    else await withInstallationRootInventory({ ...descriptor, root: physical }, async ({ descriptor: selected, inventory }) => {
      const declaration = findRootDeclaration(inventory, selected);
      if (!declaration) throw fail('ROOT_UNDECLARED', 'Initialize the installation explicitly before runtime admission');
      if (declaration.state !== 'ready') throw fail('ROOT_DECLARATION_INCOMPLETE', 'Installation initialization is uncertain; no automatic repair');
      await verifyManifest(declaration, selected);
    });
    token.directory = directory;
    const release = async () => { if (registry.entries.get(instanceId) === token) registry.entries.delete(instanceId); };
    capabilities.set(release, { host, instanceId, token, registry });
    return release;
  });
  registry.queue = resolve.catch(() => {});
  try { return await resolve; } catch (error) { if (registry.entries.get(instanceId) === token) registry.entries.delete(instanceId); throw error; }
}

/** Invocation-local capability, not a PID/registry ownership proof. Caller releases only after successful teardown. */
export function claimInstanceRoot(ctx, descriptor) { return claim(ctx, descriptor, false); }

/** Legacy scope-only compatibility for nonexistent fixtures; existing roots must use strict admission. */
export function claimScopeRoot(ctx, descriptor) { return claim(ctx, descriptor, true); }

/** Borrow a controller's exact live capability; scopes never release a borrowed claim. */
export function instanceRootForClaim(ctx, descriptor, capability) {
  const owned = capabilities.get(capability);
  if (!owned || owned.host !== ctx.root || owned.instanceId !== descriptor.instanceId
    || owned.registry.entries.get(owned.instanceId) !== owned.token || canonical(descriptor.root) !== owned.token.lexical) {
    throw fail('ROOT_CONFLICT', 'Expected this controller\'s live root claim capability');
  }
  return owned.token.directory;
}
