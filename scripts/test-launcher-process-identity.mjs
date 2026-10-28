import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processRunsFile, stopVerifiedRecords } from './launcher-process-identity.mjs';

test('识别移动目录和改名运行时；不把脚本参数、备份或终端包装器当成目标进程', () => {
  assert.equal(processRunsFile('"D:\\portable\\runtime.exe" --import "D:\\hidden preload.mjs" "E:\\My Bot\\src\\bridge.js"', 'E:/My Bot/src/bridge.js'), true);
  assert.equal(processRunsFile('node "E:/My Bot/src/bridge.js.bak"', 'E:/My Bot/src/bridge.js'), false);
  assert.equal(processRunsFile('node -e "console.log(1)" "E:/My Bot/src/bridge.js"', 'E:/My Bot/src/bridge.js'), false);
  assert.equal(processRunsFile('powershell.exe -Command "node E:/My Bot/src/bridge.js"', 'E:/My Bot/src/bridge.js'), false);
  assert.equal(processRunsFile('node "other.js" "E:/My Bot/src/bridge.js"', 'E:/My Bot/src/bridge.js'), false);
});

test('清理前 PID 被复用时不终止新进程；身份未变才执行停止', async () => {
  const old = { ProcessId: 10, CreationDate: 'yesterday', CommandLine: 'node bot.js' };
  const killed = [];
  await stopVerifiedRecords([old], { list: async () => [{ ...old, CreationDate: 'today' }], stop: async pid => { killed.push(pid); return true; } });
  assert.deepEqual(killed, []);
  await stopVerifiedRecords([old], { list: async () => [old], stop: async pid => { killed.push(pid); return true; } });
  assert.deepEqual(killed, [10]);
});
