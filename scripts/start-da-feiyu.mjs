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
import path from 'node:path';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { NodeApiClient, unwrap } from '../src/dsh-client.js';
import { readBridgeHealth, classifyBridge, resolveConsoleToken } from '../plugins/qq-components/obs-bridge-health/health.mjs';
import { discoverSnowLumaConnection } from '../src/snowluma-conn.js';
import { readLauncherSettings } from './launcher-settings.mjs';
import { processRunsFile, stopVerifiedRecords } from './launcher-process-identity.mjs';
import { resolveSnowHome } from './snow-runtime-location.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = path.join(ROOT, 'state');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const LOCK_FILE = path.join(STATE_DIR, 'bridge.lock');
const START_LOG = path.join(STATE_DIR, 'start-da-feiyu.log');
const BRIDGE_LOG = path.join(STATE_DIR, 'bridge.log');
const ENDPOINT_CACHE = path.join(STATE_DIR, 'dsh-endpoints.json');
const SUPERVISOR_FILE = path.join(STATE_DIR, 'start-da-feiyu.pid');
const PROGRESS_FILE = path.join(STATE_DIR, 'startup-progress.json');
const execText = promisify(execFile);

const NODE_BIN = process.execPath;

// ── 命令行参数 ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = {
  gatewayOnly: argv.includes('--gateway-only'),
  stopGateway: argv.includes('--stop-gateway'),
  stop: argv.includes('--stop'),
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
  progress('failed', msg);
  return false;
}

function progress(phase, message) {
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ pid: process.pid, phase, message, at: Date.now() })); } catch {}
}

async function processList() {
  if (process.platform !== 'win32') return [];
  const { stdout } = await execText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate,CommandLine)'
  ], { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout || '[]');
}

const normalized = value => String(value || '').replaceAll('\\', '/').toLowerCase();
function commandHasFile(command, file) {
  const escaped = normalized(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[\\s"\'])' + escaped + '(?=$|[\\s"\'])').test(normalized(command));
}

async function stopSnowProcesses(home) {
  const entry = path.join(home, 'index.mjs');
  const matches = (await processList()).filter(p => processRunsFile(p.CommandLine, entry));
  // Updater first: otherwise it may respawn a worker while shutdown is in progress.
  matches.sort((a, b) => matches.some(p => p.ProcessId === a.ParentProcessId) - matches.some(p => p.ProcessId === b.ParentProcessId));
  await stopVerifiedRecords(matches, { list: processList, stop: pid => stopBridgePair(pid) });
  return true;
}

async function stopBot() {
  const cfg = loadConfig();
  // Verify the supervisor by its absolute script path, not by a potentially reused PID.
  const { supervisors } = selectBotProcesses(await processList(), ROOT, process.pid);
  await stopVerifiedRecords(supervisors, { list: processList, stop: pid => stopBridgePair(0, pid) });
  // bridge.js hardens its state directory before writing bridge.lock. Catch that
  // initialization window too; otherwise stopping the supervisor leaves an orphan.
  const booting = (await processList()).filter(p => processRunsFile(p.CommandLine, path.join(ROOT, 'src', 'bridge.js')));
  await stopVerifiedRecords(booting, { list: processList, stop: pid => stopBridgePair(pid) });
  const bridgePid = Number(fs.existsSync(LOCK_FILE) ? fs.readFileSync(LOCK_FILE, 'utf8').trim() : 0);
  if (bridgePid && isAlive(bridgePid) && !(await stopLockedBridge(bridgePid, Number(cfg.consolePort) || 3100))) return false;
  if (fs.existsSync(LOCK_FILE) && bridgePid && isAlive(bridgePid)) return fail('桥接仍在运行，取消后续操作');
  try { fs.unlinkSync(LOCK_FILE); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { fs.unlinkSync(SUPERVISOR_FILE); } catch {}
  progress('stopped', 'bot 已关闭');
  log('bot 已关闭，守护已停止；保留 QQ、SnowLuma 和 DSH');
  return true;
}

function selectBotProcesses(processes, root, selfPid) {
  const bridges = processes.filter(p => processRunsFile(p.CommandLine, path.join(root, 'src', 'bridge.js')));
  const supervisors = processes.filter(p => p.ProcessId !== selfPid && !/(?:^|\s)--stop(?:\s|$)/.test(p.CommandLine)
    && (processRunsFile(p.CommandLine, path.join(root, 'scripts', 'start-da-feiyu.mjs'))
      || (processRunsFile(p.CommandLine, 'scripts/start-da-feiyu.mjs') && bridges.some(child => child.ParentProcessId === p.ProcessId))));
  return { bridges, supervisors };
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

function parseNetstatPorts(out, allowedPids = null) {
  // 不用「状态列 == LISTENING」判断，因为中文/英文系统的 netstat 状态列不一样；
  // 改成「远端端口为 0」＝监听（与语言无关）。
  const ports = new Set();
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+(\S+):(\d+)\s+(\S+)/);
    if (!m) continue;
    const [, addr, localPort, remoteAddr, remotePort] = m;
    if (allowedPids && !allowedPids.has(Number(line.trim().split(/\s+/).at(-1)))) continue;
    if (Number(remotePort) !== 0) continue; // 不是监听
    const local = /(127\.0\.0\.1|\[::1\]|\[::\]|0\.0\.0\.0)/.test(addr);
    const anyRemote = /(127\.0\.0\.1|\[::1\]|\[::\]|0\.0\.0\.0)/.test(remoteAddr);
    if (!local && !anyRemote) continue;
    const port = Number(localPort);
    if (!port || port < 1024 || port > 65535) continue;
    if ([3000, 3001, 3100, 3199, 9222, 9227].includes(port)) continue;
    ports.add(port);
  }
  return [...ports];
}

function localListeningPorts(allowedPids = null) {
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
  return parseNetstatPorts(out, allowedPids);
}

function parseDshProcessIds(out) {
  return new Set(String(out).split(/\r?\n/).map(line =>
    line.match(/^"DeepSeek Harness\.exe",\s*"(\d+)"/i)?.[1]
  ).filter(Boolean).map(Number));
}

function localDshListeningPorts() {
  if (process.platform !== 'win32') return [];
  try {
    const output = execFileSync('tasklist.exe', [
      '/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/FO', 'CSV', '/NH'
    ], { encoding: 'utf8', timeout: 4000, windowsHide: true });
    const pids = parseDshProcessIds(output);
    return pids.size ? localListeningPorts(pids) : [];
  } catch { return []; }
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
 *  - 先用带鉴权的 agentPresets.list 排除无关本地服务；
 *  - 再看它是否持有已知会话，仍以会话归属作为更强的选择依据。
 */
async function probeDsh(baseUrl, sessionIds, createClient = url => new NodeApiClient(url, 3000, {})) {
  const result = { baseUrl, score: 0, title: '', error: '', presets: 0, sessions: 0 };
  const api = createClient(baseUrl);
  const withTimeout = async (fn, ms) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    try {
      return await fn(ac.signal);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const value = unwrap(await withTimeout(signal => api.callUnary('agentPresets.list', {}, signal), 3000));
    const list = Array.isArray(value) ? value : value?.presets ?? value?.items;
    if (!Array.isArray(list)) throw new Error('invalid DSH preset catalogue');
    result.presets = list.length;
    result.score = 1;
  } catch (error) {
    result.error = error?.message ?? String(error);
    return result;
  }
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
  if (result.score > 0) result.error = '';
  return result;
}

async function discoverDsh(cfg, deps = {}) {
  const probe = deps.probe ?? probeDsh;
  const remember = deps.remember ?? rememberEndpoint;
  const configured = String(cfg?.dsh?.baseUrl || '').trim();
  const sessionIds = deps.sessionIds ?? (() => {
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
    const quick = await probe(quickUrl, sessionIds);
    if (quick && quick.score > 0) {
      log(`探测 DSH：${quickUrl} 直接可用（跳过端口扫描）`);
      remember(quickUrl);
      return quick;
    }
    log(`探测 DSH：${quickUrl} 不可用，检查 DSH 进程监听端口`);
  }

  const preferredPorts = (deps.preferredPorts ?? localDshListeningPorts)();
  if (preferredPorts.length) {
    const preferred = await Promise.all(preferredPorts.map(port => probe(`http://127.0.0.1:${port}`, sessionIds)));
    const best = preferred.filter(p => p.score >= 2 || (!sessionIds.length && p.score > 0))
      .sort((a, b) => b.score - a.score || b.sessions - a.sessions)[0];
    if (best) {
      log(`探测 DSH：通过进程监听端口定位 ${best.baseUrl}（已鉴权，会话命中 ${best.sessions} 个，跳过全量扫描）`);
      remember(best.baseUrl);
      return best;
    }
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
  for (const url of (deps.loadCache ?? loadEndpointCache)()) push(url);
  const discovered = (deps.allPorts ?? localListeningPorts)();
  for (const port of discovered) push(port);

  log(`探测 DSH：候选 ${candidates.length} 个地址（其中 ${discovered.length} 个来自本机监听端口）`);
  const probes = [];
  const CONCURRENCY = 16;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    probes.push(...(await Promise.all(batch.map((url) => probe(url, sessionIds)))));
    // Two known-session matches are already the strongest ownership evidence.
    const owned = probes.find(p => p.score >= 2 && p.sessions >= 2);
    if (owned) { remember(owned.baseUrl); return owned; }
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
  remember(usable[0].baseUrl);
  return usable[0];
}

async function launchDshIfPossible() {
  if (!opt.launchDsh) return false;
  const cfg = loadConfig();
  const candidates = [cfg.dsh?.launcherPath, process.env.DSH_EXE,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'Desktop', 'DeepSeek Harness.lnk')].filter(Boolean);
  const launcher = candidates.find(candidate => fs.existsSync(candidate));
  if (!launcher) {
    log('找不到 DSH 启动程序；请配置 dsh.launcherPath 或 DSH_EXE');
    return false;
  }
  log('尝试拉起 DeepSeek Harness（--launch-dsh）…');
  try {
    if (/\.lnk$/i.test(launcher)) {
      const encoded = Buffer.from(`Start-Process -FilePath '${launcher.replaceAll("'", "''")}' -WindowStyle Hidden`, 'utf16le').toString('base64');
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: 'ignore', windowsHide: true }).unref();
    } else spawn(launcher, [], { stdio: 'ignore', windowsHide: true }).unref();
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
  const expected = resolveBotUin(cfg);
  const accountOk = expected && String(found.self?.user_id || '') === expected;
  return {ok:found.ok && !!accountOk,nickname:found.self?.nickname||'',userId:found.self?.user_id||'',
    errorKind: found.tried?.some(item => item.status === 401) ? 'auth_rejected' : found.ok && !accountOk ? 'wrong_account' : 'gateway_pending',
    error:found.ok && !accountOk ? 'QQ 网关当前账号不是指定 bot，正在恢复 bot 账号' : found.ok?'':found.error||'无法访问 QQ 网关'};
}

function resolveBotUin(cfg) {
  return readLauncherSettings(ROOT, cfg).botUin;
}

function buildSnowLaunch(launcher, botUin) {
  const home = path.dirname(launcher);
  return {
    file: path.join(home, 'node.exe'),
    args: ['--import', pathToFileURL(path.join(__dirname, 'snow-bootstrap.mjs')).href, path.join(home, 'index.mjs')],
    options: { cwd: home, windowsHide: true, detached: process.platform !== 'win32', stdio: 'ignore',
      env: { ...process.env, QQL_BOT_UIN: String(botUin || ''), SNOWLUMA_HOOK_AUTOLOAD: '0', SNOWLUMA_BRIDGE_UIN: String(botUin || ''),
        SNOWLUMA_BRIDGE_ENTRY: path.join(home, 'index.mjs') } }
  };
}

async function ensureSnowLuma(cfg, deps = {}) {
  const infoFn = deps.info || snowLumaInfo;
  const exists = deps.exists || fs.existsSync;
  const pause = deps.sleep || sleep;
  const now = deps.now || Date.now;
  const report = deps.progress || progress;
  const botUin = deps.botUin || resolveBotUin(cfg);
  if (!botUin) return fail('无法确定 bot QQ 账号；请配置 snowluma.botUin，不会自动加载其他 QQ');
  const first = await infoFn(cfg);
  if (first.ok) {
    log(`SnowLuma 在线：${first.nickname || '未知昵称'}（${first.userId || '?'}）`);
    return true;
  }
  log(`SnowLuma 连不上（${first.error || '未知错误'}），尝试按配置拉起…`);
  // launcher.bat 里全是相对路径（.\check-node-version.cjs、.\node.exe），且版本检查要求
  // Node ^24.22.1 —— 必须让它的工作目录落在 SnowLuma 自己的目录里：
  // 否则 node 会跑到桥接目录里找模块（MODULE_NOT_FOUND），或者用 PATH 里的旧 node 被版本检查拦下。
  let snowChild, launchError = '', exited = false;
  try {
    const launcherDir = resolveSnowHome(cfg, { exists });
    // 直接用发行包附带的 Node 启动，避免 cmd start 创建可见的黑色终端。
    const snowNode = path.join(launcherDir, 'node.exe');
    const snowEntry = path.join(launcherDir, 'index.mjs');
    if (!exists(snowNode) || !exists(snowEntry)) throw new Error('SnowLuma 发行包缺少 node.exe 或 index.mjs');
    // An existing WebUI alone does not imply an injected, logged-in QQ session.
    if (!(await (deps.stopStale || stopSnowProcesses)(launcherDir))) throw new Error('无法停止未就绪的旧 SnowLuma');
    const launch = buildSnowLaunch(path.join(launcherDir, 'launcher.bat'), botUin);
    if (deps.launch) snowChild = await deps.launch(launch);
    else {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      const errorLog = path.join(STATE_DIR, 'snowluma-process.stderr.log');
      try { if (fs.statSync(errorLog).size > 2 * 1024 * 1024) fs.renameSync(errorLog, `${errorLog}.${Date.now()}`); } catch {}
      const errorFd = fs.openSync(errorLog, 'a');
      try { snowChild = spawn(launch.file, launch.args, { ...launch.options, stdio: ['ignore', 'ignore', errorFd] }); }
      finally { fs.closeSync(errorFd); }
    }
    snowChild.once('error', error => { launchError = error?.message || 'spawn failed'; });
    snowChild.once('exit', (code, signal) => {
      exited = true; launchError = `进程退出 code=${code} signal=${signal}`;
      log(`SnowLuma 启动器已退出（PID ${snowChild.pid}，code=${code} signal=${signal}）`);
    });
    snowChild.unref?.();
  } catch (error) {
    return fail(`拉起 SnowLuma 失败：${error?.message ?? error}`);
  }
  report('waiting_gateway', '正在连接指定机器人 QQ 的接口；已登录 QQ 时无需重复登录');
  const deadline = now() + 300_000;
  while (now() < deadline) {
    await pause(2000);
    if (launchError || exited) return fail(`SnowLuma 启动失败：${launchError}；请查看 SnowLuma 日志`);
    const info = await infoFn(cfg);
    if (info.ok) {
      log(`SnowLuma 已就绪：${info.nickname || '未知昵称'}（${info.userId || '?'}）`);
      return true;
    }
    report('waiting_gateway', info.errorKind === 'auth_rejected'
      ? 'QQ 接口有响应，但机器人账号鉴权尚未通过；正在等待指定账号的接口就绪'
      : '正在等待指定机器人 QQ 的接口就绪（请保持该账号登录）');
  }
  return fail('指定机器人 QQ 的接口等待超时（5 分钟）；请检查 SnowLuma 账号、端口和鉴权，不代表 QQ 未登录');
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
      if (!(await stopLockedBridge(pid, consolePort))) return false;
    } else {
      log('旧实例没有可用的 PID，无法安全结束；请手动重启桥接后重试');
      return false;
    }
  }

  if (!fs.existsSync(LOCK_FILE)) return true;
  const raw = fs.readFileSync(LOCK_FILE, 'utf8').trim();
  const pid = Number(raw) || 0;
  if (pid && isAlive(pid)) {
    if (!opt.force) {
      log(`锁文件里的 PID ${pid} 仍然活着但没有应答控制台——按“另一个实例在跑”处理，不启动`);
      log('如果确认它是卡死的僵尸进程，请手动结束它，或加 --force');
      return false;
    }
    if (!(await stopLockedBridge(pid, consolePort))) return false;
  }
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
    log(`已清理僵尸锁文件（PID ${pid || '空'} 已不存在）`);
  } catch (error) {
    log(`清理锁文件失败：${error?.message ?? error}`);
    return false;
  }
  return true;
}

async function stopBridgePair(bridgePid, supervisorPid = 0) {
  // On Windows a detached child survives termination of its supervisor.
  // Stop and confirm the supervisor first, then explicitly stop the bridge.
  for (const targetPid of [supervisorPid, bridgePid].filter(Boolean)) {
    if (!isAlive(targetPid)) continue;
    try { process.kill(targetPid); }
    catch (error) { if (error?.code !== 'ESRCH') return false; }
    for (let i = 0; i < 40 && isAlive(targetPid); i += 1) await sleep(250);
    if (isAlive(targetPid)) return false;
  }
  return true;
}

async function stopLockedBridge(pid, consolePort) {
  // A reboot can reuse yesterday's PID for an unrelated application. The new
  // process creation time proves that the old lock no longer owns that PID.
  try {
    const { stdout } = await execText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${Math.trunc(pid)}').CreationDate.ToUniversalTime().ToString('o')`
    ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (lockPidReused(fs.statSync(LOCK_FILE).mtimeMs, Date.parse(stdout.trim()))) {
      if (Number(fs.readFileSync(LOCK_FILE, 'utf8').trim()) === pid) fs.unlinkSync(LOCK_FILE);
      log(`旧锁 PID ${pid} 已被新进程复用；只清理过期锁，不结束该进程`);
      return true;
    }
  } catch {}
  const name = imageNameOf(pid);
  if (!/^node(\.exe)?$/i.test(name)) {
    log(`锁文件 PID ${pid} 不是 node（${name || '未知'}），为安全起见不结束它；请手动处理`);
    return false;
  }
  // A stale lock can point at a reused PID. Only terminate a Node process whose command line
  // still identifies this bridge checkout; never kill an unrelated Node service by PID alone.
  let processInfo = null;
  try {
    const rawInfo = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${Math.trunc(pid)}'; ` +
      `$parent = Get-CimInstance Win32_Process -Filter \"ProcessId = $($p.ParentProcessId)\"; ` +
      `ConvertTo-Json -Compress @{ parentPid = $p.ParentProcessId; commandLine = $p.CommandLine; parentCommandLine = $parent.CommandLine }`
    ], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
    processInfo = JSON.parse(rawInfo);
  } catch {}
  const normalizedCommand = String(processInfo?.commandLine || '').replaceAll('\\', '/').toLowerCase();
  const normalizedParent = String(processInfo?.parentCommandLine || '').replaceAll('\\', '/').toLowerCase();
  const normalizedEntry = path.join(ROOT, 'src', 'bridge.js').replaceAll('\\', '/').toLowerCase();
  const normalizedRoot = ROOT.replaceAll('\\', '/').toLowerCase();
  const parentPid = Number(processInfo?.parentPid) || 0;
  const parentIsThisSupervisor = normalizedParent.includes('start-da-feiyu.mjs')
    && (normalizedParent.includes(normalizedRoot) || normalizedParent.includes('scripts/start-da-feiyu.mjs'));
  // A previous supervisor may already be dead. The authenticated console from this
  // checkout plus the OS listener PID can still identify that orphan safely.
  let isBridgeEntry = normalizedCommand.includes(normalizedEntry)
    || (normalizedCommand.includes('src/bridge.js') && parentIsThisSupervisor);
  if (!isBridgeEntry && normalizedCommand.includes('src/bridge.js')) {
    try {
      const rawPids = execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -LocalPort ${Math.trunc(consolePort)} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)`
      ], { encoding: 'utf8', timeout: 20000, windowsHide: true });
      const ownsConsole = JSON.parse(rawPids).map(Number).includes(pid);
      isBridgeEntry = ownsConsole && (await consoleStatus(consolePort)).ok;
    } catch {}
  }
  if (!isBridgeEntry) {
    log(`锁文件 PID ${pid} 的命令行无法确认为当前桥接：为安全起见不结束它`);
    return false;
  }
  if (parentIsThisSupervisor && parentPid && isAlive(parentPid)) {
    log(`--force：先结束旧守护进程 PID ${parentPid}，阻止它再次拉起旧桥接`);
  }
  log(`--force：结束旧桥接 PID ${pid}`);
  if (!(await stopBridgePair(pid, parentIsThisSupervisor ? parentPid : 0))) {
    log('旧守护进程或桥接未能退出；停止启动以避免重复实例');
    return false;
  }
  return true;
}

function lockPidReused(lockMtimeMs, creationMs) {
  return Number.isFinite(lockMtimeMs) && Number.isFinite(creationMs) && creationMs > lockMtimeMs + 2000;
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
  // 桥接自己会写 state/bridge.log；完全隐藏子进程，避免桌面按钮启动时弹出命令窗口。
  child = spawn(NODE_BIN, [path.join(ROOT, 'src', 'bridge.js')], {
    cwd: ROOT,
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: true,
    env: process.env
  });
  log(`桥接进程已启动（PID ${child.pid}）`);
  child.once('exit', onChildExit);
  child.once('error', error => { fail(`桥接进程无法启动：${error.message}`); });
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
  if (opt.stop) return stopBot();
  if (opt.stopGateway) {
    const cfg = loadConfig();
    const entry = path.join(ROOT, 'scripts', 'start-da-feiyu.mjs');
    const guardians = (await processList()).filter(p => p.ProcessId !== process.pid && processRunsFile(p.CommandLine, entry)
      && /(?:^|\s)--gateway-only(?:\s|$)/.test(p.CommandLine));
    await stopVerifiedRecords(guardians, { list: processList, stop: pid => stopBridgePair(pid) });
    await stopSnowProcesses(resolveSnowHome(cfg));
    log('仅停止 SnowLuma 及其网关守护，保留 QQ、DSH 和桥接');
    return true;
  }
  if (opt.gatewayOnly) {
    // Own only SnowLuma; never clean bridge locks, change sessions, or restart DSH.
    const cfg = loadConfig();
    const botUin = resolveBotUin(cfg);
    if (!botUin) return fail('机器人 QQ 未设置，拒绝恢复网关');
    process.env.QQL_BOT_UIN = botUin;
    cfg.snowluma = { ...cfg.snowluma, botUin };
    const entry = path.join(ROOT, 'scripts', 'start-da-feiyu.mjs');
    const duplicate = (await processList()).some(p => p.ProcessId !== process.pid && processRunsFile(p.CommandLine, entry)
      && /(?:^|\s)--gateway-only(?:\s|$)/.test(p.CommandLine));
    if (duplicate) { log('网关守护已存在，不启动第二个'); return true; }
    log('网关守护开始：只恢复指定机器人 QQ 的 SnowLuma，保留桥接');
    if (!(await ensureSnowLuma(cfg))) return false;
    progress('ready', 'SnowLuma 网关已恢复，桥接将自动重连');
    let activeBotUin = botUin;
    let home = resolveSnowHome(cfg);
    let snowEntry = path.join(home, 'index.mjs');
    let gatewayRestarts = [];
    while (true) {
      await sleep(10000);
      // A guardian can outlive the settings page and retain its startup config.
      // Reload the canonical file before every recovery decision so an account
      // change can never silently reconnect the previous bot.
      let latestCfg;
      try { latestCfg = loadConfig(); }
      catch (error) { return fail(`无法读取机器人 QQ 设置，停止自动恢复：${error?.message || error}`); }
      const latestBotUin = resolveBotUin(latestCfg);
      if (!latestBotUin) {
        await stopSnowProcesses(home);
        return fail('机器人 QQ 已从设置中移除，已停止 SnowLuma 自动恢复');
      }
      latestCfg.snowluma = { ...latestCfg.snowluma, botUin: latestBotUin };
      if (latestBotUin !== activeBotUin) {
        log('检测到机器人 QQ 设置已更改；只按新设置切换 SnowLuma 网关');
        process.env.QQL_BOT_UIN = latestBotUin;
        if (!(await ensureSnowLuma(latestCfg))) return false;
        activeBotUin = latestBotUin;
        cfg = latestCfg;
        home = resolveSnowHome(cfg);
        snowEntry = path.join(home, 'index.mjs');
        gatewayRestarts = [];
        continue;
      }
      const processes = await processList();
      if (processes.some(p => processRunsFile(p.CommandLine, snowEntry))) continue;
      const now = Date.now();
      gatewayRestarts = gatewayRestarts.filter(time => now - time < 10 * 60_000);
      if (gatewayRestarts.length >= 3) return fail('SnowLuma 十分钟内连续退出三次，已停止网关重试；查看 gateway-recovery.log 和 snowluma-process.stderr.log');
      gatewayRestarts.push(now);
      log('检测到 SnowLuma 进程已消失，单独恢复网关');
      if (!(await ensureSnowLuma(latestCfg))) return false;
    }
  }
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
  const botUin = resolveBotUin(cfg);
  if (!botUin) return fail('请先在标题栏“设置”中填写机器人 QQ，再启动 bot');
  process.env.QQL_BOT_UIN = botUin;
  cfg.snowluma = { ...cfg.snowluma, botUin };
  if (opt.forceNow && !(await stopBot())) return false;
  fs.writeFileSync(SUPERVISOR_FILE, String(process.pid));
  progress('discovering_dsh', '正在定位 DSH');

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
  if (!opt.forceNow && !(await prepareLock(consolePort))) {
    return !opt.forceNow && (await readBridgeHealth()).healthy;
  }

  // 4) 启动
  progress('starting_bridge', '正在初始化桥接和加载预设');
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
    progress('ready', 'bot 已就绪');
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
export { parseNetstatPorts, parseDshProcessIds, probeDsh, discoverDsh, onChildExit, waitForBridgeExit, stopBridgePair, buildSnowLaunch, ensureSnowLuma, commandHasFile, lockPidReused, resolveBotUin, selectBotProcesses };

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
