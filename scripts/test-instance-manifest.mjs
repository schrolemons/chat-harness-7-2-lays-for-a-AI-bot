import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
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
  await assert.rejects(initializeManifest(root, { ...descriptor, instanceId: 'beta' }), /ROOT_CONFLICT|MANIFEST_CONFLICT/);
  await assert.rejects(claimInstanceRoot({ root: {} }, { ...descriptor, instanceId: 'beta' }), /ROOT_CONFLICT/);
  await assert.rejects(createInstanceScope({ root: {} }, { ...descriptor, instanceId: 'beta' }), /ROOT_CONFLICT/, 'actual descriptors always use strict inventory admission');
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
  assert.match(results.find(row => row.status === 'rejected').reason.message, /ROOT_CONFLICT|MANIFEST_CONFLICT/);
  const winner = results.find(row => row.status === 'fulfilled').value;
  const stored = await readManifest(root);
  assert.equal(stored.instanceId, winner.instanceId);
  assert.equal(stored.installationId, winner.installationId);
  for (const change of [{ profile: 'another-profile' }, { bundleName: 'another-bundle' }, { dshHome: path.join(root, 'another-home') }, { installationId: 'another-installation' }]) {
    await assert.rejects(initializeManifest(root, { ...descriptor, instanceId: winner.instanceId, ...change }), /ROOT_CONFLICT|MANIFEST_CONFLICT/);
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

test('an inactive declared child excludes its parent across independent host contexts', async t => {
  const { root, descriptor } = await fixture(t);
  const child = path.join(root, 'child'); await fs.mkdir(child);
  await initializeManifest(child, { ...descriptor, root: child });
  await assert.rejects(claimInstanceRoot({ root: {} }, { ...descriptor, instanceId: 'beta' }), /ROOT_CONFLICT/);
  await assert.rejects(initializeManifest(root, { ...descriptor, instanceId: 'beta' }), /ROOT_CONFLICT/);
});

test('inactive parent declarations exclude children and release keeps the declaration for reenable', async t => {
  const { root, descriptor } = await fixture(t);
  await initializeManifest(root, descriptor);
  const release = await claimInstanceRoot({ root: {} }, descriptor); await release();
  const child = path.join(root, 'child'); await fs.mkdir(child);
  await assert.rejects(initializeManifest(child, { ...descriptor, instanceId: 'beta', root: child }), /ROOT_CONFLICT/);
  await (await claimInstanceRoot({ root: {} }, descriptor))();
});

test('independent concurrent processes cannot declare nested installations', async t => {
  const { root, descriptor } = await fixture(t);
  const childRoot = path.join(root, 'child'); await fs.mkdir(childRoot);
  const moduleUrl = new URL('../src/instance-manifest.mjs', import.meta.url).href;
  const source = `import {initializeManifest} from ${JSON.stringify(moduleUrl)}; const d=JSON.parse(process.argv[1]); try { const receipt=await initializeManifest(d.root,d); console.log(JSON.stringify({ok:true,root:receipt.root})); } catch(e) { console.log(JSON.stringify({ok:false,code:e.code})); }`;
  const results = await Promise.all([descriptor, { ...descriptor, instanceId: 'beta', root: childRoot }].map(d => promisify(execFile)(process.execPath, ['--input-type=module', '-e', source, JSON.stringify(d)], { windowsHide: true })));
  const outcomes = results.map(row => JSON.parse(row.stdout));
  assert.equal(outcomes.filter(row => row.ok).length, 1);
  assert.equal(outcomes.find(row => !row.ok).code, 'ROOT_CONFLICT');
});

test('persistent exclusion resolves junction and case aliases after release', async t => {
  const { root, descriptor } = await fixture(t);
  const child = path.join(root, 'child'); await fs.mkdir(child);
  await initializeManifest(child, { ...descriptor, root: child });
  const alias = path.join(root, 'alias');
  await fs.symlink(child, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const release = await claimInstanceRoot({ root: {} }, { ...descriptor, root: alias }); await release();
  const roots = [alias, ...(process.platform === 'win32' ? [child.toUpperCase()] : [])];
  for (const aliased of roots) await assert.rejects(initializeManifest(aliased, { ...descriptor, instanceId: 'beta', root: aliased }), /ROOT_CONFLICT|MANIFEST_CONFLICT/);
  await assert.rejects(initializeManifest(root, { ...descriptor, instanceId: 'beta' }), /ROOT_CONFLICT/);
});

test('failed manifest publication retains a blocking declaration and never admits its parent', async t => {
  const { root, descriptor } = await fixture(t);
  const child = path.join(root, 'child'); await fs.mkdir(child);
  // A directory at the exact receipt path makes publication fail after declaration.
  await fs.mkdir(path.join(child, '.qq-bridge-instance-manifest.json'));
  await assert.rejects(initializeManifest(child, { ...descriptor, root: child }));
  await fs.rmdir(path.join(child, '.qq-bridge-instance-manifest.json'));
  await assert.rejects(claimInstanceRoot({ root: {} }, { ...descriptor, instanceId: 'beta' }), /ROOT_CONFLICT/);
  await assert.rejects(claimInstanceRoot({ root: {} }, { ...descriptor, root: child }), /ROOT_CONFLICT|ROOT_DECLARATION_INCOMPLETE/);
  await assert.rejects(initializeManifest(child, { ...descriptor, root: child }), /ROOT_DECLARATION_INCOMPLETE/, 'retry cannot silently complete an uncertain declaration');
});

test('failure to acquire a root receipt lock still retains its durable declaration', async t => {
  const { root, descriptor } = await fixture(t);
  const child = path.join(root, 'child'); await fs.mkdir(child);
  const guard = path.join(child, '.qq-bridge-instance-manifest.json.lock');
  await fs.writeFile(guard, 'synthetic stranded lock');
  await assert.rejects(initializeManifest(child, { ...descriptor, root: child }), /MANIFEST_BUSY/);
  await fs.unlink(guard);
  await assert.rejects(initializeManifest(root, { ...descriptor, instanceId: 'beta' }), /ROOT_CONFLICT/);
  await assert.rejects(claimInstanceRoot({ root: {} }, { ...descriptor, instanceId: 'beta' }), /ROOT_CONFLICT/);
  await assert.rejects(initializeManifest(child, { ...descriptor, root: child }), /ROOT_DECLARATION_INCOMPLETE/);
});

test('runtime admission needs selected home and a ready explicit declaration rather than adopting a receipt', async t => {
  const { root, descriptor } = await fixture(t);
  await assert.rejects(claimInstanceRoot({ root: {} }, { instanceId: 'alpha', root }), /ROOT_INVALID/);
  await assert.rejects(claimInstanceRoot({ root: {} }, descriptor), /ROOT_UNDECLARED/);
  await assert.rejects(createInstanceScope({ root: {} }, descriptor), /ROOT_UNDECLARED/);
  await assert.rejects(createInstanceScope({ root: {} }, { instanceId: 'alpha', root }), /ROOT_INVALID/, 'an existing root cannot use the synthetic missing-directory fallback');
  assert.equal(await readManifest(root), null);
});

test('selected DSH-home aliases share authority and allow the same installation to reenable', async t => {
  const { root, descriptor } = await fixture(t);
  await initializeManifest(root, descriptor);
  const homeAlias = path.join(root, 'host-alias');
  await fs.symlink(descriptor.dshHome, homeAlias, process.platform === 'win32' ? 'junction' : 'dir');
  await (await claimInstanceRoot({ root: {} }, { ...descriptor, dshHome: homeAlias }))();
  if (process.platform === 'win32') await (await claimInstanceRoot({ root: {} }, { ...descriptor, dshHome: descriptor.dshHome.toUpperCase() }))();
  const child = path.join(root, 'child'); await fs.mkdir(child);
  await assert.rejects(initializeManifest(child, { ...descriptor, root: child, instanceId: 'beta', dshHome: homeAlias }), /ROOT_CONFLICT/);
});

test('interrupted initialization leaves pending exclusion and its stranded shared lock fails closed', async t => {
  const { root, descriptor } = await fixture(t);
  const childRoot = path.join(root, 'child'); await fs.mkdir(childRoot);
  await fs.mkdir(path.join(childRoot, '.qq-bridge-instance-manifest.json.lock'));
  const moduleUrl = new URL('../src/instance-manifest.mjs', import.meta.url).href;
  const source = `import {initializeManifest} from ${JSON.stringify(moduleUrl)}; const d=JSON.parse(process.argv[1]); await initializeManifest(d.root,d);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, JSON.stringify({ ...descriptor, root: childRoot })], { windowsHide: true, stdio: 'ignore' });
  let exited = false;
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', () => { exited = true; resolve(); }); });
  t.after(async () => { if (!exited) { child.kill(); await exit; } });
  const inventoryFile = path.join(descriptor.dshHome, 'bot-instances', 'installation-roots.json');
  let inventory;
  for (let i = 0; i < 200; i++) {
    try { inventory = JSON.parse(await fs.readFile(inventoryFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (inventory?.roots[0]?.state === 'pending') break;
    await delay(10);
  }
  assert.equal(inventory?.roots[0]?.state, 'pending');
  child.kill(); await exit;
  await assert.rejects(claimInstanceRoot({ root: {} }, { ...descriptor, instanceId: 'beta' }), /ROOT_INVENTORY_BUSY/);
  assert.equal(JSON.parse(await fs.readFile(inventoryFile, 'utf8')).roots[0].state, 'pending');
  assert.equal(await readManifest(childRoot), null);
});
