import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { buildSnowLaunch, ensureSnowLuma, commandHasFile, lockPidReused, selectBotProcesses } from './start-da-feiyu.mjs';
import { hiddenOptions } from './hidden-process-preload.mjs';

test('Windows 子进程隐藏窗口且不创建 detached 控制台，保留 IPC 与 cwd', () => {
  const options = hiddenOptions({ detached: true, stdio: ['ignore','inherit','inherit','ipc'], cwd: 'fixture' }, 'win32');
  assert.equal(options.windowsHide, true);
  assert.equal(options.detached, false);
  assert.equal(options.stdio[3], 'ipc');
  assert.equal(options.cwd, 'fixture');
});

test('停止时仅匹配完整脚本路径，不能命中其他目录、备份或命令参数前缀', () => {
  assert.equal(commandHasFile('node "C:\\Bot\\scripts\\start-da-feiyu.mjs" --force', 'C:/Bot/scripts/start-da-feiyu.mjs'), true);
  assert.equal(commandHasFile('node "C:\\Bot\\scripts\\start-da-feiyu.mjs.bak"', 'C:/Bot/scripts/start-da-feiyu.mjs'), false);
  assert.equal(commandHasFile('node "C:\\Other\\scripts\\start-da-feiyu.mjs"', 'C:/Bot/scripts/start-da-feiyu.mjs'), false);
});

test('跨开机 PID 复用只清理旧锁，不能终止新进程；证据不足时保留锁', () => {
  assert.equal(lockPidReused(1000, 9000), true);
  assert.equal(lockPidReused(9000, 1000), false);
  assert.equal(lockPidReused(1000, NaN), false);
  assert.equal(lockPidReused(NaN, 9000), false);
});

test('初始化尚未写锁时，仍能识别当前桥接和相对路径启动的父守护；不匹配别的仓库', () => {
  const list = [
    { ProcessId: 1, CommandLine: 'node scripts/start-da-feiyu.mjs' },
    { ProcessId: 2, ParentProcessId: 1, CommandLine: 'node "C:/Bot/src/bridge.js"' },
    { ProcessId: 3, CommandLine: 'node scripts/start-da-feiyu.mjs' },
    { ProcessId: 4, ParentProcessId: 3, CommandLine: 'node "C:/Other/src/bridge.js"' },
    { ProcessId: 5, CommandLine: 'node "C:/Bot/scripts/start-da-feiyu.mjs"' }
  ];
  const selected = selectBotProcesses(list, 'C:/Bot', 5);
  assert.deepEqual(selected.supervisors.map(x => x.ProcessId), [1]);
  assert.deepEqual(selected.bridges.map(x => x.ProcessId), [2]);
});

test('冷启动启用 QQ 自动加载，并把隐藏进程预加载器传入 SnowLuma', () => {
  const previousUin = process.env.QQL_BOT_UIN;
  process.env.QQL_BOT_UIN = '987654321'; // Stale inherited value must not beat the saved setting.
  const launch = buildSnowLaunch('C:/SnowLuma/launcher.bat', '20009');
  if (previousUin === undefined) delete process.env.QQL_BOT_UIN; else process.env.QQL_BOT_UIN = previousUin;
  assert.equal(launch.options.env.QQL_BOT_UIN, '20009');
  assert.equal(launch.options.env.SNOWLUMA_HOOK_AUTOLOAD, '0');
  assert.equal(launch.options.env.SNOWLUMA_BRIDGE_UIN, '20009');
  assert.equal(launch.options.windowsHide, true);
  assert.equal(launch.options.detached, process.platform !== 'win32');
  assert.equal(launch.args[0], '--import');
  assert.match(launch.args[1], /snow-bootstrap\.mjs$/);
});

test('SnowLuma 未登录时等待恢复，不能因旧的 90 秒阈值提前退出', async () => {
  let elapsed = 0, starts = 0;
  const phases = [];
  const ok = await ensureSnowLuma({ snowluma: { launcherPath: 'fixture/launcher.bat' } }, {
    info: async () => ({ ok: elapsed >= 100_000, nickname: 'fixture' }),
    botUin: '20009',
    exists: () => true,
    stopStale: async () => true,
    launch: async () => { starts++; return new EventEmitter(); },
    sleep: async ms => { elapsed += ms; },
    now: () => elapsed,
    progress: (phase) => phases.push(phase)
  });
  assert.equal(ok, true);
  assert.equal(starts, 1);
  assert.ok(phases.includes('waiting_gateway'));
});

test('SnowLuma 异步启动失败立即报告，不抛未处理 error 或等待五分钟', async () => {
  const child = new EventEmitter();
  let elapsed = 0;
  assert.equal(await ensureSnowLuma({ snowluma: { launcherPath: 'fixture/launcher.bat' } }, {
    info: async () => ({ ok: false }), exists: () => true, botUin: '20009',
    stopStale: async () => true, launch: async () => child,
    sleep: async ms => { elapsed += ms; child.emit('error', Error('spawn denied')); },
    now: () => elapsed, progress: () => {}
  }), false);
  assert.ok(elapsed < 10_000);
});

test('隐藏设置跨 SnowLuma 更新器的二次 spawn 传播，同时保留 IPC', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-hidden-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // The middle process imitates SnowLuma's updater: no windowsHide in its spawn options.
  const child = path.join(dir, 'child.mjs');
  fs.writeFileSync(child, `import {spawn} from 'node:child_process';
    const p=spawn(process.execPath,[...process.execArgv,'-e','process.send({ok:true})'],{stdio:['ignore','pipe','pipe','ipc']});
    p.on('message',m=>console.log(JSON.stringify(m)));`);
  const preload = new URL('./hidden-process-preload.mjs', import.meta.url);
  const r = spawnSync(process.execPath, ['--import', preload.href, child], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"ok":true/);
});
