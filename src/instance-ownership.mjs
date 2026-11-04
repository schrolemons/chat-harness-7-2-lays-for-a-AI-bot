import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChildProcess, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const execFileAsync = promisify(execFile);
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
// In-memory capabilities deliberately cannot be restored from a JSON/PID file.
const ownedRecords = new WeakMap();
const registeredChildren = new WeakSet();
const fail = (code, message) => Object.assign(new Error(message), { code });
const text = value => typeof value === 'string' && value.trim().length > 0;
const validPid = value => Number.isSafeInteger(value) && value > 0;
const absolute = value => text(value) && path.isAbsolute(value);
const samePath = (left, right) => {
  const normalize = value => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value);
  return absolute(left) && absolute(right) && normalize(left) === normalize(right);
};
function identity(value) {
  return value && validPid(value.pid) && text(value.startTime);
}
function processRecord(value, instanceId, nonce) {
  return identity(value) && absolute(value.executablePath) && absolute(value.commandPath)
    && value.instanceId === instanceId && value.nonce === nonce && value.ownership === 'spawned';
}
function normalizeUin(value) {
  if (typeof value !== 'string' && !(Number.isSafeInteger(value) && value > 0)) throw fail('INVALID_OWNERSHIP', 'A numeric QQ account is required');
  const result = String(value).trim().replace(/^0+/, '');
  if (!/^[1-9][0-9]{0,19}$/.test(result)) throw fail('INVALID_OWNERSHIP', 'Invalid QQ account');
  return result;
}
async function observed(probe, pid, { requireExecutable = true } = {}) {
  let value;
  try { value = await probe(pid); } catch { throw fail('OWNERSHIP_UNCERTAIN', 'Cannot verify process identity'); }
  if (value === null) return null;
  if (!identity(value) || value.pid !== pid || (requireExecutable && !absolute(value.executablePath))) throw fail('OWNERSHIP_UNCERTAIN', 'Incomplete process identity');
  return value;
}

async function probeWindowsProcesses(pids) {
  if (!pids.length || pids.some(pid => !validPid(pid))) throw fail('INVALID_OWNERSHIP', 'Invalid process ID');
  const filter = pids.map(pid => 'ProcessId = ' + pid).join(' OR ');
  const script = `$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { @{pid=[int]$_.ProcessId; startTime=if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}; executablePath=$_.ExecutablePath; parentPid=[int]$_.ParentProcessId} }); ConvertTo-Json -InputObject $rows -Compress`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024 });
  const rows = JSON.parse(stdout.trim());
  if (!Array.isArray(rows) || rows.some(row => !pids.includes(row?.pid)) || new Set(rows.map(row => row.pid)).size !== rows.length) throw Error('Invalid probe');
  return rows;
}

/** Probe one exact PID only. null means confirmed absent; uncertainty throws.
 * No command arguments, environment, or credentials are collected or returned.
 */
export async function probeProcess(pid) {
  if (!validPid(pid)) throw fail('INVALID_OWNERSHIP', 'Invalid process ID');
  if (process.platform === 'win32') {
    try {
      const [result = null] = await probeWindowsProcesses([pid]);
      if (result !== null && (!identity(result) || result.pid !== pid || !absolute(result.executablePath))) throw new Error('Invalid probe');
      return result;
    } catch { throw fail('OWNERSHIP_UNCERTAIN', 'Windows process identity could not be verified'); }
  }
  if (process.platform === 'linux') {
    try {
      const first = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      const executablePath = await fs.readlink(`/proc/${pid}/exe`);
      const boot = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
      const second = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = value => value.slice(value.lastIndexOf(')') + 2).split(' ');
      const a = fields(first), b = fields(second);
      if (a[19] !== b[19]) throw new Error('Process changed during observation');
      return { pid, startTime: `${boot}:${b[19]}`, executablePath, parentPid: Number(b[1]) };
    } catch (error) {
      if (error.code === 'ENOENT') {
        try { await fs.stat(`/proc/${pid}`); } catch (missing) { if (missing.code === 'ENOENT') return null; }
      }
      throw fail('OWNERSHIP_UNCERTAIN', 'Linux process identity could not be verified');
    }
  }
  throw fail('OWNERSHIP_UNCERTAIN', 'Supply a process identity probe for this platform');
}

async function readClaim(file, botUin) {
  let raw;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw fail('OWNERSHIP_UNCERTAIN', 'Invalid account claim file');
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw fail('OWNERSHIP_UNCERTAIN', 'Account claim cannot be read');
  }
  let claim;
  try { claim = JSON.parse(raw); } catch { throw fail('OWNERSHIP_UNCERTAIN', 'Malformed account claim'); }
  if (!claim || claim.version !== 1 || claim.botUin !== botUin || !text(claim.instanceId) || !text(claim.nonce)
    || !identity(claim.owner) || !Array.isArray(claim.processes)
    || !claim.processes.every(record => processRecord(record, claim.instanceId, claim.nonce))) {
    throw fail('OWNERSHIP_UNCERTAIN', 'Invalid account ownership record');
  }
  return claim;
}

async function writeClaim(file, claim) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(claim)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Atomic per-account lease. SQLite holds the cross-process lock only while
 * changing the claim. The OS releases it on exit, including a forced exit.
 * updateProcesses is additive, retaining evidence of every spawned child.
 */
export async function acquireAccountLease({ registryDir, botUin, instanceId, owner, probeProcess: probe = probeProcess }) {
  botUin = normalizeUin(botUin);
  if (!absolute(registryDir) || !text(instanceId) || !identity(owner) || typeof probe !== 'function') throw fail('INVALID_OWNERSHIP', 'Invalid account lease parameters');
  const requestedOwner = { pid: owner.pid, startTime: owner.startTime };
  const currentOwner = await observed(probe, requestedOwner.pid);
  if (!currentOwner || currentOwner.startTime !== requestedOwner.startTime) throw fail('OWNERSHIP_UNCERTAIN', 'Lease owner is not alive with the supplied identity');
  await fs.mkdir(registryDir, { recursive: true, mode: 0o700 });
  const directory = await fs.lstat(registryDir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw fail('OWNERSHIP_UNCERTAIN', 'Registry must be a real directory');
  const file = path.join(registryDir, `${botUin}.json`);
  const guard = path.join(registryDir, `${botUin}.guard`);
  const guarded = async operation => {
    const stat = await fs.lstat(guard).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    // Use the same path as the legacy directory so older runtimes cannot
    // acquire a second lock. Leave any existing legacy directory for inspection.
    if (stat?.isDirectory()) throw fail('ACCOUNT_BUSY', 'Legacy account lock requires ownership inspection');
    if (stat && (!stat.isFile() || stat.nlink !== 1)) throw fail('OWNERSHIP_UNCERTAIN', 'Invalid account lock file');
    let database;
    try {
      database = new DatabaseSync(guard);
      database.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
    } catch (error) {
      database?.close();
      const result = error.errcode & 0xff;
      if (result === SQLITE_BUSY || result === SQLITE_LOCKED) throw fail('ACCOUNT_BUSY', 'Account ownership is being changed');
      throw fail('OWNERSHIP_UNCERTAIN', 'Account lock cannot be acquired');
    }
    try { return await operation(); } finally { database.close(); }
  };
  const firstActive = async records => {
    for (let offset = 0; offset < records.length; offset += 64) {
      const batch = records.slice(offset, offset + 64);
      let inspect = probe;
      if (probe === probeProcess && process.platform === 'win32') {
        let rows;
        try { rows = await probeWindowsProcesses([...new Set(batch.map(record => record.pid))]); }
        catch { throw fail('OWNERSHIP_UNCERTAIN', 'Cannot verify process identity'); }
        const byPid = new Map(rows.map(row => [row.pid, row]));
        inspect = pid => byPid.get(pid) ?? null;
      }
      for (const record of batch) {
        const live = await observed(inspect, record.pid, { requireExecutable: false });
        if (!live || live.startTime !== record.startTime) continue;
        // A reused PID is unrelated. For a matching process, missing or
        // unexpected executable identity still prevents taking over the lease.
        if (!absolute(live.executablePath) || (record.executablePath && !samePath(record.executablePath, live.executablePath))) {
          throw fail('OWNERSHIP_UNCERTAIN', 'Process executable identity is unavailable or changed');
        }
        return record;
      }
    }
    return null;
  };
  const nonce = randomUUID();
  await guarded(async () => {
    const previous = await readClaim(file, botUin);
    if (previous) {
      const live = await firstActive([previous.owner, ...previous.processes]);
      if (live) throw fail('ACCOUNT_IN_USE', live === previous.owner
        ? 'This QQ account already has an active owner'
        : 'A previous instance still owns a running process for this QQ account');
    }
    await writeClaim(file, { version: 1, botUin, instanceId, nonce, owner: requestedOwner, processes: [] });
  });
  let released = false;
  const matching = async () => {
    const claim = await readClaim(file, botUin);
    if (!claim || claim.nonce !== nonce || claim.instanceId !== instanceId) throw fail('LEASE_LOST', 'The account lease is no longer owned by this invocation');
    return claim;
  };
  return Object.freeze({
    nonce,
    async updateProcesses(records) {
      if (released) throw fail('LEASE_LOST', 'Account lease was released');
      if (!Array.isArray(records) || records.some(record => !ownedRecords.has(record) || !processRecord(record, instanceId, nonce))) throw fail('PROCESS_NOT_OWNED', 'Only this invocation\'s spawned process records can update a lease');
      await guarded(async () => {
        const claim = await matching();
        const all = new Map(claim.processes.map(record => [`${record.pid}:${record.startTime}`, record]));
        for (const record of records) all.set(`${record.pid}:${record.startTime}`, record);
        await writeClaim(file, { ...claim, processes: [...all.values()] });
      });
    },
    async release() {
      if (released) return;
      await guarded(async () => {
        const claim = await matching();
        if (await firstActive(claim.processes)) throw fail('ACCOUNT_CHILDREN_ACTIVE', 'Stop owned children before releasing their QQ account');
        await fs.unlink(file);
        released = true;
      });
    }
  });
}

/** Register actual child handles from this invocation, never discovered PIDs.
 * Call immediately after spawn. commandPath is the absolute executable or entry
 * script present in spawnargs; executable identity is verified separately.
 * stop closes admission synchronously, then drains registrations admitted before
 * that boundary. Failed identity checks keep shutdown fail-closed.
 */
export function createProcessOwnership({ instanceId, nonce, probeProcess: probe = probeProcess, terminateProcess } = {}) {
  if (!text(instanceId) || !text(nonce)) throw fail('INVALID_OWNERSHIP', 'Instance ID and invocation nonce are required');
  const records = [];
  const registrations = new Set();
  let uncertainAdmission = false;
  let closed = false;
  let registrationDrain;
  let stopping;
  return Object.freeze({
    async registerSpawn(child, { commandPath } = {}) {
      if (closed) throw fail('OWNERSHIP_CLOSED', 'Process ownership is stopping; new registrations are refused');
      if (!(child instanceof ChildProcess) || !validPid(child.pid) || !child._handle || registeredChildren.has(child)
        || child.exitCode !== null || child.signalCode !== null || !absolute(child.spawnfile) || !absolute(commandPath)
        || !child.spawnargs.some(argument => samePath(argument, commandPath))) throw fail('PROCESS_NOT_OWNED', 'Expected a new live child handle and its exact executable or script path');
      registeredChildren.add(child);
      const registration = (async () => {
        try {
          const live = await observed(probe, child.pid);
          if (!live || live.parentPid !== process.pid || !samePath(live.executablePath, child.spawnfile)
            || child.exitCode !== null || child.signalCode !== null) throw fail('PROCESS_NOT_OWNED', 'Spawned process does not belong to this invocation');
          const record = Object.freeze({ pid: live.pid, startTime: live.startTime, executablePath: live.executablePath, commandPath, instanceId, nonce, ownership: 'spawned' });
          ownedRecords.set(record, { child, probe, terminateProcess });
          records.push(record);
          return record;
        } catch (error) {
          // Remember settled failures too: the child was already spawned, but
          // there is no verified record that shutdown can safely terminate.
          uncertainAdmission = true;
          registeredChildren.delete(child);
          throw error;
        }
      })();
      registrations.add(registration);
      try { return await registration; } finally { registrations.delete(registration); }
    },
    stop() {
      closed = true;
      registrationDrain ??= Promise.allSettled([...registrations]);
      stopping ??= (async () => {
        const outcomes = await registrationDrain;
        const result = await stopOwnedProcesses(records, { probeProcess: probe, terminateProcess });
        if (uncertainAdmission || outcomes.some(outcome => outcome.status === 'rejected')) {
          throw fail('OWNERSHIP_UNCERTAIN', 'An admitted child could not be verified; shutdown cannot be declared complete');
        }
        return result;
      })().finally(() => { stopping = undefined; });
      return stopping;
    }
  });
}

/** Stop opaque records minted locally, validating the entire batch first.
 * A caller-supplied terminateProcess(record) must terminate that exact identity
 * and await exit; it must never discover targets or perform process-tree kills.
 */
export async function stopOwnedProcesses(records, options = {}) {
  if (!Array.isArray(records) || records.some(record => !ownedRecords.has(record))) throw fail('PROCESS_NOT_OWNED', 'Persisted or external process records cannot authorize stopping');
  const pending = [];
  for (const record of records) {
    const capability = ownedRecords.get(record);
    if (capability.child.exitCode !== null || capability.child.signalCode !== null) continue;
    const probe = options.probeProcess ?? capability.probe;
    const live = await observed(probe, record.pid);
    if (live === null) continue;
    if (live.startTime !== record.startTime || !samePath(live.executablePath, record.executablePath)) throw fail('PROCESS_IDENTITY_CHANGED', 'Refusing to stop a process whose identity changed');
    pending.push({ record, capability, probe });
  }
  for (const { record, capability, probe } of pending.reverse()) {
    const live = await observed(probe, record.pid);
    if (live === null) continue;
    if (live.startTime !== record.startTime || !samePath(live.executablePath, record.executablePath)) throw fail('PROCESS_IDENTITY_CHANGED', 'Process identity changed immediately before stop');
    const terminate = options.terminateProcess ?? capability.terminateProcess;
    if (terminate) await terminate(record);
    else await new Promise((resolve, reject) => {
      const child = capability.child;
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const done = error => { clearTimeout(timer); child.off('exit', onExit); child.off('error', onError); error ? reject(error) : resolve(); };
      const onExit = () => done();
      const onError = () => done(fail('PROCESS_STOP_FAILED', 'Owned child could not be stopped'));
      const timer = setTimeout(() => done(fail('PROCESS_STOP_FAILED', 'Owned child did not exit; account lease must remain held')), 10000);
      child.once('exit', onExit);
      child.once('error', onError);
      if (!child.kill()) done(fail('PROCESS_STOP_FAILED', 'Owned child refused the termination signal'));
    });
  }
  return { stopped: pending.map(({ record }) => record.pid) };
}
