import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const api = await import('../src/instance-ownership.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const { acquireAccountLease, createProcessOwnership, stopOwnedProcesses, probeProcess } = api;
const owner = { pid: process.pid, startTime: 'owner-start' };
const liveOwner = { ...owner, executablePath: process.execPath, parentPid: 1 };
async function fixture(t) {
  const registryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-instance-ownership-'));
  t.after(() => fs.rm(registryDir, { recursive: true, force: true }));
  const processes = new Map([[process.pid, liveOwner]]);
  const options = { registryDir, botUin: '12345', instanceId: 'public', owner, probeProcess: async pid => processes.get(pid) ?? null };
  return { registryDir, processes, options, file: path.join(registryDir, '12345.json') };
}
const code = expected => error => error.code === expected;

test('ownership API exists before consumers can claim or stop runtimes', () => {
  for (const name of ['acquireAccountLease', 'createProcessOwnership', 'stopOwnedProcesses', 'probeProcess']) assert.equal(typeof api[name], 'function', name);
});

test('same normalized QQ refuses concurrent ownership while different QQ is independent', async t => {
  const { options } = await fixture(t);
  const first = await acquireAccountLease(options);
  await assert.rejects(acquireAccountLease({ ...options, botUin: ' 0012345 ', instanceId: 'private' }), code('ACCOUNT_IN_USE'));
  const other = await acquireAccountLease({ ...options, botUin: '67890' });
  assert.notEqual(first.nonce, other.nonce);
  await first.release();
  await other.release();
  const replacement = await acquireAccountLease(options);
  await replacement.release();
  // A legacy runtime must not enter this account's critical section.
  await assert.rejects(fs.mkdir(path.join(options.registryDir, '12345.guard')), code('EEXIST'));
});

test('atomic racing claims grant exactly one lease', async t => {
  const { options } = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => acquireAccountLease(options)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => ['ACCOUNT_IN_USE', 'ACCOUNT_BUSY'].includes(r.reason.code)));
  await results.find(r => r.status === 'fulfilled').value.release();
});

test('a killed lock holder cannot strand an account lock', async t => {
  const { options, file } = await fixture(t);
  const previousPid = process.pid === 77001 ? 77002 : 77001;
  await fs.writeFile(file, JSON.stringify({
    version: 1, botUin: options.botUin, instanceId: 'old', nonce: 'previous',
    owner: { pid: previousPid, startTime: 'old' }, processes: [],
  }));
  const moduleUrl = new URL('../src/instance-ownership.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireAccountLease } from ${JSON.stringify(moduleUrl)};
    const owner = { pid: process.pid, startTime: 'child' };
    await acquireAccountLease({
      registryDir: process.argv[1], botUin: '12345', instanceId: 'child', owner,
      probeProcess: async pid => {
        if (pid === owner.pid) return { ...owner, executablePath: process.execPath };
        setInterval(() => {}, 1000);
        process.send('lock held');
        await new Promise(() => {});
      },
    });
  `, options.registryDir], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = once(child, 'exit');
  try {
    assert.equal(await Promise.race([once(child, 'message').then(([value]) => value), exited]), 'lock held');
    await assert.rejects(acquireAccountLease(options), code('ACCOUNT_BUSY'));
    const independent = await acquireAccountLease({ ...options, botUin: '67890' });
    await independent.release();
  } finally {
    child.kill();
    await exited;
  }
  const replacement = await acquireAccountLease(options);
  await replacement.release();
});

test('a legacy lock directory is preserved for ownership inspection', async t => {
  const { options, registryDir } = await fixture(t);
  const legacyGuard = path.join(registryDir, '12345.guard');
  await fs.mkdir(legacyGuard);
  await assert.rejects(acquireAccountLease(options), code('ACCOUNT_BUSY'));
  assert.ok((await fs.stat(legacyGuard)).isDirectory());
});

test('stale owner PID reuse permits recovery only when all recorded children are gone', async t => {
  const { options, processes, file } = await fixture(t);
  await acquireAccountLease(options);
  const old = JSON.parse(await fs.readFile(file, 'utf8'));
  old.owner.startTime = 'old-owner';
  old.processes = [{ pid: 77001, startTime: 'child-start', executablePath: process.execPath, commandPath: process.execPath, instanceId: old.instanceId, nonce: old.nonce, ownership: 'spawned' }];
  await fs.writeFile(file, JSON.stringify(old));
  processes.set(77001, { ...old.processes[0], parentPid: process.pid });
  await assert.rejects(acquireAccountLease(options), code('ACCOUNT_IN_USE'));
  processes.set(77001, { ...old.processes[0], startTime: 'reused-pid', parentPid: 1 });
  const fresh = await acquireAccountLease(options);
  assert.notEqual(fresh.nonce, old.nonce);
  await fresh.release();
});

test('malformed records and uncertain probes fail closed without replacing the claim', async t => {
  const { options, file } = await fixture(t);
  await fs.writeFile(file, '{broken');
  await assert.rejects(acquireAccountLease(options), code('OWNERSHIP_UNCERTAIN'));
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  await fs.unlink(file);
  await acquireAccountLease(options);
  const before = await fs.readFile(file, 'utf8');
  await assert.rejects(acquireAccountLease({ ...options, probeProcess: async () => undefined }), code('OWNERSHIP_UNCERTAIN'));
  assert.equal(await fs.readFile(file, 'utf8'), before);
});

test('an old lease cannot release or overwrite a successor nonce', async t => {
  const { options, file } = await fixture(t);
  const lease = await acquireAccountLease(options);
  const successor = JSON.parse(await fs.readFile(file, 'utf8'));
  successor.nonce = 'successor-nonce';
  await fs.writeFile(file, JSON.stringify(successor));
  await assert.rejects(lease.release(), code('LEASE_LOST'));
  await assert.rejects(lease.updateProcesses([]), code('LEASE_LOST'));
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).nonce, 'successor-nonce');
});

test('forged or persisted process records never authorize termination', async () => {
  const calls = [];
  const forged = { pid: process.pid, startTime: 'owner-start', executablePath: process.execPath, commandPath: process.execPath, instanceId: 'public', nonce: 'nonce', ownership: 'spawned' };
  await assert.rejects(stopOwnedProcesses([forged], { probeProcess: async () => forged, terminateProcess: async record => calls.push(record) }), code('PROCESS_NOT_OWNED'));
  assert.deepEqual(calls, []);
});

test('only a registered spawned child can be stopped; live children keep their account claim', async t => {
  const { options, processes, file } = await fixture(t);
  const lease = await acquireAccountLease(options);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  processes.set(child.pid, { pid: child.pid, startTime: 'child-start', executablePath: process.execPath, parentPid: process.pid });
  const owned = createProcessOwnership({ instanceId: 'public', nonce: lease.nonce, probeProcess: options.probeProcess });
  const record = await owned.registerSpawn(child, { commandPath: process.execPath });
  assert.ok(Object.isFrozen(record));
  await lease.updateProcesses([record]);
  await lease.updateProcesses([]);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).processes.length, 1, 'updates must not erase an active child');
  await assert.rejects(lease.release(), code('ACCOUNT_CHILDREN_ACTIVE'));
  await assert.rejects(stopOwnedProcesses([{ ...record }]), code('PROCESS_NOT_OWNED'));
  const exited = once(child, 'exit');
  await owned.stop();
  await exited;
  processes.delete(child.pid);
  await lease.release();
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
});

test('identity changes and uncertain ownership refuse stopping an otherwise owned child', async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  let snapshot = { pid: child.pid, startTime: 'first', executablePath: process.execPath, parentPid: process.pid };
  let calls = 0;
  const owned = createProcessOwnership({ instanceId: 'public', nonce: 'nonce', probeProcess: async () => snapshot, terminateProcess: async () => { calls++; } });
  await owned.registerSpawn(child, { commandPath: process.execPath });
  snapshot = { ...snapshot, startTime: 'reused' };
  await assert.rejects(owned.stop(), code('PROCESS_IDENTITY_CHANGED'));
  assert.equal(calls, 0);
  snapshot = undefined;
  await assert.rejects(owned.stop(), code('OWNERSHIP_UNCERTAIN'));
  assert.equal(calls, 0);
});

test('native process probe reports stable identity without exposing command arguments', async () => {
  const first = await probeProcess(process.pid);
  const second = await probeProcess(process.pid);
  assert.equal(first.pid, process.pid);
  assert.equal(first.startTime, second.startTime);
  assert.equal(path.resolve(first.executablePath).toLowerCase(), path.resolve(process.execPath).toLowerCase());
  assert.equal('commandLine' in first, false);
  await assert.rejects(probeProcess('1; Write-Output injected'), code('INVALID_OWNERSHIP'));
});

test('concurrent registration cannot grant two instances ownership of one child handle', async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const probe = async () => ({ pid: child.pid, startTime: 'child', executablePath: process.execPath, parentPid: process.pid });
  const publicOwner = createProcessOwnership({ instanceId: 'public', nonce: 'a', probeProcess: probe });
  const privateOwner = createProcessOwnership({ instanceId: 'private', nonce: 'b', probeProcess: probe });
  const results = await Promise.allSettled([publicOwner.registerSpawn(child, { commandPath: process.execPath }), privateOwner.registerSpawn(child, { commandPath: process.execPath })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'PROCESS_NOT_OWNED');
});

test('external parent identity and another instance nonce cannot enter an account lease', async t => {
  const { options, processes } = await fixture(t);
  const lease = await acquireAccountLease(options);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const foreign = createProcessOwnership({ instanceId: 'private', nonce: 'foreign', probeProcess: options.probeProcess });
  processes.set(child.pid, { pid: child.pid, startTime: 'child', executablePath: process.execPath, parentPid: 1 });
  await assert.rejects(foreign.registerSpawn(child, { commandPath: process.execPath }), code('PROCESS_NOT_OWNED'));
  processes.set(child.pid, { ...processes.get(child.pid), parentPid: process.pid });
  const record = await foreign.registerSpawn(child, { commandPath: process.execPath });
  await assert.rejects(lease.updateProcesses([record]), code('PROCESS_NOT_OWNED'));
  await lease.release();
});

test('native identity registration stops only the isolated child spawned by this test', async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const owned = createProcessOwnership({ instanceId: 'fixture', nonce: 'fixture-invocation' });
  const record = await owned.registerSpawn(child, { commandPath: process.execPath });
  assert.equal(record.pid, child.pid);
  await owned.stop();
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.equal(await probeProcess(child.pid), null);
});

test('stop waits for admitted registration probes and drains their child before resolving', async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  const owned = createProcessOwnership({ instanceId: 'fixture', nonce: 'stopping', probeProcess: async () => {
    await gate;
    return { pid: child.pid, startTime: 'child-start', executablePath: process.execPath, parentPid: process.pid };
  } });
  const registration = owned.registerSpawn(child, { commandPath: process.execPath });
  let stopped = false;
  const stopping = owned.stop().then(result => { stopped = true; return result; });
  const concurrentStop = owned.stop();
  await new Promise(resolve => setImmediate(resolve));
  const returnedBeforeRegistration = stopped;
  unblock();
  const record = await registration;
  const result = await stopping;
  await concurrentStop;
  assert.equal(returnedBeforeRegistration, false, 'shutdown cannot complete while its admitted child is being verified');
  assert.equal(record.pid, child.pid);
  assert.deepEqual(result.stopped, [child.pid]);
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'admitted child must have exited before shutdown completes');
});

test('stop closes registration admission immediately and keeps it closed after completion', async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  let probes = 0;
  const owned = createProcessOwnership({ instanceId: 'fixture', nonce: 'closed', probeProcess: async () => {
    probes++;
    return { pid: child.pid, startTime: 'child-start', executablePath: process.execPath, parentPid: process.pid };
  } });
  const stopping = owned.stop();
  await assert.rejects(owned.registerSpawn(child, { commandPath: process.execPath }), code('OWNERSHIP_CLOSED'));
  await stopping;
  await assert.rejects(owned.registerSpawn(child, { commandPath: process.execPath }), code('OWNERSHIP_CLOSED'));
  assert.equal(probes, 0, 'rejected new work must never enter identity verification');
});

test('a settled failed admission keeps later and repeated shutdown fail-closed', async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  let terminations = 0;
  const owned = createProcessOwnership({ instanceId: 'fixture', nonce: 'uncertain-admission',
    probeProcess: async () => { throw new Error('fixture identity unavailable'); },
    terminateProcess: async () => { terminations++; },
  });
  await assert.rejects(owned.registerSpawn(child, { commandPath: process.execPath }), code('OWNERSHIP_UNCERTAIN'));
  await assert.rejects(owned.stop(), code('OWNERSHIP_UNCERTAIN'));
  await assert.rejects(owned.stop(), code('OWNERSHIP_UNCERTAIN'));
  assert.equal(terminations, 0, 'an unverified process must not be killed to conceal the admission failure');
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
});
