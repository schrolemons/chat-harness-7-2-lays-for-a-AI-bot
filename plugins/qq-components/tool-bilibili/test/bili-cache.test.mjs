import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createCache } from '../lib/bili-cache.mjs';

test('stores and reads short-lived JSON cache entries', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bili-cache-test-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let now = 1000;
  const cache = createCache({ cacheRoot: rootDir, cacheDir: 'bilibili', ttlMs: 500, now: () => now });
  await cache.set('info:BV1xx411c7mD', { title: 'public metadata', pages: [{ cid: 1 }] });
  assert.deepEqual(await cache.get('info:BV1xx411c7mD'), { title: 'public metadata', pages: [{ cid: 1 }] });
  now += 501;
  assert.equal(await cache.get('info:BV1xx411c7mD'), null);
});

test('rejects absolute and traversal cache directories', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bili-cache-path-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  assert.throws(() => createCache({ cacheRoot: rootDir, cacheDir: '../outside' }), { code: 'INVALID_CACHE_PATH' });
  assert.throws(() => createCache({ cacheRoot: rootDir, cacheDir: path.join(rootDir, 'absolute') }), { code: 'INVALID_CACHE_PATH' });
});

test('evicts old cache entries when the entry cap is reached', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bili-cache-cap-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const cache = createCache({ cacheRoot: rootDir, cacheDir: 'bilibili', ttlMs: 5000, maxEntries: 2 });
  await cache.set('a', { n: 1 });
  await cache.set('b', { n: 2 });
  await cache.set('c', { n: 3 });
  assert.equal(await cache.get('a'), null);
  assert.deepEqual(await cache.get('c'), { n: 3 });
});
