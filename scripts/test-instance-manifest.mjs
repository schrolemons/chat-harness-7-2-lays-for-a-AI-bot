import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { appendOwnedSession, initializeManifest, readManifest } from '../src/instance-manifest.mjs';
import { claimInstanceRoot } from '../src/instance-descriptor.mjs';
import { createInstanceScope } from '../src/dsh-instance-scope.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-manifest-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const descriptor = { instanceId: 'alpha', root, profile: 'fixture', dshHome: path.join(root, 'host'), bundleName: 'synthetic-alpha' };
  const record = id => ({ sessionId: id, workspaceId: 'workspace-alpha', path: path.join(root, 'sessions', id), source: 'created', cleanup: 'owned', headerFingerprint: 'synthetic-header-' + id });
  return { root, descriptor, record };
}

test('missing manifest preserves legacy data and never infers ownership from filenames', async t => {
  const { root, descriptor } = await fixture(t);
  await fs.mkdir(path.join(root, 'state'));
  await fs.writeFile(path.join(root, 'state', 'legacy-session.json'), '{"pid":123}');
  assert.equal(await readManifest(root), null);
  const initial = await initializeManifest(root, descriptor);
  assert.ok(initial.installationId);
  assert.deepEqual(initial.sessions, []); assert.deepEqual(initial.paths, []);
  assert.deepEqual(initial.links, []); assert.deepEqual(initial.profileEntries, []);
  assert.equal(await fs.readFile(path.join(root, 'state', 'legacy-session.json'), 'utf8'), '{"pid":123}');
  assert.equal((await initializeManifest(root, descriptor)).installationId, initial.installationId);
  await assert.rejects(initializeManifest(root, { ...descriptor, instanceId: 'beta' }), /MANIFEST_CONFLICT/);
  await assert.rejects(claimInstanceRoot({ root: {} }, { instanceId: 'beta', root }), /ROOT_CONFLICT/);
  await assert.rejects(createInstanceScope({ root: {} }, { instanceId: 'beta', root }), /ROOT_CONFLICT/, 'legacy scope API cannot bypass persistent identity');
});

test('append requires explicit initialization and preserves unknown legacy records', async t => {
  const { root, descriptor, record } = await fixture(t);
  await assert.rejects(appendOwnedSession(root, record('new')), /MANIFEST_MISSING/);
  const initial = await initializeManifest(root, descriptor);
  const file = path.join(root, '.qq-bridge-instance-manifest.json');
  await fs.writeFile(file, JSON.stringify({ ...initial, sessions: [{ sessionId: 'legacy', cleanup: 'owned', path: path.join(root, 'legacy') }], paths: [{ path: path.join(root, 'legacy') }] }));
  await appendOwnedSession(root, record('new'));
  const manifest = await readManifest(root);
  assert.equal(manifest.sessions[0].cleanup, 'preserve');
  assert.equal(manifest.paths[0].cleanup, 'preserve');
  assert.equal(manifest.sessions[1].cleanup, 'owned');
  await assert.rejects(appendOwnedSession(root, { ...record('new'), headerFingerprint: 'changed' }), /SESSION_CONFLICT/);
  await appendOwnedSession(root, record('new'));
  assert.equal((await readManifest(root)).sessions.length, 2);
});

test('concurrent installation declarations cannot replace the winning immutable identity', async t => {
  const { root, descriptor } = await fixture(t);
  const results = await Promise.allSettled([
    initializeManifest(root, descriptor), initializeManifest(root, { ...descriptor, instanceId: 'beta' }),
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.match(results.find(row => row.status === 'rejected').reason.message, /MANIFEST_CONFLICT/);
  const winner = results.find(row => row.status === 'fulfilled').value;
  const stored = await readManifest(root);
  assert.equal(stored.instanceId, winner.instanceId);
  assert.equal(stored.installationId, winner.installationId);
  for (const change of [{ profile: 'another-profile' }, { bundleName: 'another-bundle' }, { dshHome: path.join(root, 'another-home') }, { installationId: 'another-installation' }]) {
    await assert.rejects(initializeManifest(root, { ...descriptor, instanceId: winner.instanceId, ...change }), /MANIFEST_CONFLICT/);
  }
});

test('concurrent process appends never overwrite one another', async t => {
  const { root, descriptor, record } = await fixture(t);
  await initializeManifest(root, descriptor);
  const moduleUrl = new URL('../src/instance-manifest.mjs', import.meta.url).href;
  const child = `import { appendOwnedSession } from ${JSON.stringify(moduleUrl)}; const [root,record]=process.argv.slice(1); await appendOwnedSession(root,JSON.parse(record));`;
  await Promise.all(Array.from({ length: 10 }, (_, i) => promisify(execFile)(process.execPath, ['--input-type=module', '-e', child, root, JSON.stringify(record('child-' + i))], { windowsHide: true })));
  const manifest = await readManifest(root);
  assert.equal(manifest.sessions.length, 10);
  assert.equal(new Set(manifest.sessions.map(row => row.sessionId)).size, 10);
});

test('malformed or linked manifests fail closed without rewriting their target', async t => {
  const { root, descriptor, record } = await fixture(t);
  const file = path.join(root, '.qq-bridge-instance-manifest.json');
  await fs.writeFile(file, '{broken');
  await assert.rejects(initializeManifest(root, descriptor), /MANIFEST_INVALID/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  await fs.unlink(file);
  const target = path.join(root, 'unrelated.json');
  await fs.writeFile(target, '{}');
  try { await fs.symlink(target, file); } catch (error) { if (error.code === 'EPERM') return; throw error; }
  await assert.rejects(appendOwnedSession(root, record('new')), /MANIFEST_INVALID/);
  assert.equal(await fs.readFile(target, 'utf8'), '{}');
});
