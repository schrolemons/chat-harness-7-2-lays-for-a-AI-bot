import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { findRootDeclaration, withInstallationRootInventory } from './instance-root-inventory.mjs';

export const INSTANCE_MANIFEST_FILE = '.qq-bridge-instance-manifest.json';
const fail = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });
const text = value => typeof value === 'string' && value.trim().length > 0;
const absolute = value => text(value) && path.isAbsolute(value);
const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const identityFields = ['instanceId', 'profile', 'dshHome', 'bundleName'];

function normalizeManifest(value, root) {
  if (!value || value.version !== 1 || !text(value.installationId) || !absolute(value.root)
    || key(value.root) !== key(root) || identityFields.some(field => !text(value[field])) || !absolute(value.dshHome)
    || ['profileEntries', 'links', 'sessions', 'paths'].some(field => !Array.isArray(value[field]))) {
    throw fail('MANIFEST_INVALID', 'Invalid installation identity or ownership arrays');
  }
  // Incomplete historical evidence is retained as data, never upgraded to ownership.
  const sessions = value.sessions.map(record => {
    if (!record || typeof record !== 'object') throw fail('MANIFEST_INVALID', 'Invalid session record');
    const proven = ['created', 'verified-legacy'].includes(record.source) && text(record.sessionId)
      && text(record.workspaceId) && absolute(record.path) && text(record.headerFingerprint);
    return { ...record, cleanup: proven && record.cleanup === 'owned' ? 'owned' : 'preserve' };
  });
  const paths = value.paths.map(record => {
    if (!record || typeof record !== 'object') throw fail('MANIFEST_INVALID', 'Invalid path record');
    return { ...record, cleanup: absolute(record.path) && ['data', 'dependency', 'code'].includes(record.kind)
      && record.cleanup === 'owned' ? 'owned' : 'preserve' };
  });
  return { ...value, sessions, paths };
}

async function readAt(root) {
  const file = path.join(root, INSTANCE_MANIFEST_FILE);
  let stat;
  try { stat = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) throw fail('MANIFEST_INVALID', 'Manifest must be an ordinary unlinked JSON file');
  let value;
  try { value = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw fail('MANIFEST_INVALID', 'Malformed manifest JSON'); }
  return normalizeManifest(value, root);
}

/** Read only this exact installation receipt. Missing means unknown, never adopted. */
export async function readManifest(root) {
  if (!absolute(root)) throw fail('MANIFEST_INVALID', 'Root must be absolute');
  return readAt(await fs.realpath(root));
}

async function atomicWrite(root, value) {
  const file = path.join(root, INSTANCE_MANIFEST_FILE);
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temporary, file);
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

// mkdir is the cross-process mutex; atomic rename protects readers from partial JSON.
// A stranded lock is never reclaimed by PID/name guesses and fails closed after 5s.
async function withManifestLock(root, operation) {
  if (!absolute(root)) throw fail('MANIFEST_INVALID', 'Root must be absolute');
  root = await fs.realpath(root);
  if (!(await fs.stat(root)).isDirectory()) throw fail('MANIFEST_INVALID', 'Root must be a directory');
  const guard = path.join(root, `${INSTANCE_MANIFEST_FILE}.lock`);
  const deadline = Date.now() + 5000;
  for (;;) {
    try { await fs.mkdir(guard, { mode: 0o700 }); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw fail('MANIFEST_BUSY', 'Ownership mutation is locked; inspect a stranded lock explicitly');
      await delay(10);
    }
  }
  try { return await operation(root); } finally { await fs.rmdir(guard); }
}

/** Explicit fresh installation only: binds identity and records no inferred owners. */
export async function initializeManifest(root, descriptor) {
  if (!absolute(root) || !descriptor || !absolute(descriptor.root)
    || key(await fs.realpath(root)) !== key(await fs.realpath(descriptor.root))) throw fail('MANIFEST_INVALID', 'Explicit descriptor identity is required');
  return withInstallationRootInventory(descriptor, async transaction => {
    descriptor = transaction.descriptor;
    let declaration = findRootDeclaration(transaction.inventory, descriptor);
    if (declaration?.state === 'pending') throw fail('ROOT_DECLARATION_INCOMPLETE', 'Uncertain initialization requires explicit reviewed cleanup; retry cannot repair it');
    if (!declaration) {
      declaration = { root: descriptor.root, installationId: randomUUID(),
        ...Object.fromEntries(['instanceId', 'profile', 'bundleName'].map(field => [field, descriptor[field]])), state: 'pending' };
      transaction.inventory.roots.push(declaration);
      // Persist reservation BEFORE receipt I/O; any failure retains this exclusion.
      await transaction.save();
    }
    return withManifestLock(descriptor.root, async physicalRoot => {
      const previous = await readAt(physicalRoot);
      if (previous) {
        if (identityFields.some(field => field === 'dshHome' ? key(previous[field]) !== key(descriptor[field]) : previous[field] !== descriptor[field])
          || (descriptor.installationId !== undefined && descriptor.installationId !== previous.installationId)
          || (declaration.state === 'ready' && declaration.installationId !== previous.installationId)) {
          throw fail('MANIFEST_CONFLICT', 'Installation identity is immutable');
        }
        if (declaration.state === 'pending') {
          declaration.installationId = previous.installationId; declaration.state = 'ready';
          await transaction.save();
        }
        return previous;
      }
      if (declaration.state === 'ready') throw fail('ROOT_DECLARATION_INCOMPLETE', 'Declared installation receipt is missing; no automatic reinitialization');
      const manifest = { version: 1, installationId: declaration.installationId, root: physicalRoot,
        ...Object.fromEntries(identityFields.map(field => [field, descriptor[field]])),
        profileEntries: [], links: [], sessions: [], paths: [] };
      await atomicWrite(physicalRoot, manifest);
      declaration.state = 'ready'; await transaction.save();
      return manifest;
    });
  });
}

/** Atomic append under the same filesystem mutex; never accepts a caller's stale table. */
export async function appendOwnedSession(root, record) {
  if (!record || !text(record.sessionId) || !text(record.workspaceId) || !absolute(record.path)
    || !['created', 'verified-legacy'].includes(record.source) || !['owned', 'preserve'].includes(record.cleanup)
    || !text(record.headerFingerprint)) throw fail('SESSION_INVALID', 'Explicit session header evidence is required');
  const session = Object.fromEntries(['sessionId', 'workspaceId', 'path', 'source', 'cleanup', 'headerFingerprint'].map(field => [field, record[field]]));
  return withManifestLock(root, async physicalRoot => {
    const manifest = await readAt(physicalRoot);
    if (!manifest) throw fail('MANIFEST_MISSING', 'Initialize installation ownership explicitly before appending');
    const previous = manifest.sessions.find(row => row.sessionId === session.sessionId);
    if (previous) {
      if (Object.keys(session).some(field => previous[field] !== session[field])) throw fail('SESSION_CONFLICT', 'Session already has different ownership evidence');
      return previous;
    }
    manifest.sessions.push(session);
    await atomicWrite(physicalRoot, manifest);
    return session;
  });
}
