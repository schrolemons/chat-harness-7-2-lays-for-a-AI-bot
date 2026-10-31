import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { acquireLease, leaseActive, classifySnapshot, ensureSessionBrowser, handoffToHeadless, restoreCookies, selectLoginTargets } from './campus-browser-session.mjs';

function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-session-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }

test('live worker keeps its exclusive lease beyond the old 120 second expiry', t => {
  const file = path.join(temporary(t), 'worker.lock');
  const release = acquireLease(file);
  fs.utimesSync(file, new Date(0), new Date(0));
  assert.equal(leaseActive(file), true);
  assert.equal(acquireLease(file), null);
  release();
  assert.equal(leaseActive(file), false);
});

test('release cannot remove a replacement lease owned by another worker', t => {
  const file = path.join(temporary(t), 'worker.lock'); const release = acquireLease(file);
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, nonce: 'replacement' }));
  release(); assert.equal(leaseActive(file), true);
});

test('CAS redirects retain authentication failure even when body is empty or on a different host', () => {
  assert.equal(classifySnapshot({ url: 'https://identity.example/cas/login', text: '' }, 'https://course.example/private'), 'login');
  assert.equal(classifySnapshot({ url: 'https://course.example/private', text: '课程资源', password: true }, 'https://course.example/private'), 'login');
  assert.equal(classifySnapshot({ url: 'https://course.example/private', text: '课程资源' }, 'https://course.example/private'), 'ready');
  assert.equal(classifySnapshot({ url: 'https://other.example/', text: 'other' }, 'https://course.example/private'), 'unavailable');
});

test('generic failed watch URL is the login target without requiring Blackboard or the report application', () => {
  assert.deepEqual(selectLoginTargets({ targets: [{ name: '站点', url: 'https://example.org/private' }] }, []), [{ name: '站点', url: 'https://example.org/private' }]);
  assert.deepEqual(selectLoginTargets({ targets: [{ url: 'file:///private' }] }, [{ name: 'fallback', url: 'https://safe.example/' }]), [{ name: 'fallback', url: 'https://safe.example/' }]);
});

test('connecting to a live browser never replays the old cookie snapshot', async () => {
  let restored = 0, launched = 0; const live = {};
  const result = await ensureSessionBrowser({ connect: async () => live, launch: async () => { launched++; }, restore: async () => { restored++; } });
  assert.equal(result.browser, live); assert.equal(result.started, false); assert.equal(restored, 0); assert.equal(launched, 0);
});

test('new browser restores session cookies before being returned to a fetch caller', async () => {
  const events = []; const browser = {};
  const result = await ensureSessionBrowser({ connect: async () => null, launch: async () => { events.push('launch'); return browser; }, restore: async () => { events.push('restore'); } });
  events.push('fetch'); assert.equal(result.started, true); assert.deepEqual(events, ['launch', 'restore', 'fetch']);
});

test('headed to headless handoff saves and restores session cookies before verification', async t => {
  const events = [], jar = path.join(temporary(t), 'cookies.json');
  const cookies = [{ name: 'session', value: 'synthetic-only', domain: 'example.org', path: '/', expires: -1, session: true }];
  const headed = { defaultBrowserContext: () => ({ cookies: async () => cookies }), close: async () => events.push('close') };
  const background = { defaultBrowserContext: () => ({ setCookie: async (...items) => { assert.equal(items[0].value, 'synthetic-only'); assert.equal('session' in items[0], false); events.push('restore'); } }), close: async () => {} };
  const result = await handoffToHeadless({ browser: headed, owned: true, jar, waitStopped: async () => events.push('stopped'), launch: async () => { events.push('launch'); return background; }, verify: async () => { events.push('verify'); return true; } });
  assert.equal(result.browser, background); assert.deepEqual(events, ['close', 'stopped', 'launch', 'restore', 'verify']);
  assert.equal(JSON.parse(fs.readFileSync(jar))[0].session, true);
});

test('existing visible browser is preserved and handoff reports that it needs an explicit transition', async t => {
  let closed = false; const browser = { defaultBrowserContext: () => ({ cookies: async () => [] }), close: async () => { closed = true; } };
  const result = await handoffToHeadless({ browser, owned: false, jar: path.join(temporary(t), 'cookies.json') });
  assert.equal(result.transitioned, false); assert.equal(result.reason, 'existing_visible_browser'); assert.equal(closed, false);
});

test('invalid or expired persisted cookies are not silently injected', async t => {
  const jar = path.join(temporary(t), 'cookies.json'); fs.writeFileSync(jar, JSON.stringify([{ name: 'expired', value: 'x', domain: 'example.org', expires: 1 }, { name: 'session', value: 'x', domain: 'example.org', expires: -1 }]));
  let restored; await restoreCookies({ defaultBrowserContext: () => ({ setCookie: async (...items) => { restored = items; } }) }, jar);
  assert.deepEqual(restored.map(x => x.name), ['session']);
});

test('a killed guard owner is reclaimed without touching any live owner', async t => {
  const root = temporary(t), file = path.join(root, 'worker.lock');
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise(resolve => child.stdout.once('data', resolve));
  const deadPid = child.pid;
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited;
  fs.writeFileSync(file + '.acquire', JSON.stringify({ pid: deadPid, nonce: 'dead-owner' }));
  const release = acquireLease(file);
  assert.equal(typeof release, 'function'); assert.equal(leaseActive(file), true);
  assert.equal(fs.existsSync(file + '.acquire'), false);
  release();
  fs.writeFileSync(file + '.acquire', JSON.stringify({ pid: process.pid, nonce: 'live-owner' }));
  assert.equal(acquireLease(file), null); assert.equal(fs.existsSync(file + '.acquire'), true);
});

test('empty orphan from the old guard format cannot permanently block an otherwise free worker', t => {
  const file = path.join(temporary(t), 'worker.lock'); fs.writeFileSync(file + '.acquire', '');
  fs.utimesSync(file + '.acquire', new Date(0), new Date(0));
  const release = acquireLease(file); assert.equal(typeof release, 'function'); release();
});

test('a process killed while publishing its PID/nonce guard cannot strand future acquisition', async t => {
  const root = temporary(t), file = path.join(root, 'worker.lock');
  const source = `import fs from 'node:fs'; import {acquireLease} from ${JSON.stringify(new URL('./campus-browser-session.mjs', import.meta.url).href)};
    const write=fs.writeFileSync; fs.writeFileSync=(file,...args)=>{const result=write(file,...args);if(String(file).includes('.acquire.')&&JSON.parse(args[0]).choosing===true){fs.writeSync(1,'guard\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return result;};acquireLease(${JSON.stringify(file)});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  await new Promise(resolve => child.stdout.once('data', resolve));
  assert.ok(fs.readdirSync(root).some(name => name.startsWith('worker.lock.acquire.')));
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited;
  const release = acquireLease(file); assert.equal(typeof release, 'function'); release();
  assert.deepEqual(fs.readdirSync(root), []);
});

test('simultaneous processes recovering one abandoned lease have only one successful owner', { timeout: 45000 }, async t => {
  const root = temporary(t), file = path.join(root, 'worker.lock'), start = path.join(root, 'start');
  fs.writeFileSync(file, '99999999');
  const source = `import fs from 'node:fs';import {acquireLease,leaseActive} from ${JSON.stringify(new URL('./campus-browser-session.mjs', import.meta.url).href)};
    process.stdout.write('ready\\n'); const poll=setInterval(()=>{if(!fs.existsSync(${JSON.stringify(start)}))return;clearInterval(poll);let attempts=0;const attempt=()=>{const release=acquireLease(${JSON.stringify(file)});if(release){process.stdout.write('acquired\\n');setTimeout(()=>{release();process.exit(0)},1800);}else if(leaseActive(${JSON.stringify(file)})||++attempts>100){process.stdout.write('blocked\\n');process.exit(0);}else setTimeout(attempt,5);};attempt();},5);`;
  const children = Array.from({ length: 3 }, () => spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] }));
  t.after(() => children.forEach(child => child.kill()));
  const outputs = children.map(() => '');
  await Promise.all(children.map((child, index) => new Promise((resolve, reject) => {
    child.stdout.on('data', data => { outputs[index] += data; if (outputs[index].includes('ready')) resolve(); });
    child.once('error', reject); child.once('exit', code => { if (!outputs[index].includes('ready')) reject(Error('worker exited before ready: ' + code)); });
  })));
  const exits = children.map(child => new Promise(resolve => child.once('exit', resolve)));
  fs.writeFileSync(start, 'go'); await Promise.all(exits);
  assert.equal(outputs.filter(output => output.includes('acquired')).length, 1);
  assert.equal(leaseActive(file), false);
});
