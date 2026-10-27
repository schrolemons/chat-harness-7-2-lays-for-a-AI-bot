#!/usr/bin/env node
// 一键启动「DeepSeek大肥鱼」QQ 桥接。
//
// 为什么需要它：DSH 的 Web 端口每次启动都是随机的（例如 53973 / 60379），
// 而桥接是拿 config.json 里的 dsh.baseUrl 去连 DSH 的。DSH 一重启、端口一变，
// 桥接就连不上正在跑的 DSH —— 表现就是「QQ 里发消息没人回」，日志里刷
// 「DSH 事件流已结束（本次收到 0 帧）」。
//
// 本脚本做的事（只做这些，不做别的）：
//   1. 自动探测当前真正在跑的 DSH（用签名 Cookie 离线换会话 + 用已知会话 ID 校验），
//      把最新的地址写回 config.json（先备份）。
//   2. 检查 SnowLuma 是否在线；不在线就按 config 里的 launcherPath 拉起来。
//   3. 清掉「进程已经不存在」的僵尸 bridge.lock（不会动还活着的实例）。
//   4. 启动 src/bridge.js，并在控制台等它连上 DSH + SnowLuma，给出 ✅/❌ 结论。
//   5. 前景守护：桥接退出就 5 秒后重拉（连续崩溃多次则停下来报错，避免无限刷）。
//
// 用法：
//   node scripts/start-da-feiyu.mjs            一键启动 + 守护
//   node scripts/start-da-feiyu.mjs --check    只体检（探测 DSH / SnowLuma / 锁），不启动
//   node scripts/start-da-feiyu.mjs --once     启动但退出时不自动重拉
//   node scripts/start-da-feiyu.mjs --force    有实例在跑也强行换新的（会按锁文件 PID 结束它）
//   node scripts/start-da-feiyu.mjs --launch-dsh  没探测到 DSH 时顺手拉起 DeepSeek Harness
//
// 安全边界：不删任何文件（除了确认已死进程的锁文件）、不碰 state/ 之外的目录、
// 改 config.json 前一定先备份、结束进程前确认它是 node.exe。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { NodeApiClient, unwrap } from '../src/dsh-client.js';
import { readBridgeHealth, classifyBridge, resolveConsoleToken } from '../plugins/qq-components/obs-bridge-health/health.mjs';
import { discoverSnowLumaConnection } from '../src/snowluma-conn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = path.join(ROOT, 'state');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const LOCK_FILE = path.join(STATE_DIR, 'bridge.lock');
const START_LOG = path.join(STATE_DIR, 'start-da-feiyu.log');
const BRIDGE_LOG = path.join(STATE_DIR, 'bridge.log');
const ENDPOINT_CACHE = path.join(STATE_DIR, 'dsh-endpoints.json');

const NODE_BIN = process.execPath;
const DSH_HINT_LAUNCHER = process.env.DSH_LAUNCHER || path.join(os.homedir(), 'Desktop', 'DeepSeek Harness.lnk');

// ── 命令行参数 ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = {
  check: argv.includes('--check'),
  once: argv.includes('--once') || argv.includes('--no-watch'),
  force: argv.includes('--force'),
  // 外部调用方（编辑器里的 agent、自动化脚本）可能反复用 --force 拉起守护脚本，
  // 导致桥接每几分钟被重置一次（会话反复被切断、开机问候反复触发）。
  // 只有显式加 --force-now 才允许在冷却期内强杀健康实例。
  forceNow: argv.includes('--force-now'),
  launchDsh: argv.includes('--launch-dsh'),
  port: (() => {
    const i = argv.indexOf('--port');
    return i >= 0 ? Number(argv[i + 1]) || 0 : 0;
  })()
};

// --force 冷却：桥接健康且启动不足这么久时，忽略 --force（默认 10 分钟）。
// 想立刻重启就加 --force-now；设 0 可关闭该保护。
const FORCE_COOLDOWN_MS = Math.max(0, Number(process.env.FEIYU_FORCE_COOLDOWN_MS ?? 1800000) || 0);

// ── 输出 ─────────────────────────────────────────────────────────────────
const t0 = Date.now();
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function log(msg) {
  const line = `[${stamp()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(START_LOG, line + '\n');
  } catch {}
}
function fail(msg) {
  log(`❌ ${msg}`);
  return false;
}

// ── 小工具 ───────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

/** 终端里问一句 Y/N；不是交互终端就当作「否」。 */
async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

let configBackupMade = false;
/** 只改 dsh.baseUrl 这一个字段，其余字节原样保留；改前备份一次。 */
function writeConfigBaseUrl(baseUrl) {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  const next = raw.replace(/("baseUrl"\s*:\s*)"[^"]*"/, `$1"${baseUrl}"`);
  if (next === raw) return false;
  if (!configBackupMade) {
    const bak = `${CONFIG_FILE}.bak-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    fs.copyFileSync(CONFIG_FILE, bak);
    log(`config.json 已备份：${path.basename(bak)}`);
    configBackupMade = true;
  }
  fs.writeFileSync(CONFIG_FILE, next);
  return true;
}

function readConsoleToken() {
  try{return resolveConsoleToken(ROOT,loadConfig());}catch{return '';}
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function imageNameOf(pid) {
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000
    });
    const m = out.match(/^"([^"]+)"/m);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function parseNetstatPorts(out) {
  // 不用「状态列 == LISTENING」判断，因为中文/英文系统的 netstat 状态列不一样；
  // 改成「远端端口为 0」＝监听（与语言无关）。
  const ports = new Set();
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+(\S+):(\d+)\s+(\S+)/);
    if (!m) continue;
    const [, addr, localPort, remoteAddr, remotePort] = m;
    if (Number(remotePort) !== 0) continue; // 不是监听
    const local = /(127\.0\.0\.1|\[::1\]|\[::\]|0\.0\.0\.0)/.test(addr);
    const anyRemote = /(127\.0\.0\.1|\[::1\]|\[::\]|0\.0\.0\.0)/.test(remoteAddr);
    if (!local && !anyRemote) continue;
    const port = Number(localPort);
    if (!port || port < 1024 || port > 65535) continue;
    if ([3000, 3001, 3100, 9222, 9227].includes(port)) continue;
    ports.add(port);
  }
  return [...ports];
}

function localListeningPorts() {
  let out = '';
  for (const args of [['-ano'], ['-an']]) {
    try {
      out = execFileSync('netstat', args, { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      break;
    } catch {}
  }
  if (!out) {
    log('（提示：无法枚举本机监听端口，只试 config.json / 最近成功过的地址；一般不影响启动）');
    return [];
  }
  return parseNetstatPorts(out);
}

function loadEndpointCache() {
  try {
    const doc = JSON.parse(fs.readFileSync(ENDPOINT_CACHE, 'utf8'));
    return Array.isArray(doc?.endpoints) ? doc.endpoints.filter((u) => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

function rememberEndpoint(baseUrl) {
  if (!baseUrl) return;
  const list = [baseUrl, ...loadEndpointCache().filter((u) => u !== baseUrl)].slice(0, 8);
  try {
    fs.writeFileSync(ENDPOINT_CACHE, JSON.stringify({ endpoints: list, updatedAt: new Date().toISOString() }, null, 2));
  } catch {}
}

function tailOf(file, lines = 12) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

// ── DSH 探测 ─────────────────────────────────────────────────────────────
/**
 * 判断某个地址是不是「我们要的那个 DSH」。
 *  - 先看它是否持有我们 state/sessions.json 里的会话（session/projections）→ 最可靠；
 *  - 再看它是否至少是个能通过鉴权的 DSH（agentPresets.list）。
 */
async function probeDsh(baseUrl, sessionIds) {
  const result = { baseUrl, score: 0, title: '', error: '', presets: 0, sessions: 0 };
  const api = new NodeApiClient(baseUrl, 3000, {});
  const withTimeout = async (fn, ms) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    try {
      return await fn(ac.signal);
    } finally {
      clearTimeout(timer);
    }
  };
  for (const sid of sessionIds.slice(0, 4)) {
    try {
      const r = await withTimeout((signal) => api.callUnary('session/projections', { sessionId: sid }, signal), 3500);
      const v = unwrap(r);
      result.sessions += 1;
      result.score = Math.max(result.score, 2);
      if (!result.title && v && typeof v === 'object' && typeof v.values?.title === 'string') {
        result.title = v.values.title.replace(/\s+/g, ' ').slice(0, 40);
      }
      if (result.sessions >= 2) break;
    } catch (error) {
      if (!result.error) result.error = error?.message ?? String(error);
    }
  }
  if (result.score === 0) {
    try {
      const r = await withTimeout((signal) => api.callUnary('agentPresets.list', {}, signal), 3000);
      const list = unwrap(r);
      result.presets = Array.isArray(list) ? list.length : Array.isArray(list?.items) ? list.items.length : 1;
      result.score = 1;
      result.error = '';
    } catch (error) {
      if (!result.error) result.error = error?.message ?? String(error);
    }
  }
  return result;
}

async function discoverDsh(cfg) {
  const configured = String(cfg?.dsh?.baseUrl || '').trim();
  const sessionIds = (() => {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'sessions.json'), 'utf8'));
      return [...new Set(Object.values(doc?.sessions || {}))].filter((s) => typeof s === 'string');
    } catch {
      return [];
    }
  })();

  // 快速通道：显式指定或配置里的地址仍然可用时直接用它，跳过「扫本机全部监听端口」。
  // 桥接被外部反复重启时（实测 47 个候选、整轮约 40 秒），每次恢复都白等这么久。
  const quickUrl = String(opt.port ? `http://127.0.0.1:${opt.port}` : (process.env.DSH_URL || configured || ''))
    .trim().replace(/\/+$/, '');
  if (quickUrl) {
    const quick = await probeDsh(quickUrl, sessionIds);
    if (quick && quick.score > 0) {
      log(`探测 DSH：${quickUrl} 直接可用（跳过端口扫描）`);
      rememberEndpoint(quickUrl);
      return quick;
    }
    log(`探测 DSH：${quickUrl} 不可用，回退到全量探测`);
  }

  const candidates = [];
  const push = (portOrUrl) => {
    let url;
    if (typeof portOrUrl === 'string' && portOrUrl.startsWith('http')) url = portOrUrl.replace(/\/+$/, '');
    else url = `http://127.0.0.1:${portOrUrl}`;
    if (!candidates.includes(url)) candidates.push(url);
  };
  if (opt.port) push(opt.port);
  if (process.env.DSH_URL) push(process.env.DSH_URL);
  if (configured) push(configured);
  for (const url of loadEndpointCache()) push(url);
  const discovered = localListeningPorts();
  for (const port of discovered) push(port);

  log(`探测 DSH：候选 ${candidates.length} 个地址（其中 ${discovered.length} 个来自本机监听端口）`);
  const probes = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    probes.push(...(await Promise.all(batch.map((url) => probeDsh(url, sessionIds)))));
  }

  const usable = probes.filter((p) => p.score > 0);
  if (!usable.length) {
    log('探测结果：没有任何地址能通过 DSH 鉴权');
    for (const p of probes.slice(0, 6)) {
      log(`  · ${p.baseUrl} → ${p.error || '无响应'}`);
    }
    return null;
  }
  usable.sort((a, b) => b.score - a.score || b.sessions - a.sessions);
  for (const p of usable) {
    log(
      `  ✓ ${p.baseUrl}（${p.score === 2 ? `持有我们的会话 ×${p.sessions}` : `通用 DSH，presets=${p.presets}`}）` +
        (p.title ? ` 会话标题：${p.title}` : '')
    );
  }
  rememberEndpoint(usable[0].baseUrl);
  return usable[0];
}

async function launchDshIfPossible() {
  if (!opt.launchDsh) return false;
  if (!fs.existsSync(DSH_HINT_LAUNCHER)) {
    log(`找不到 DSH 启动快捷方式：${DSH_HINT_LAUNCHER}`);
    return false;
  }
  log('尝试拉起 DeepSeek Harness（--launch-dsh）…');
  try {
    spawn('cmd.exe', ['/c', 'start', '', DSH_HINT_LAUNCHER], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (error) {
    log(`拉起 DSH 失败：${error?.message ?? error}`);
    return false;
  }
  for (let i = 0; i < 40; i += 1) {
    await sleep(3000);
    if (localListeningPorts().length > 0) return true;
  }
  return false;
}

// ── SnowLuma ─────────────────────────────────────────────────────────────
async function snowLumaInfo(cfg) {
  const found=await discoverSnowLumaConnection({cfg,timeoutMs:3000});
  return {ok:found.ok,nickname:found.self?.nickname||'',userId:found.self?.user_id||'',error:found.ok?'':found.error||'无法访问 QQ 网关'};
}

async function ensureSnowLuma(cfg) {
  const first = await snowLumaInfo(cfg);
  if (first.ok) {
    log(`SnowLuma 在线：${first.nickname || '未知昵称'}（${first.userId || '?'}）`);
    return true;
  }
  log(`SnowLuma 连不上（${first.error || '未知错误'}），尝试按配置拉起…`);
  const launcher = String(cfg?.snowluma?.launcherPath || '');
  if (!launcher || !fs.existsSync(launcher)) {
    return fail(`找不到 SnowLuma 启动器（config.snowluma.launcherPath = ${launcher || '空'}），请手动打开 SnowLuma 后重试`);
  }
  // launcher.bat 里全是相对路径（.\check-node-version.cjs、.\node.exe），且版本检查要求
  // Node ^24.22.1 —— 必须让它的工作目录落在 SnowLuma 自己的目录里：
  // 否则 node 会跑到桥接目录里找模块（MODULE_NOT_FOUND），或者用 PATH 里的旧 node 被版本检查拦下。
  const launcherDir = path.dirname(launcher);
  try {
    // 直接用发行包附带的 Node 启动，避免 cmd start 创建可见的黑色终端。
    const snowNode = path.join(launcherDir, 'node.exe');
    const snowEntry = path.join(launcherDir, 'index.mjs');
    if (!fs.existsSync(snowNode) || !fs.existsSync(snowEntry)) throw new Error('SnowLuma 发行包缺少 node.exe 或 index.mjs');
    spawn(snowNode, [snowEntry], {
      detached: true,
      stdio: 'ignore',
      cwd: fs.existsSync(launcherDir) ? launcherDir : undefined,
      windowsHide: true
    }).unref();
  } catch (error) {
    return fail(`拉起 SnowLuma 失败：${error?.message ?? error}`);
  }
  for (let i = 0; i < 30; i += 1) {
    await sleep(3000);
    const info = await snowLumaInfo(cfg);
    if (info.ok) {
      log(`SnowLuma 已就绪：${info.nickname || '未知昵称'}（${info.userId || '?'}）`);
      return true;
    }
  }
  return fail('等待 SnowLuma 上线超时（90s）；请确认它的 OneBot 服务（HTTP 3000 / WS 3001）已开启');
}

// ── 控制台 / 已有实例 ─────────────────────────────────────────────────────
async function consoleStatus(port) {
  const token = readConsoleToken();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2500);
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: token ? { 'x-console-token': token } : {},
      signal: ac.signal
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { reachable: true, ok: false, status: res.status, data: null };
    return { reachable: true, ok: true, status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { reachable: false, ok: false, status: 0, data: null };
  }
}

/** 锁文件年龄（毫秒）；读不到返回 -1。桥接启动时会写锁文件，年龄≈本次运行时长。 */
function lockAgeMs() {
  try {
    const st = fs.statSync(LOCK_FILE);
    return Math.max(0, Date.now() - Number(st.mtimeMs || 0));
  } catch {
    return -1;
  }
}

/** 清理僵尸锁；返回 true 表示可以继续启动。 */
async function prepareLock(consolePort) {
  const status = await consoleStatus(consolePort);
  if (status.reachable) {
    log(`控制台 ${consolePort} 已有实例在应答`);
    if (!opt.force) {
      log('桥接看起来已经在跑了；如需强制重启请加 --force');
      return false;
    }
    // 冷却保护：健康 + 刚启动 ⇒ --force 只空转，不打断正在进行的对话。
    const ageMs = lockAgeMs();
    const healthy = status.ok && status.data && status.data.ok !== false;
    if (!opt.forceNow && healthy && ageMs >= 0 && FORCE_COOLDOWN_MS > 0 && ageMs < FORCE_COOLDOWN_MS) {
      log(`--force 被冷却忽略：桥接健康、才运行 ${Math.round(ageMs / 1000)} 秒（冷却 ${Math.round(FORCE_COOLDOWN_MS / 1000)} 秒）；真要重启请用 --force-now`);
      return false;
    }
    let pid = 0;
    try {
      pid = Number(fs.readFileSync(LOCK_FILE, 'utf8').trim()) || 0;
    } catch {}
    if (pid && isAlive(pid)) {
      const name = imageNameOf(pid);
      if (!/^node(\.exe)?$/i.test(name)) {
        log(`锁文件 PID ${pid} 不是 node（${name || '未知'}），为安全起见不结束它；请手动处理`);
        return false;
      }
      log(`--force：结束旧实例 PID ${pid}`);
      try {
        process.kill(pid);
        for (let i = 0; i < 20 && isAlive(pid); i += 1) await sleep(250);
      } catch (error) {
        log(`结束旧实例失败：${error?.message ?? error}`);
        return false;
      }
    } else {
      log('旧实例没有可用的 PID，无法安全结束；请手动重启桥接后重试');
      return false;
    }
  }

  if (!fs.existsSync(LOCK_FILE)) return true;
  const raw = fs.readFileSync(LOCK_FILE, 'utf8').trim();
  const pid = Number(raw) || 0;
  if (pid && isAlive(pid)) {
    log(`锁文件里的 PID ${pid} 仍然活着但没有应答控制台——按“另一个实例在跑”处理，不启动`);
    log('如果确认它是卡死的僵尸进程，请手动结束它，或加 --force');
    if (!opt.force) return false;
  }
  try {
    fs.unlinkSync(LOCK_FILE);
    log(`已清理僵尸锁文件（PID ${pid || '空'} 已不存在）`);
  } catch (error) {
    log(`清理锁文件失败：${error?.message ?? error}`);
    return false;
  }
  return true;
}

// ── 启动 + 守护 ──────────────────────────────────────────────────────────
let child = null;
let stopping = false;
let activeDshBase = '';
let exitTimes = [];

/** 桥接退出后的统一处理（挂到每个新起的子进程上）。 */
function onChildExit(code, signal) {
  log(`桥接进程退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）`);
  if (stopping || opt.once) return;
  if (code === 2) {
    log('退出码 2 表示「已有实例在运行」，不再重拉');
    return;
  }
  exitTimes.push(Date.now());
  exitTimes = exitTimes.filter((at) => Date.now() - at < 5 * 60 * 1000);
  if (exitTimes.length > 5) {
    log('❌ 桥接 5 分钟内连续退出 5 次以上，停止自动重拉，请查看 state/bridge.log');
    return;
  }
  restartSoon(5000, '桥接退出');
}

function restartSoon(delayMs = 5000, reason = '桥接退出') {
  if (stopping) return;
  log(`${reason}，${Math.round(delayMs / 1000)} 秒后重拉…`);
  setTimeout(() => {
    if (stopping) return;
    startBridge();
  }, delayMs);
}

function startBridge() {
  // stdio 用 inherit：桥接自己会写 state/bridge.log，不需要我们再转发一遍；
  // 而且某些受限环境（沙箱/服务账号）不允许开管道，pipe 会直接 EPERM。
  child = spawn(NODE_BIN, ['src/bridge.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: process.env
  });
  log(`桥接进程已启动（PID ${child.pid}）`);
  child.once('exit', onChildExit);
  return child;
}

async function waitForBridgeExit(proc){
  if(proc&&proc.exitCode===null&&proc.signalCode===null)await new Promise(resolve=>proc.once('exit',resolve));
  return proc?.exitCode===0;
}

async function waitReady(consolePort, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await consoleStatus(consolePort);
    if (st.ok && st.data) {
      const health=classifyBridge({reachable:true,status:200,data:st.data});
      if (health.healthy) return { ok: true, data: st.data,health };
      if(health.verdict==='unknown')return {ok:false,data:st.data,health};
    }
    if(st.reachable&&(st.status===401||st.status===403))return {ok:false,data:null,health:classifyBridge({reachable:true,status:st.status})};
    await sleep(2000);
  }
  const st = await consoleStatus(consolePort);
  return { ok: false, data: st.data };
}

async function main() {
  // Check means observation only. In particular: no port scan, config rewrite, gateway launch or lock cleanup.
  const existing=await readBridgeHealth();
  if(opt.check){console.log(JSON.stringify(existing,null,2));return existing.healthy;}
  if(!opt.force&&existing.healthy){log('✅ 桥接已健康运行，保留现有实例；不扫描端口、不重复启动。');return true;}
  if(!opt.force&&existing.verdict!=='console_unreachable'){
    log('现有桥接状态：'+existing.verdict+'；'+existing.reason+' 不重复启动，不使用 --force 试错。');return false;
  }
  if(!opt.force&&fs.existsSync(LOCK_FILE)){
    const pid=Number(fs.readFileSync(LOCK_FILE,'utf8').trim());
    if(pid&&isAlive(pid)){log('桥接进程仍在线，但控制台暂未响应；可能正在初始化或诊断鉴权异常。保留实例，不重复启动。');return false;}
  }
  log('════ 启动 DeepSeek大肥鱼 ════');
  if (!fs.existsSync(CONFIG_FILE)) return fail(`找不到配置：${CONFIG_FILE}`);

  let cfg;
  try {
    cfg = loadConfig();
  } catch (error) {
    return fail(`config.json 解析失败：${error?.message ?? error}`);
  }

  const consolePort = Number(cfg.consolePort) || 3100;

  // 1) DSH
  let best = await discoverDsh(cfg);
  if (!best && opt.launchDsh) {
    if (await launchDshIfPossible()) best = await discoverDsh(cfg);
  }
  if (!best && !opt.check && (await confirm('没探测到正在运行的 DeepSeek Harness，要现在帮你打开吗？'))) {
    opt.launchDsh = true;
    if (await launchDshIfPossible()) {
      log('等待 DSH 启动完成后重新探测…');
      for (let i = 0; i < 20 && !best; i += 1) {
        await sleep(3000);
        best = await discoverDsh(cfg);
      }
    }
  }
  if (!best) {
    return fail(
      '没有探测到可用的 DSH。请先打开 DeepSeek Harness（GUI 起来后再运行本脚本），' +
        '或用 --launch-dsh 让它自己拉起来。'
    );
  }
  const currentBase = String(cfg?.dsh?.baseUrl || '').replace(/\/+$/, '');
  if (best.baseUrl !== currentBase) {
    log(`更新 config.json 的 dsh.baseUrl：${currentBase || '(空)'} → ${best.baseUrl}`);
    writeConfigBaseUrl(best.baseUrl);
    cfg.dsh.baseUrl = best.baseUrl;
  } else {
    log(`DSH 地址无需变更：${best.baseUrl}`);
  }
  if (best.score < 2) {
    log('⚠️ 这个 DSH 上没有找到我们记录的会话；桥接起来后可能需要重新建立会话');
  }
  activeDshBase = best.baseUrl;

  // 2) SnowLuma
  const slOk = await ensureSnowLuma(cfg);
  if (!slOk) return false;

  // 3) 锁 / 已有实例
  if (!(await prepareLock(consolePort))) return true;

  // 4) 启动
  startBridge();

  // 5) 校验
  const ready = await waitReady(consolePort);
  if (!ready.ok) {
    log(ready.health?.verdict==='unknown'||ready.health?.verdict==='auth_required'?'⚠️ 健康检查证据不足或鉴权未通过；保留已启动进程，不把它判为断线。':'⚠️ 暂未确认整条链路就绪；保留已启动进程供复查，不自动终止。');
    if (ready.data) {
      log(`   dshReady=${ready.data.dshReady}  snowluma=${JSON.stringify(ready.data.snowluma || {}).slice(0, 200)}`);
    }
    log('   bridge.log 末尾：');
    for (const line of tailOf(BRIDGE_LOG, 10).split('\n')) log(`   | ${line}`);
  } else {
    const d = ready.data;
    const nickname = d.snowluma?.accountOnline ? 'QQ 在线' : 'QQ 状态未知';
    log(`✅ 已就绪：DSH ${best.baseUrl} · ${nickname} · 模式 ${d.mode || '?'} · 控制台 http://127.0.0.1:${consolePort}`);
    log('   在 QQ 里发条消息试试；按 Ctrl+C 停止（本窗口关闭则桥接一起退出）');
  }

  if (opt.once) {
    log('--once：不守护，桥接退出后本脚本结束');
    return waitForBridgeExit(child);
  }

  // 6) 守护（退出重拉 + 健康巡检见下面）
  // 7) 健康巡检：DSH 重启换了端口时，桥接自己跟不过去，会一直 dshReady=false。
  //    这里发现「桥接活着但 DSH 掉线」就重新探测一次，地址变了就改配置 + 重启自己拉起的桥接。
  let unhealthyStreak = 0;
  let lastAutoFixAt = 0;
  let healthChecking = false;
  const healthTimer = setInterval(async () => {
    if (stopping || healthChecking) return;
    healthChecking = true;
    try {
    const st = await consoleStatus(consolePort);
    if (!st.ok || !st.data) return; // 桥接本身没应答：交给上面的退出/重拉逻辑
    if (st.data.dshReady === true) {
      unhealthyStreak = 0;
      return;
    }
    unhealthyStreak += 1;
    if (unhealthyStreak < 3) return; // 约 3 分钟仍连不上 DSH 才动手
    if (Date.now() - lastAutoFixAt < 5 * 60 * 1000) return;
    lastAutoFixAt = Date.now();
    log('⚠️ 桥接在跑但连不上 DSH（可能 DSH 重启换了端口），重新探测…');
    const found = await discoverDsh(cfg);
    if (!found) {
      log('   仍然没探测到可用的 DSH；等它起来后我会再试');
      return;
    }
    if (found.baseUrl === activeDshBase) {
      log(`   DSH 还是 ${found.baseUrl}，但桥接连不上：可能是 DSH 侧鉴权/协议问题，不动它`);
      return;
    }
    log(`   检测到 DSH 换地址：${activeDshBase} → ${found.baseUrl}，重启桥接以跟上`);
    writeConfigBaseUrl(found.baseUrl);
    activeDshBase = found.baseUrl;
    cfg.dsh.baseUrl = found.baseUrl;
    unhealthyStreak = 0;
    try {
      child?.kill();
    } catch {}
    // onChildExit owns the one replacement launch. Scheduling here as well creates two children.
    } catch(error) {log('健康复查失败，保留当前实例：'+(error?.code||error?.name||'UNKNOWN'));}
    finally {healthChecking=false;}
  }, 60000);
  healthTimer.unref?.();

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(healthTimer);
    log('正在停止桥接…');
    try {
      child?.kill();
    } catch {}
    setTimeout(() => process.exit(0), 600);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 守护期间保持事件循环
  await new Promise(() => {});
  return true;
}

// 允许被 import（自测脚本会 import parseNetstatPorts）；只有直接运行时才真正启动。
export { parseNetstatPorts, onChildExit, waitForBridgeExit };

const invokedDirectly = (() => {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return entry === fileURLToPath(import.meta.url);
})();

if (invokedDirectly) {
  main()
    .then((ok) => {
      const code = ok === false ? 1 : 0;
      if (ok === false) log(`启动失败（耗时 ${Math.round((Date.now() - t0) / 1000)}s）`);
      else if (opt.check || opt.once) log(`完成（耗时 ${Math.round((Date.now() - t0) / 1000)}s）`);
      else return; // 守护模式：main 不会 resolve 到这里
      process.exitCode = code;
      // 不在 fetch 的 keep-alive 连接还开着的时候硬退，否则 libuv 在 Windows 上会打断言。
      setTimeout(() => process.exit(code), 1200).unref();
    })
    .catch((error) => {
      log(`未捕获错误：${error?.stack || error}`);
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 1200).unref();
    });
}
