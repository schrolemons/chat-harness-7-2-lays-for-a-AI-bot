// qq-launcher —— DSH 标题栏「一键启动小鲸鱼」的 Host 半边。
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

export const name = 'qq-launcher';
export const inject = [];

const DEFAULT_PORT = 3199;
const SNOWLUMA_HTTP_PORT = 3000;
const SNOWLUMA_WS_PORT = 3001;
const BRIDGE_CONSOLE_PORT = 3100;

/** 启动流程最长占用多久的“黄灯”，超时后回到红/绿实测状态。 */
const STARTING_TTL_MS = 300_000;
/** QQ 刚被拉起后等它把 hook 挂上，再启动 SnowLuma/桥接。 */
const QQ_BOOT_WAIT_MS = 12_000;

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
      execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
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
  candidates.push(path.join(process.cwd(), 'qq-bridge-0.2.1-r1'));
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

function readDshPort(bridgeDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'config.json'), 'utf8'));
    const raw = String(cfg?.dsh?.baseUrl || '');
    const match = /:(\d+)/.exec(raw);
    return match ? Number.parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

function createLauncher(ctx, config) {
  const port = Number.isInteger(config?.servicePort) && config.servicePort > 0 ? config.servicePort : DEFAULT_PORT;
  const qqExe = typeof config?.qqExe === 'string' && config.qqExe.trim() ? config.qqExe.trim() : (process.env.QQ_EXE || '');
  const bridgeDir = resolveBridgeDir(config);

  let startingSince = 0;
  let lastStartAt = 0;
  let lastError = '';

  const starting = () => startingSince > 0 && Date.now() - startingSince < STARTING_TTL_MS;

  async function status() {
    const [qq, snowluma, snowlumaWs, bridge] = await Promise.all([
      isQqRunning(),
      tcpProbe(SNOWLUMA_HTTP_PORT),
      tcpProbe(SNOWLUMA_WS_PORT),
      tcpProbe(BRIDGE_CONSOLE_PORT)
    ]);
    const lockPid = bridgeDir ? readBridgeLockPid(bridgeDir) : null;
    const bridgePidAlive = pidAlive(lockPid);
    // QQ 进程探测是 best-effort（tasklist 在受限上下文里会 EPERM）；
    // 真正的判据用 SnowLuma 与桥接是否在监听：SnowLuma 起得来就说明 QQ 挂着。
    const health = bridgeDir ? await readBridgeHealth({ root: bridgeDir, timeoutMs: 1500 }) : null;
    let presetsReady = false;
    if (health?.healthy) {
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'config.json'), 'utf8'));
        const response = await fetch(`http://127.0.0.1:${cfg.consolePort || 3100}/api/presets`, {
          headers: { 'x-console-token': resolveConsoleToken(bridgeDir, cfg) },
          signal: AbortSignal.timeout(2000)
        });
        const data = await response.json();
        const ids = new Set((data.presets || []).map(p => p.id));
        presetsReady = response.ok && ['qq-chat', 'qq-chat-v2', 'qq-chat-dev', 'qq-task-worker'].every(id => ids.has(id));
      } catch {}
    }
    const ready = health?.healthy === true && presetsReady;
    if (ready) startingSince = 0;
    let light = 'red';
    if (starting() && !ready) light = 'amber';
    else if (ready) light = 'green';
    return {
      ok: true,
      at: new Date().toISOString(),
      light,
      starting: starting(),
      ready,
      checks: {
        qq,
        snowluma,
        snowlumaWs,
        bridge,
        bridgePid: lockPid,
        bridgePidAlive,
        presetsReady,
        health: health?.verdict || 'unknown',
        dshPort: bridgeDir ? readDshPort(bridgeDir) : null
      },
      bridgeDir,
      lastStartAt: lastStartAt ? new Date(lastStartAt).toISOString() : null,
      lastError
    };
  }

  async function startBridge() {
    if (!bridgeDir) {
      lastError = '找不到桥接仓库（缺少 scripts/start-da-feiyu.mjs）';
      return { ok: false, error: lastError };
    }
    if (starting()) return { ok: true, already: true, startedAt: new Date(startingSince).toISOString() };
    // 已运行的实例不重复启动，更不因红灯而强杀进程。
    if (pidAlive(readBridgeLockPid(bridgeDir))) return { ok: true, already: true };

    startingSince = Date.now();
    lastStartAt = startingSince;
    lastError = '';

    try {
      if (!(await isQqRunning())) {
        if (!qqExe || !fs.existsSync(qqExe)) {
          startingSince = 0;
          lastError = '请先启动并登录 QQ，或安装时用 --qq-exe 配置自己的 QQ 路径';
          return { ok: false, error: lastError };
        }
        log('QQ 未运行，先拉起', qqExe);
        try {
          const child = spawn(qqExe, [], { detached: true, stdio: 'ignore', windowsHide: false });
          child.once('error', error => { startingSince = 0; lastError = error.message; });
          child.unref();
        } catch (error) {
          lastError = `拉起 QQ 失败：${error?.message ?? error}`;
          log(lastError);
        }
        await new Promise((resolve) => setTimeout(resolve, QQ_BOOT_WAIT_MS));
      }

      log('启动 SnowLuma + 桥接', bridgeDir);
      const nodeBinary = config?.nodePath || (process.versions.electron
        ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe')
        : process.execPath);
      if (!fs.existsSync(nodeBinary)) throw new Error('找不到 Node.js：' + nodeBinary);
      const child = spawn(nodeBinary, [path.join('scripts', 'start-da-feiyu.mjs')], {
        cwd: bridgeDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, QQL_AUTOSTARTED_BY: 'dsh-titlebar' }
      });
      child.once('error', error => {
        startingSince = 0;
        lastError = `启动失败：${error.message}`;
      });
      child.unref();
      return { ok: true, startedAt: new Date(startingSince).toISOString(), bridgeDir };
    } catch (error) {
      startingSince = 0;
      lastError = `启动失败：${error?.message ?? error}`;
      log(lastError);
      return { ok: false, error: lastError };
    }
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
    if (req.method === 'POST' && route === '/start') {
      startBridge()
        .then((body) => send(res, body.ok ? 200 : 500, { ...body, status: 'started' }))
        .catch((error) => send(res, 500, { ok: false, error: String(error?.message ?? error) }));
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

  return () => {
    try {
      server.close();
    } catch {}
  };
}

export function apply(ctx, config) {
  const dispose = createLauncher(ctx ?? {}, config ?? {});
  if (typeof ctx?.effect === 'function') ctx.effect(() => dispose);
  else if (typeof ctx?.on === 'function') ctx.on('dispose', dispose);
  return dispose;
}

