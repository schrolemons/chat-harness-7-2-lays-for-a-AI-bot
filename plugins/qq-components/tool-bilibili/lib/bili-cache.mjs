import path from 'node:path';
import fs from 'node:fs/promises';
import { BiliError } from './bili-core.mjs';

const MAX_ENTRY_BYTES = 1024 * 1024;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;

function cacheError(code, message) { return new BiliError(code, message); }

export function resolveCachePath(cacheRoot, cacheDir = 'bilibili') {
  const relative = String(cacheDir ?? '').trim();
  if (!relative || path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative) || relative.split(/[\\/]+/).includes('..')) {
    throw cacheError('INVALID_CACHE_PATH', '缓存目录必须是状态目录下的相对路径');
  }
  const root = path.resolve(cacheRoot);
  const resolved = path.resolve(root, relative);
  const fromRoot = path.relative(root, resolved);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw cacheError('INVALID_CACHE_PATH', '缓存目录必须位于允许的状态目录内');
  }
  return resolved;
}

export function createCache({ cacheRoot, cacheDir = 'bilibili', ttlMs = 5 * 60 * 1000, maxEntries = 200, now = () => Date.now(), fileOps = fs } = {}) {
  if (!cacheRoot) throw cacheError('INVALID_CACHE_PATH', '缺少缓存根目录');
  const directory = resolveCachePath(cacheRoot, cacheDir);
  const file = path.join(directory, 'cache.json');
  const ttl = Math.max(1, Number(ttlMs) || 0);
  const cap = Math.max(1, Math.min(1000, Math.floor(Number(maxEntries) || 200)));
  let writeQueue = Promise.resolve();

  async function readStore() {
    try {
      const text = await fileOps.readFile(file, 'utf8');
      if (Buffer.byteLength(text) > MAX_CACHE_BYTES) return {};
      const store = JSON.parse(text);
      return store && typeof store === 'object' && !Array.isArray(store) ? store : {};
    } catch { return {}; }
  }

  async function writeStore(store) {
    const text = JSON.stringify(store);
    if (Buffer.byteLength(text) > MAX_CACHE_BYTES) throw cacheError('CACHE_FULL', 'Bilibili 缓存超过大小上限');
    await fileOps.mkdir(directory, { recursive: true });
    const temp = path.join(directory, `.cache-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
    try {
      await fileOps.writeFile(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fileOps.rename(temp, file);
    } finally {
      await fileOps.rm(temp, { force: true }).catch(() => {});
    }
  }

  return {
    directory,
    async get(key) {
      const name = String(key ?? '');
      if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(name)) return null;
      const store = await readStore();
      const entry = store[name];
      if (!entry || !Number.isFinite(Number(entry.at)) || now() - Number(entry.at) >= ttl) {
        if (entry) { delete store[name]; await writeStore(store); }
        return null;
      }
      return entry.value ?? null;
    },
    async set(key, value) {
      const name = String(key ?? '');
      if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(name)) throw cacheError('INVALID_CACHE_KEY', '缓存键格式无效');
      const serialized = JSON.stringify(value);
      if (serialized === undefined || Buffer.byteLength(serialized) > MAX_ENTRY_BYTES) throw cacheError('CACHE_ENTRY_TOO_LARGE', '缓存内容超过单项大小上限');
      const work = writeQueue.then(async () => {
        const store = await readStore();
        for (const [entryKey, entry] of Object.entries(store)) {
          if (!Number.isFinite(Number(entry?.at)) || now() - Number(entry.at) >= ttl) delete store[entryKey];
        }
        store[name] = { at: now(), value: JSON.parse(serialized) };
        const entries = Object.entries(store).sort((a, b) => Number(b[1]?.at) - Number(a[1]?.at));
        for (const [keyToDrop] of entries.slice(cap)) delete store[keyToDrop];
        await writeStore(store);
      });
      writeQueue = work.catch(() => {});
      await work;
    },
    async clear() {
      const work = writeQueue.then(async () => { await fileOps.rm(file, { force: true }); });
      writeQueue = work.catch(() => {});
      return work;
    }
  };
}
