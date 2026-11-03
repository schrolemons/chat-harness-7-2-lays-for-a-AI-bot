import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { claimInstanceRoot, readInstanceDescriptor } from '../src/instance-descriptor.mjs';
import { createInstanceScope } from '../src/dsh-instance-scope.mjs';
import { initializeManifest } from '../src/instance-manifest.mjs';

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-descriptor-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const identity = { profile: 'fixture', dshHome: path.join(base, 'host') };
  const a = { ...identity, instanceId: 'alpha', bundleName: 'synthetic-alpha', root: path.join(base, 'Alpha') };
  const b = { ...identity, instanceId: 'beta', bundleName: 'synthetic-beta', root: path.join(base, 'Beta') };
  await fs.mkdir(a.root); await fs.mkdir(b.root);
  await initializeManifest(a.root, a); await initializeManifest(b.root, b);
  return { base, a, b, ctx: { root: {} } };
}

test('different instance IDs cannot claim the same physical root', async t => {
  const { ctx, a, b } = await fixture(t);
  const release = await claimInstanceRoot(ctx, a);
  await assert.rejects(claimInstanceRoot(ctx, { ...b, root: a.root }), /ROOT_CONFLICT/);
  await (await claimInstanceRoot(ctx, b))();
  await release(); await release();
});

test('junction aliases, casing and parent/child roots cannot bypass exclusive claim', async t => {
  const { ctx, base, a, b } = await fixture(t);
  await fs.mkdir(path.join(a.root, 'nested'));
  const alias = path.join(base, 'alias');
  await fs.symlink(a.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const release = await claimInstanceRoot(ctx, a);
  for (const root of [alias, path.join(a.root, 'nested'), base, ...(process.platform === 'win32' ? [a.root.toUpperCase()] : [])]) {
    await assert.rejects(claimInstanceRoot(ctx, { ...b, root }), /ROOT_CONFLICT/);
  }
  await release();
});

test('concurrent same-root claims admit only one and rollback leaves its reservation intact', async t => {
  const { ctx, a, b } = await fixture(t);
  const results = await Promise.allSettled([claimInstanceRoot(ctx, a), claimInstanceRoot(ctx, { ...b, root: a.root })]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.match(results.find(row => row.status === 'rejected').reason.message, /ROOT_CONFLICT/);
  await assert.rejects(claimInstanceRoot(ctx, { instanceId: 'third', root: a.root }), /ROOT_CONFLICT/);
  await results.find(row => row.status === 'fulfilled').value();
  await (await claimInstanceRoot(ctx, b))();
});

test('duplicate ID is reserved before resolution and failed resolution rolls back only itself', async t => {
  const { ctx, a, b } = await fixture(t);
  const pending = claimInstanceRoot(ctx, a);
  await assert.rejects(claimInstanceRoot(ctx, { ...b, instanceId: a.instanceId }), /INSTANCE_CONFLICT/);
  const release = await pending;
  await assert.rejects(claimInstanceRoot(ctx, { ...b, root: path.join(b.root, 'missing') }), /ENOENT/);
  await (await claimInstanceRoot(ctx, b))();
  await assert.rejects(claimInstanceRoot(ctx, { ...b, root: a.root }), /ROOT_CONFLICT/);
  await release();
});

test('concurrent junction claims resolve before either can admit an overlapping installation', async t => {
  const { ctx, base, a, b } = await fixture(t);
  const alias = path.join(base, 'alias');
  await fs.symlink(a.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const results = await Promise.allSettled([claimInstanceRoot(ctx, a), claimInstanceRoot(ctx, { ...b, root: alias })]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.match(results.find(row => row.status === 'rejected').reason.message, /ROOT_CONFLICT/);
  await results.find(row => row.status === 'fulfilled').value();
});

test('a public runtime under an already claimed private checkout is rejected', async t => {
  const { ctx, a, b } = await fixture(t);
  const root = path.join(a.root, '.worktrees', 'public-development');
  await fs.mkdir(root, { recursive: true });
  const release = await claimInstanceRoot(ctx, a);
  await assert.rejects(claimInstanceRoot(ctx, { ...b, root }), /ROOT_CONFLICT/);
  await release();
  await assert.rejects(claimInstanceRoot(ctx, { ...b, root }), /ROOT_CONFLICT/, 'development checkout remains invalid even while the private instance is inactive');
  const alias = path.join(b.root, 'development-alias');
  await fs.symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(claimInstanceRoot(ctx, { ...b, root: alias }), /ROOT_CONFLICT/);
  if (process.platform === 'win32') await assert.rejects(claimInstanceRoot(ctx, { ...b, root: root.toUpperCase() }), /ROOT_CONFLICT/);
});

test('descriptor has explicit identity, physical root and isolated defaults, with no writes', async t => {
  const { a, base } = await fixture(t);
  const descriptor = {
    version: 1, instanceId: 'alpha', label: 'Alpha bot', root: a.root,
    bundleName: 'synthetic-alpha', entryId: 'alpha-entry', settingsNamespace: 'alpha-mode',
    profile: 'fixture', dshHome: path.join(base, 'host'), presetIdMap: { chat: 'alpha:chat' },
  };
  await fs.writeFile(path.join(a.root, '.qq-bridge-instance.json'), JSON.stringify(descriptor));
  const before = await fs.readdir(a.root);
  const actual = await readInstanceDescriptor(a.root);
  assert.equal(actual.root, await fs.realpath(a.root));
  assert.equal(actual.registryDir, path.join(base, 'host', 'bot-instances', 'account-leases'));
  assert.deepEqual(actual.workspaces, Object.fromEntries(['chat', 'learning', 'task', 'summary'].map(kind => [kind, path.join(a.root, 'state', 'workspaces', 'alpha', kind)])));
  assert.deepEqual(await fs.readdir(a.root), before);
  await fs.writeFile(path.join(a.root, '.qq-bridge-instance.json'), JSON.stringify({ ...descriptor, root: base }));
  await assert.rejects(readInstanceDescriptor(a.root), /DESCRIPTOR_INVALID/);
});

test('scope shares only a caller-owned claim and failed disposal keeps the root busy', async t => {
  const { ctx, a, b } = await fixture(t);
  ctx.loader = { builtins: {} }; ctx.effect = () => {};
  ctx.agentPresets = { register: async () => async () => {} };
  const EntryGroup = { key: Symbol('entry-group') };
  class Group { static [EntryGroup.key] = true; }
  const hostImport = async name => name.endsWith('dsh-scope')
    ? { createScope: () => ({ ctx: {}, dispose: async () => { throw new Error('fixture disposal failed'); } }) }
    : { EntryGroup, Group };
  const rootClaim = await claimInstanceRoot(ctx, a);
  const scope = await createInstanceScope(ctx, { ...a, rootClaim, hostImport });
  await assert.rejects(scope.dispose(), /Instance disposal failed/);
  await assert.rejects(claimInstanceRoot(ctx, { ...b, root: a.root }), /ROOT_CONFLICT/);
  // Controller retains this capability after uncertain teardown; no release is attempted.
});

test('scope releases its own root on setup failure even when the host loader is missing', async t => {
  const { ctx, a, b } = await fixture(t);
  await assert.rejects(createInstanceScope(ctx, a), /loader|builtins/i);
  const release = await claimInstanceRoot(ctx, a);
  await release();
});

test('scope cannot borrow a forged or released controller claim', async t => {
  const { ctx, a } = await fixture(t);
  await assert.rejects(createInstanceScope(ctx, { ...a, rootClaim: async () => {} }), /ROOT_CONFLICT/);
  const rootClaim = await claimInstanceRoot(ctx, a);
  await rootClaim();
  await assert.rejects(createInstanceScope(ctx, { ...a, rootClaim }), /ROOT_CONFLICT/);
});

test('successful scope teardown leaves a borrowed controller claim exclusively held', async t => {
  const { ctx, a, b } = await fixture(t);
  const EntryGroup = { key: Symbol('entry-group') };
  class Group { static [EntryGroup.key] = true; }
  ctx.loader = { builtins: {} }; ctx.effect = () => {};
  const hostImport = async name => name.endsWith('dsh-scope')
    ? { createScope: () => ({ ctx: {}, dispose: async () => {} }) } : { EntryGroup, Group };
  const rootClaim = await claimInstanceRoot(ctx, a);
  const scope = await createInstanceScope(ctx, { ...a, hostImport, rootClaim });
  await scope.dispose();
  await assert.rejects(claimInstanceRoot(ctx, { ...b, root: a.root }), /ROOT_CONFLICT/);
  await rootClaim();
  await assert.rejects(claimInstanceRoot(ctx, { ...b, root: a.root }), /ROOT_CONFLICT/);
  await (await claimInstanceRoot(ctx, a))();
});

test('failed scope teardown retains its own root claim for other instance IDs too', async t => {
  const { ctx, a, b } = await fixture(t);
  const EntryGroup = { key: Symbol('entry-group') };
  class Group { static [EntryGroup.key] = true; }
  ctx.loader = { builtins: {} }; ctx.effect = () => {};
  const hostImport = async name => name.endsWith('dsh-scope')
    ? { createScope: () => ({ ctx: {}, dispose: async () => { throw new Error('uncertain disposal'); } }) } : { EntryGroup, Group };
  const scope = await createInstanceScope(ctx, { ...a, hostImport });
  await assert.rejects(scope.dispose(), /Instance disposal failed/);
  await assert.rejects(claimInstanceRoot(ctx, { ...b, root: a.root }), /ROOT_CONFLICT/);
  await assert.rejects(createInstanceScope(ctx, { ...a, hostImport }), /INSTANCE_CONFLICT/);
});

test('explicit summary workspace survives the actual descriptor reader and validates like other workspaces', async t => {
  const {a}=await fixture(t);
  const value={...a,version:1,label:'Synthetic alpha',entryId:'alpha-mode',settingsNamespace:'alpha-mode',presetIdMap:{},workspaces:{summary:path.join(a.root,'state','alpha-summary')}};
  const file=path.join(a.root,'.qq-bridge-instance.json');await fs.writeFile(file,JSON.stringify(value));
  const before=await fs.readFile(file);const read=await readInstanceDescriptor(a.root);
  assert.equal(read.workspaces.summary,value.workspaces.summary);assert.deepEqual(await fs.readFile(file),before);
  const {readInstanceSessionPolicy}=await import('../src/instance-session-policy.mjs');assert.equal(readInstanceSessionPolicy({descriptor:read}).workspace('summary'),value.workspaces.summary);
  value.workspaces.summary='relative-summary';await fs.writeFile(file,JSON.stringify(value));await assert.rejects(readInstanceDescriptor(a.root),/DESCRIPTOR_INVALID/);
});
