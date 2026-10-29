// Shared profile ownership, authentication checks and cookie-safe browser handoff.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

export function leaseActive(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8'); let record;
    try { record = JSON.parse(raw); } catch { record = null; }
    const pid = Number(typeof record === 'object' ? record?.pid : record);
    // Existing numeric lock files remain compatible. A live PID never expires.
    if (pid > 0) return processAlive(pid);
    return Date.now() - fs.statSync(file).mtimeMs < 30 * 60000;
  } catch (error) { return error.code !== 'ENOENT'; }
}

export function acquireLease(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const nonce = crypto.randomUUID();
  // Nonblocking bakery arbitration. Every contender has its own PID/nonce path,
  // so a killed owner can be removed without ever unlinking a successor's guard.
  // A shared empty wx guard could otherwise strand the profile permanently.
  const directory = path.dirname(file), prefix = path.basename(file) + '.acquire.';
  const id = process.pid + '.' + nonce;
  const guard = path.join(directory, prefix + id + '.json');
  const entries = () => fs.readdirSync(directory).flatMap(name => {
    if (!name.startsWith(prefix)) return [];
    const match = /^(\d+)\.([a-f\d-]{36})\.json$/i.exec(name.slice(prefix.length));
    if (!match) return [];
    const target = path.join(directory, name), pid = Number(match[1]);
    if (!processAlive(pid)) { try { fs.unlinkSync(target); } catch {} return []; }
    let record;
    try { record = JSON.parse(fs.readFileSync(target, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; }
    return [{ id: match[1] + '.' + match[2], ticket: Number(record?.ticket) || 0, choosing: !record || record.choosing !== false }];
  });
  fs.writeFileSync(guard, JSON.stringify({ pid: process.pid, nonce, choosing: true }), { flag: 'wx', mode: 0o600 });
  try {
    const ticket = Math.max(0, ...entries().map(item => item.ticket)) + 1;
    fs.writeFileSync(guard, JSON.stringify({ pid: process.pid, nonce, choosing: false, ticket }));
    if (entries().some(item => item.id !== id && (item.choosing || item.ticket < ticket || item.ticket === ticket && item.id < id))) return null;
    // Compatibility with an earlier fixed guard. Only a known dead PID is
    // reclaimed. Unknown empty legacy markers are preserved and no longer act
    // as ownership records; the main lease and PID/nonce arbitration govern it.
    const legacy = file + '.acquire';
    try {
      let owner; try { owner = JSON.parse(fs.readFileSync(legacy, 'utf8')); } catch {}
      if (Number(owner?.pid) > 0) {
        if (processAlive(Number(owner.pid))) return null;
        fs.unlinkSync(legacy);
      } else if (Date.now() - fs.statSync(legacy).mtimeMs < 30000) return null;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (leaseActive(file)) return null;
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, nonce, at: Date.now() }), { flag: 'wx', mode: 0o600 });
    return () => {
      try { if (JSON.parse(fs.readFileSync(file, 'utf8')).nonce === nonce) fs.unlinkSync(file); } catch {}
    };
  } finally { try { fs.unlinkSync(guard); } catch {} }
}

export function classifySnapshot(snapshot, requestedUrl) {
  const text = String(snapshot?.text || ''); const url = String(snapshot?.url || '');
  if (snapshot?.password || snapshot?.signInPrompt || /\/cas\/(?:login|auth)|\/(?:login|signin|sign-in)(?:[/?#.]|$)/i.test(url) ||
      /需要先验证身份|统一身份认证登录|请输入用户名|账号登录|请登录|^\s*Sign in\s*$/im.test(text)) return 'login';
  if (!text.trim() || /无法访问此页面|ERR_CONNECTION_|This site can'?t be reached|net::ERR_/i.test(text)) return 'unavailable';
  try { if (new URL(url).host !== new URL(requestedUrl).host) return 'unavailable'; } catch { return 'unavailable'; }
  return 'ready';
}

export function selectLoginTargets(request, fallback = []) {
  const sanitize = items => (Array.isArray(items) ? items : []).filter(item => {
    try { return ['https:', 'http:'].includes(new URL(item?.url).protocol); } catch { return false; }
  }).map(item => ({ name: String(item.name || '监控网页').slice(0, 60), url: item.url }));
  const targets = sanitize(request?.targets); return targets.length ? targets : sanitize(fallback);
}

export function saveCookies(jar, cookies) {
  fs.mkdirSync(path.dirname(jar), { recursive: true });
  const temp = jar + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(cookies, null, 2), { mode: 0o600 });
  fs.renameSync(temp, jar);
}

export async function restoreCookies(browser, jar) {
  let cookies; try { cookies = JSON.parse(fs.readFileSync(jar, 'utf8')); } catch { return; }
  if (!Array.isArray(cookies)) return;
  const accepted = cookies.filter(c => c && typeof c.name === 'string' && typeof c.value === 'string' && c.domain &&
    (!(c.expires > 0) || c.expires * 1000 > Date.now())).map(c => {
    const result = { name: c.name, value: c.value, domain: c.domain, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly };
    if (c.expires > 0) result.expires = c.expires;
    if (['Strict', 'Lax', 'None'].includes(c.sameSite)) result.sameSite = c.sameSite;
    if (c.partitionKey) result.partitionKey = c.partitionKey;
    return result;
  });
  if (accepted.length) await browser.defaultBrowserContext().setCookie(...accepted);
}

export async function ensureSessionBrowser({ connect, launch, restore }) {
  const existing = await connect();
  if (existing) return { browser: existing, started: false };
  const browser = await launch();
  await restore?.(browser);
  return { browser, started: true };
}

export async function handoffToHeadless({ browser, owned, jar, waitStopped, launch, verify }) {
  // Export all cookies, including session cookies, independently of any one app.
  saveCookies(jar, await browser.defaultBrowserContext().cookies());
  if (!owned) return { browser, transitioned: false, reason: 'existing_visible_browser' };
  await browser.close();
  await waitStopped(); // same profile must be unlocked before the next launch
  const background = await launch();
  await restoreCookies(background, jar);
  if (verify && !(await verify(background))) {
    await background.disconnect?.();
    throw new Error('无头交接后登录验证未通过；保留登录态，等待下轮低频检查');
  }
  return { browser: background, transitioned: true };
}
