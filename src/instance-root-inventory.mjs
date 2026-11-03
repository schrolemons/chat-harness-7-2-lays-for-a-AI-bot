import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const INSTALLATION_ROOTS_FILE = 'installation-roots.json';
const fail = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });
const text = value => typeof value === 'string' && value.trim().length > 0;
const absolute = value => text(value) && path.isAbsolute(value);
const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const overlaps = (a, b) => {
  const contains = (parent, child) => { const relative = path.relative(key(parent), key(child)); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
  return contains(a, b) || contains(b, a);
};

/** Exact declarations only. These are directory boundaries, never data/session ownership. */
export function findRootDeclaration(inventory, descriptor) {
  let matching;
  for (const record of inventory.roots) {
    if (!overlaps(record.root, descriptor.root) && record.instanceId !== descriptor.instanceId) continue;
    if (key(record.root) !== key(descriptor.root) || ['instanceId', 'profile', 'bundleName'].some(field => record[field] !== descriptor[field])) {
      throw fail('ROOT_CONFLICT', 'A durable installation declaration reserves this instance or overlapping root');
    }
    matching = record;
  }
  return matching;
}

async function readInventory(file) {
  let stat;
  try { stat = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return { version: 1, roots: [] }; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw fail('ROOT_INVENTORY_INVALID', 'Inventory must be an ordinary JSON file');
  let inventory;
  try { inventory = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw fail('ROOT_INVENTORY_INVALID', 'Malformed inventory JSON'); }
  if (!inventory || inventory.version !== 1 || !Array.isArray(inventory.roots)
    || inventory.roots.some(record => !record || !absolute(record.root) || !['pending', 'ready'].includes(record.state)
      || ['installationId', 'instanceId', 'profile', 'bundleName'].some(field => !text(record[field])))) throw fail('ROOT_INVENTORY_INVALID', 'Invalid explicit installation declarations');
  for (let i = 0; i < inventory.roots.length; i++) {
    for (const other of inventory.roots.slice(i + 1)) {
      if (overlaps(inventory.roots[i].root, other.root) || inventory.roots[i].instanceId === other.instanceId
        || inventory.roots[i].installationId === other.installationId) throw fail('ROOT_INVENTORY_INVALID', 'Inventory contains conflicting declarations');
    }
  }
  return inventory;
}

async function writeInventory(file, inventory) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(inventory, null, 2)}\n`);
    await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temporary, file);
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Internal shared transaction for explicit initialization and strict runtime admission.
 * Lock order is inventory -> root manifest. No stale-lock reclamation or repair.
 */
export async function withInstallationRootInventory(descriptor, operation) {
  if (!descriptor || !absolute(descriptor.root) || !absolute(descriptor.dshHome)
    || ['instanceId', 'profile', 'bundleName'].some(field => !text(descriptor[field]))) throw fail('ROOT_INVALID', 'Explicit root, selected DSH home and installation identity are required');
  const root = await fs.realpath(descriptor.root);
  if (!(await fs.stat(root)).isDirectory()) throw fail('ROOT_INVALID', 'Installation root must be a directory');
  if ([descriptor.root, root].some(value => key(value).split(path.sep).includes('.worktrees'))) throw fail('ROOT_CONFLICT', 'A development worktree cannot be a runtime installation');
  await fs.mkdir(descriptor.dshHome, { recursive: true, mode: 0o700 });
  const dshHome = await fs.realpath(descriptor.dshHome);
  const directory = path.join(dshHome, 'bot-instances');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('ROOT_INVENTORY_INVALID', 'Management directory must be a real directory');
  const file = path.join(directory, INSTALLATION_ROOTS_FILE);
  const guard = `${file}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try { await fs.mkdir(guard, { mode: 0o700 }); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw fail('ROOT_INVENTORY_BUSY', 'Installation declaration lock requires explicit inspection');
      await delay(10);
    }
  }
  try {
    const inventory = await readInventory(file);
    return await operation({ descriptor: { ...descriptor, root, dshHome }, inventory,
      save: () => writeInventory(file, inventory) });
  } finally { await fs.rmdir(guard); }
}
