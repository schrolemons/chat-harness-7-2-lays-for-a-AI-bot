// qq-launcher —— DSH 标题栏「一键启动AI助手」的 Host 半边。
//
// 职责只有两件事（客户端半在 lib/client.js）：
//   ① GET  /status  给标题栏那颗红绿灯报状态：QQ 客户端 / SnowLuma(OneBot 3000+3001) / 桥接(控制台 3100)
//   ② POST /start   一键拉起 QQ → SnowLuma → 桥接（复用桥接仓库自己的 scripts/start-da-feiyu.mjs）
//
// 为什么不另起一个常驻服务：Host 半边本来就跑在 DSH 的 Host 进程里，
// 按钮也只在 DSH 里用；插件跟着 DSH 启停，不需要额外开机自启项。
//
// 这里刻意不 import 任何 @deepseek-ai/* 包：只用 node 内置模块，
// 少一个依赖就少一种把 DSH 装挂的方式。cordis 的 ctx 只用来做 effect 清理。

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBridgeHealth, resolveConsoleToken } from '../../qq-components/obs-bridge-health/health.mjs';
import { readLauncherSettings, saveLauncherSettings, validateBotUin } from '../../../scripts/launcher-settings.mjs';
import { NodeApiClient, unwrap } from '../../../src/dsh-client.js';
import { createGatewayRecovery } from '../../../scripts/gateway-recovery.mjs';
import { processRunsFile } from '../../../scripts/launcher-process-identity.mjs';
import { resolveSnowHome } from '../../../scripts/snow-runtime-location.mjs';

export const name = 'qq-launcher';
export const inject = [];

const DEFAULT_PORT = 3199;
const SNOWLUMA_HTTP_PORT = 3000;
const SNOWLUMA_WS_PORT = 3001;
const BRIDGE_CONSOLE_PORT = 3100;

/** 启动流程最长占用多久的“黄灯”，超时后回到红/绿实测状态。 */
const STARTING_TTL_MS = 420_000;

function log(...args) {
  try {
    console.log('[qq-launcher]', ...args);
  } catch {}
}

function tcpProbe(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

function execFileText(file, args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        resolve(error ? '' : String(stdout || ''));
      });
    } catch {
      resolve('');
    }
  });
}

async function isQqRunning() {
  if (process.platform !== 'win32') return false;
  const out = await execFileText('tasklist.exe', ['/FI', 'IMAGENAME eq QQ.exe', '/NH']);
  return /QQ\.exe/i.test(out);
}

async function resolveQqExe(config, fallback) {
  const running = process.platform === 'win32' ? await execFileText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name = 'QQ.exe'\" | Select-Object -ExpandProperty ExecutablePath -Unique"
  ]) : '';
  const candidates = [
    typeof config?.qqExe === 'string' ? config.qqExe.trim() : '',
    process.env.QQ_EXE || '',
    ...running.split(/\r?\n/),
    path.join(process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files', 'Tencent', 'QQNT', 'QQ.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tencent', 'QQNT', 'QQ.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Tencent', 'QQNT', 'QQ.exe'),
    fallback
  ].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  for (const key of [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\QQ.exe',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\QQ.exe',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\QQ.exe'
  ]) {
    const value = await execFileText('reg.exe', ['query', key, '/ve']);
    const match = value.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)\s*$/imu);
    if (match?.[1]) {
      const resolved = match[1].trim().replace(/^"|"$/gu, '');
      try { if (fs.statSync(resolved).isFile()) return resolved; } catch {}
    }
  }
  return '';
}

async function resolveNodeBinary(config) {
  const candidates = [
    typeof config?.nodeExe === 'string' ? config.nodeExe.trim() : '',
    process.env.DSH_NODE_BINARY || '',
    process.env.NODE_BINARY || '',
    ...(process.platform === 'win32'
      ? (await execFileText('where.exe', ['node.exe'])).split(/\r?\n/u)
      : (await execFileText('which', ['node'])).split(/\r?\n/u)),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    ...(process.versions.electron ? [] : [process.execPath])
  ].map(value => String(value).trim()).filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  throw new Error('找不到可用的 Node.js。请安装 Node.js 或在启动器配置 nodeExe');
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * 桥接仓库根目录：优先用配置里的 bridgeDir，其次从插件自身位置往上找
 * （插件放在 <repo>/plugins/qq-launcher，所以两级父目录就是仓库根）。
 */
function resolveBridgeDir(config) {
  const candidates = [];
  if (typeof config?.bridgeDir === 'string' && config.bridgeDir.trim()) candidates.push(config.bridgeDir.trim());
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, '..', '..', '..'));
  } catch {}
  candidates.push(process.cwd());
  for (const dir of candidates) {
    try {
      if (dir && fs.existsSync(path.join(dir, 'scripts', 'start-da-feiyu.mjs'))) return dir;
    } catch {}
  }
  return null;
}

function readBridgeLockPid(bridgeDir) {
  try {
    const raw = fs.readFileSync(path.join(bridgeDir, 'state', 'bridge.lock'), 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

function readBridgeConfig(bridgeDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(bridgeDir, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function urlPort(value, fallback) {
  try {
    const url = new URL(String(value));
    if (url.port) return Number(url.port);
    return url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : fallback;
  } catch {
    return fallback;
  }
}

export function createLauncher(ctx, config, deps = {}) {
  const port = Number.isInteger(config?.servicePort) && config.servicePort >= 0 ? config.servicePort : DEFAULT_PORT;
  const qqExe = typeof config?.qqExe === 'string' ? config.qqExe.trim() : '';
  const bridgeDir = resolveBridgeDir(config);
  const settingsRoot = deps.settingsRoot || bridgeDir;
  const getSettings = () => readLauncherSettings(settingsRoot);
  const requireBot = () => {
    try { if (getSettings().botUin) return null; }
    catch (error) { return { ok: false, code: 'BOT_QQ_REQUIRED', error: error.message }; }
    return { ok: false, code: 'BOT_QQ_REQUIRED', error: '请先设置机器人 QQ 号' };
  };

  let startingSince = 0;
  let lastStartAt = 0;
  let lastError = '';
  let startPromise = null;
  let controlPromise = null;
  let operation = '';
  let generation = 0;
  let stopped = false;
  let runner = null;
  let replacedBridgePid = null;
  let disposed = false;
  let savingSettings = false;
  let gatewayPromise = null;
  let gatewayRunner = null;
  let gatewayError = '';
  const checkQq = deps.isQqRunning || isQqRunning;
  const checkHealth = deps.health || readBridgeHealth;
  const probe = deps.tcpProbe || tcpProbe;

  const starting = () => startingSince > 0 && Date.now() - startingSince < STARTING_TTL_MS;

  async function status() {
    const cfg = bridgeDir ? readBridgeConfig(bridgeDir) : {};
    let botUin = '', settingsError = '';
    try { botUin = getSettings().botUin; } catch (error) { settingsError = error.message; }
    const httpPort = urlPort(cfg?.snowluma?.httpUrl, SNOWLUMA_HTTP_PORT);
    const wsPort = urlPort(cfg?.snowluma?.wsUrl, SNOWLUMA_WS_PORT);
    const consolePort = Number(cfg?.consolePort) || BRIDGE_CONSOLE_PORT;
    const [qq, snowluma, snowlumaWs, bridge] = await Promise.all([
      checkQq(),
      probe(httpPort),
      probe(wsPort),
      probe(consolePort)
    ]);
    const lockPid = bridgeDir ? readBridgeLockPid(bridgeDir) : null;
    const bridgePidAlive = pidAlive(lockPid);
    // QQ 进程探测是 best-effort（tasklist 在受限上下文里会 EPERM）；
    // 真正的判据用 SnowLuma 与桥接是否在监听：SnowLuma 起得来就说明 QQ 挂着。
    const health = bridgeDir ? await checkHealth({ root: bridgeDir, timeoutMs: 1500 }) : null;
    let presetsReady = false;
    if (health?.healthy) {
      try {
        const response = await fetch(`http://127.0.0.1:${consolePort}/api/presets`, {
          headers: { 'x-console-token': resolveConsoleToken(bridgeDir, cfg) },
          signal: AbortSignal.timeout(2000)
        });
        const data = await response.json();
        const ids = new Set((data.presets || []).map(p => p.id));
        presetsReady = response.ok && ['qq-chat', 'qq-chat-v2', 'qq-chat-dev', 'qq-task-worker'].every(id => ids.has(id));
      } catch {}
    }
    const replacementPending = starting() && (!runner || (replacedBridgePid && lockPid === replacedBridgePid));
    const ready = health?.healthy === true && presetsReady && operation !== 'stopping' && !stopped && !replacementPending;
    let progress = null;
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'state', 'startup-progress.json'), 'utf8'));
      if (saved.pid === runner?.pid && saved.at >= lastStartAt) progress = saved;
    } catch {}
    if (ready) {
      startingSince = 0;
      lastError = '';
      operation = '';
    } else if (startingSince > 0 && Date.now() - startingSince >= STARTING_TTL_MS) {
      startingSince = 0;
      lastError = '启动超时：请检查 DSH、SnowLuma 和 state/start-da-feiyu.log';
      operation = '';
    }
    let light = 'red';
    if (starting() && !ready) light = 'amber';
    else if (ready) light = 'green';
    return {
      ok: true,
      at: new Date().toISOString(),
      light,
      starting: starting(),
      stopped,
      operation,
      phase: ready ? 'ready' : starting() ? progress?.phase || 'starting' : stopped ? 'stopped' : gatewayPromise ? 'recovering_gateway' : health?.verdict || 'unknown',
      message: ready ? 'bot 已就绪' : starting() ? progress?.message || '' : stopped ? 'bot 已关闭' : gatewayPromise ? '正在恢复 SnowLuma 网关，保留桥接' : health?.reason || '',
      ready,
      botUin,
      settingsRequired: !botUin,
      settingsError,
      gatewayRecovering: !!gatewayPromise,
      gatewayError,
      checks: {
        qq,
        snowluma,
        snowlumaWs,
        bridge,
        bridgePid: lockPid,
        bridgePidAlive,
        presetsReady,
        health: health?.verdict || 'unknown',
        dshPort: urlPort(cfg?.dsh?.baseUrl, null),
        ports: { snowlumaHttp: httpPort, snowlumaWs: wsPort, bridgeConsole: consolePort }
      },
      bridgeDir,
      lastStartAt: lastStartAt ? new Date(lastStartAt).toISOString() : null,
      lastError
    };
  }

  function startBridge() {
    const required = requireBot();
    if (required) return required;
    if (disposed) return { ok: false, error: '启动器已卸载，请刷新页面' };
    if (!bridgeDir) {
      lastError = '找不到桥接仓库（缺少 scripts/start-da-feiyu.mjs）';
      return { ok: false, error: lastError };
    }
    // Keep duplicate requests from starting a second supervisor while the detached first
    // supervisor is still discovering DSH, recovering SnowLuma, or reconnecting the bridge.
    if (starting() || startPromise || controlPromise) return { ok: true, already: true };

    const attempt = ++generation;
    replacedBridgePid = readBridgeLockPid(bridgeDir);
    runner = null;
    stopped = false;
    operation = 'starting';
    startingSince = Date.now();
    lastStartAt = startingSince;
    lastError = '';

    startPromise = (async () => {
      try {
      if (!(await checkQq())) {
        if (attempt !== generation) return;
        const resolvedQqExe = await resolveQqExe(config, qqExe);
        if (!resolvedQqExe) throw new Error('找不到 QQ.exe；请安装 QQ 或在 qq-launcher 配置 qqExe');
        if (attempt !== generation) return;
        log('QQ 未运行，先拉起', resolvedQqExe);
        try {
          const child = spawn(resolvedQqExe, [], { detached: process.platform !== 'win32', stdio: 'ignore', windowsHide: true });
          await new Promise((resolve, reject) => {
            child.once('spawn', resolve);
            child.once('error', reject);
          });
          child.unref();
        } catch (error) {
          throw new Error(`拉起 QQ 失败：${error?.message ?? error}`);
        }
        const qqDeadline = Date.now() + 60_000;
        while (attempt === generation && Date.now() < qqDeadline && !(await checkQq())) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (attempt !== generation) return;
        if (!(await checkQq())) throw new Error('QQ 启动超时（60 秒），未检测到 QQ.exe');
      }

      if (attempt !== generation) return;
      log('启动 SnowLuma + 桥接', bridgeDir);
      const nodeBinary = deps.nodeBinary || await resolveNodeBinary(config);
      if (attempt !== generation) return;
      const child = (deps.spawnRunner || spawn)(nodeBinary, [path.join(bridgeDir, 'scripts', 'start-da-feiyu.mjs'), '--force', '--force-now'], {
        cwd: bridgeDir,
        detached: process.platform !== 'win32',
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, QQL_AUTOSTARTED_BY: 'dsh-titlebar', QQL_BOT_UIN: getSettings().botUin }
      });
      runner = child;
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.once('exit', (code, signal) => {
        if (attempt !== generation) return;
        void status().then(current => {
          if (attempt !== generation) return;
          if (!current.ready && startingSince > 0) {
            startingSince = 0;
            operation = '';
            lastError = current.phase === 'failed' && current.message ? current.message : `启动脚本提前退出（code=${code ?? 'null'} signal=${signal ?? 'null'}），查看 state/start-da-feiyu.log`;
            log(lastError);
          }
        }).catch(error => {
          if (attempt !== generation) return;
          startingSince = 0;
          lastError = `启动脚本退出后无法检查状态：${error?.message ?? error}`;
        });
      });
      child.unref();
      return { ok: true, startedAt: new Date(startingSince).toISOString(), bridgeDir, restarted: true };
      } catch (error) {
        if (attempt !== generation) return;
        startingSince = 0;
        operation = '';
        lastError = `启动失败：${error?.message ?? error}`;
        log(lastError);
        return { ok: false, error: lastError };
      } finally {
        startPromise = null;
      }
    })();
    return { ok: true, startedAt: new Date(startingSince).toISOString(), bridgeDir };
  }

  async function stopRuntime() {
    if (deps.stop) return deps.stop();
    const nodeBinary = await resolveNodeBinary(config);
    await new Promise((resolve, reject) => {
      execFile(nodeBinary, [path.join(bridgeDir, 'scripts', 'start-da-feiyu.mjs'), '--stop'],
        { cwd: bridgeDir, windowsHide: true, timeout: 45000 }, (error, stdout) => {
          if (error) reject(new Error(String(stdout || '').trim().split(/\r?\n/).slice(-2).join(' ') || error.message));
          else resolve();
        });
    });
    runner = null;
    gatewayRunner = null;
  }

  function gatewayLog(message) {
    log(message);
    try { fs.appendFileSync(path.join(bridgeDir, 'state', 'gateway-recovery.log'), `[${new Date().toISOString()}] ${message}\n`); } catch {}
  }

  function recoverGateway() {
    if (gatewayPromise) return gatewayPromise;
    const attempt = generation;
    gatewayPromise = (async () => {
      const required = requireBot();
      if (required) throw new Error(required.error);
      const nodeBinary = deps.nodeBinary || await resolveNodeBinary(config);
      if (disposed || stopped || operation === 'stopping' || attempt !== generation) return;
      gatewayError = '';
      gatewayLog('SnowLuma 进程消失：单独恢复网关，保留当前桥接');
      const output = fs.openSync(path.join(bridgeDir, 'state', 'gateway-recovery.log'), 'a');
      let proc;
      try {
        proc = spawn(nodeBinary, [path.join(bridgeDir, 'scripts', 'start-da-feiyu.mjs'), '--gateway-only'], {
          cwd: bridgeDir, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', output, output],
          env: { ...process.env, QQL_BOT_UIN: getSettings().botUin, QQL_AUTOSTARTED_BY: 'gateway-recovery' }
        });
      } finally { fs.closeSync(output); }
      gatewayRunner = proc;
      await new Promise((resolve, reject) => { proc.once('spawn', resolve); proc.once('error', reject); });
      proc.once('exit', (code, signal) => {
        gatewayLog(`网关守护退出：PID=${proc.pid} code=${code} signal=${signal}`);
        if (gatewayRunner === proc) gatewayRunner = null;
        if (!disposed && !stopped && operation !== 'stopping' && attempt === generation && code !== 0)
          gatewayError = `SnowLuma 守护退出（${code ?? signal}），查看 gateway-recovery.log`;
      });
      proc.unref();
    })().catch(error => { gatewayError = error.message; gatewayLog('网关恢复失败：' + error.message); })
      .finally(() => { gatewayPromise = null; });
    return gatewayPromise;
  }

  const gatewayRecovery = createGatewayRecovery({
    inspect: async () => {
      if (disposed || stopped || starting() || operation === 'stopping' || controlPromise || startPromise || deps.settingsRoot) return {};
      const health = await checkHealth({ root: bridgeDir, timeoutMs: 1500 });
      if (health?.components?.console !== 'ok') return {};
      const cfg = readBridgeConfig(bridgeDir);
      const configured = !requireBot();
      const [http, ws] = await Promise.all([
        probe(urlPort(cfg.snowluma?.httpUrl, SNOWLUMA_HTTP_PORT)), probe(urlPort(cfg.snowluma?.wsUrl, SNOWLUMA_WS_PORT))
      ]);
      if (http || ws || !configured) return { http, ws, configured };
      const home = resolveSnowHome(cfg);
      if (gatewayRunner && pidAlive(gatewayRunner.pid)) return { gatewayRunning: true };
      const raw = await execFileText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine)'], 10000);
      if (!raw) return {}; // Unknown process evidence must not trigger a restart.
      const processes = JSON.parse(raw);
      const entry = path.join(bridgeDir, 'scripts', 'start-da-feiyu.mjs');
      const gatewayRunning = processes.some(p => processRunsFile(p.CommandLine, path.join(home, 'index.mjs'))
        || (processRunsFile(p.CommandLine, entry) && /(?:^|\s)--gateway-only(?:\s|$)/.test(p.CommandLine)));
      return { bridgeRunning: true, configured, qqRunning: await checkQq(), gatewayRunning, http, ws };
    },
    recover: recoverGateway,
    onError: error => { gatewayError = error.message; }
  });
  const gatewayTimer = setInterval(() => { void gatewayRecovery.tick(); }, 15000);
  gatewayTimer.unref?.();

  function control(restart) {
    if (restart) { const required = requireBot(); if (required) return required; }
    if (!bridgeDir) return { ok: false, error: '找不到桥接仓库' };
    if (controlPromise) return { ok: true, already: true };
    ++generation; // Cancel QQ checks and ignore late exit events before doing any stop work.
    startingSince = 0;
    operation = 'stopping';
    stopped = false;
    lastError = '';
    controlPromise = (async () => {
      try {
        // The generation guard prevents a cancelled pending start from spawning after stop.
        await stopRuntime();
        stopped = true;
        operation = '';
      } catch (error) {
        lastError = `关闭失败：${error?.message || error}`;
        operation = '';
      } finally {
        controlPromise = null;
      }
      if (restart && stopped) {
        if (startPromise) await startPromise;
        startBridge();
      }
    })();
    return { ok: true, status: restart ? 'restarting' : 'stopping' };
  }

  async function liveWhitelist(method = 'GET', payload) {
    if (deps.settingsRoot) return null; // Isolated test fixtures must never touch the live bot.
    const cfg = readBridgeConfig(bridgeDir);
    const port = Number(cfg.consolePort) || BRIDGE_CONSOLE_PORT;
    const response = await fetch(`http://127.0.0.1:${port}/api/whitelist`, {
      method, headers: { 'x-console-token': resolveConsoleToken(bridgeDir, cfg), 'content-type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(1800)
    });
    if (!response.ok) throw new Error(`桥接配置接口 HTTP ${response.status}`);
    return response.json();
  }

  async function settingsView() {
    const settings = getSettings();
    let runtime = null;
    try { runtime = await liveWhitelist(); } catch {}
    return { ...settings, ...(runtime ? { ownerQQ: runtime.ownerQQ, allow: runtime.allow } : {}),
      ok: true, configured: !!settings.botUin, live: !!runtime, source: runtime ? 'config.json + bridge /api/whitelist' : 'config.json' };
  }

  async function saveSettings(body) {
    if (starting() || operation === 'stopping' || savingSettings) {
      const error = new Error('启动或关闭正在进行，请完成后再修改设置'); error.status = 409; throw error;
    }
    validateBotUin(body.botUin);
    savingSettings = true;
    try {
      const saved = saveLauncherSettings(settingsRoot, body);
      let applied = false, ownerSynced = false;
      try { applied = !!(await liveWhitelist('POST', { ownerQQ: saved.ownerQQ, allow: saved.allow })); } catch {}
      const cfg = readBridgeConfig(bridgeDir);
      if (!deps.settingsRoot && cfg.dsh?.baseUrl && body.ownerQQ !== undefined) {
        try {
          const api = new NodeApiClient(cfg.dsh.baseUrl, 2500, {});
          unwrap(await api.settings.update({ ns: 'qq-mode', patch: { ownerQQ: String(saved.ownerQQ ?? '') } }), 'settings.update');
          ownerSynced = true;
        } catch {}
      }
      return { ...saved, ok: true, configured: true, live: applied,
        message: applied ? (ownerSynced ? '管理员和白名单已实时生效；机器人 QQ 在下次启动时使用' : '白名单已实时更新；管理员同步状态待确认，机器人 QQ 在下次启动时使用')
          : '已保存到真实配置；bot 下次启动时生效' };
    } finally { savingSettings = false; }
  }

  async function readBody(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('请使用 JSON 提交设置');
    let text = '';
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 16384) throw new Error('设置内容过长'); }
    return JSON.parse(text);
  }

  function send(res, code, body) {
    const text = JSON.stringify(body);
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS'
    });
    res.end(text);
  }

  const server = http.createServer((req, res) => {
    if (req.headers.origin) {
      let local = false;
      try {
        const origin = new URL(req.headers.origin);
        local = ['http:', 'https:'].includes(origin.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
        local ||= origin.protocol === 'dsh-app:' && origin.hostname === 'app';
      } catch {}
      if (!local) { send(res, 403, { ok: false, error: '仅允许本机 DSH 页面访问启动器设置' }); return; }
    }
    const url = String(req.url || '');
    const route = url.split('?')[0];
    if (req.method === 'OPTIONS') {
      send(res, 204, {});
      return;
    }
    if (req.method === 'GET' && (route === '/status' || route === '/')) {
      status()
        .then((body) => send(res, 200, body))
        .catch((error) => send(res, 500, { ok: false, error: String(error?.message ?? error) }));
      return;
    }
    if (req.method === 'GET' && route === '/config') {
      settingsView().then(body => send(res, 200, body)).catch(error => send(res, 500, { ok: false, error: error.message }));
      return;
    }
    if (req.method === 'POST' && route === '/config') {
      readBody(req).then(saveSettings).then(body => send(res, 200, body))
        .catch(error => send(res, error.status || 400, { ok: false, error: error.message }));
      return;
    }
    if (req.method === 'POST' && route === '/recover-gateway') {
      const required = requireBot();
      if (required) { send(res, 409, required); return; }
      void gatewayRecovery.tick();
      send(res, 202, { ok: true, status: 'gateway_check' });
      return;
    }
    if (req.method === 'POST' && route === '/start') {
      const body = startBridge();
      send(res, body.ok ? 202 : body.code === 'BOT_QQ_REQUIRED' ? 409 : 500, { ...body, status: body.ok ? 'starting' : 'failed' });
      return;
    }
    if (req.method === 'POST' && (route === '/restart' || route === '/stop')) {
      const body = control(route === '/restart');
      send(res, body.ok ? 202 : body.code === 'BOT_QQ_REQUIRED' ? 409 : 500, body);
      return;
    }
    send(res, 404, { ok: false, error: 'not found' });
  });

  server.on('error', (error) => {
    lastError = `本地端口 ${port} 监听失败：${error?.message ?? error}`;
    log(lastError);
  });

  server.listen(port, '127.0.0.1', () => {
    log(`监听 http://127.0.0.1:${port} ; bridgeDir=${bridgeDir ?? '(未找到)'} ; qqExe=${qqExe}`);
  });

  const dispose = () => {
    disposed = true;
    clearInterval(gatewayTimer);
    gatewayRecovery.dispose();
    ++generation; // Cancel pending QQ checks without terminating a running bridge.
    try {
      server.close();
    } catch {}
  };
  dispose.server = server;
  return dispose;
}

export function apply(ctx, config) {
  const dispose = createLauncher(ctx ?? {}, config ?? {});
  if (typeof ctx?.effect === 'function') ctx.effect(() => dispose);
  else if (typeof ctx?.on === 'function') ctx.on('dispose', dispose);
  return dispose;
}

