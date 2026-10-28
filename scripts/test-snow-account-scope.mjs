import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTargetAccount, targetSessionSource, adoptOnlyTarget, requireTargetAccount, verifyTargetProcess } from './snow-target-account.mjs';
import { scopeSnowSource } from './snow-bootstrap.mjs';

test('两个 QQ 同时运行时只加载 bot；登录前无账号信息则等待', async () => {
  const loaded = [], unloaded = [];
  const manager = {
    listProcesses: async () => [
      { pid: 1, account: { uin: '111111' }, connected: false },
      { pid: 2, account: { uin: '222222' }, connected: false },
      { pid: 3, account: null, connected: false }
    ],
    loadProcess: async pid => loaded.push(pid), unloadProcess: async pid => unloaded.push(pid)
  };
  await reconcileTargetAccount(manager, '222222');
  assert.deepEqual(loaded, [2]);
  assert.deepEqual(unloaded, []);
});

test('已连接 bot 和正在加载的 bot 不重复注入', async () => {
  const manager = { listProcesses: async () => [
    { pid: 1, uin: '222222', connected: true },
    { pid: 2, account: { uin: '222222' }, status: 'connecting' }
  ], loadProcess: () => assert.fail('duplicate injection') };
  await reconcileTargetAccount(manager, '222222');
});

test('不加载、不刷新、不卸载其他账号的旧 hook，即使遗留环境变量要求卸载', async () => {
  const unloaded = [];
  const manager = { listProcesses: async () => [{ pid: 1, uin: '111111', injected: true }],
    unloadProcess: async pid => unloaded.push(pid) };
  await reconcileTargetAccount(manager, '222222', true);
  assert.deepEqual(unloaded, []);
});

test('启动适配只插入账号加载，保留原程序；缺少账号或版本接口变化时拒绝启动', () => {
  const src = `var HookManager = class {
constructor(deps){this.makeClient = deps.makeClient ?? ((pid) => new QqHookClient(pid));}
async loadProcess(pid) { }
async refreshProcess(pid) { }
async unloadProcess(pid) { }
bindWatcher(){session.onPipeUp();session.onPipeUp();}
login(){session.on("login", (uin, sender) => {});}
};
function isTransientLibcMappingError(error){}
oneBotManager.bind(bridgeManager); const hookManager = {}; const notificationManager = createNotificationManager(fn);`;
  const patched = scopeSnowSource(src, '222222', 'file:///fixture.mjs');
  assert.ok(patched.endsWith('const notificationManager = createNotificationManager(fn);'));
  assert.match(patched, /startTargetAccount\(hookManager, "222222"/);
  assert.match(patched, /targetSessionSource\(bridgeManager, "222222"\)/);
  assert.throws(() => scopeSnowSource(src, '', 'fixture'), /明确的 bot/);
  assert.throws(() => scopeSnowSource('changed vendor', '222222', 'fixture'), /启动接口已变化/);
});

test('自动接管前重新核实账号；其他账号和未知身份均不能打开 pipe 客户端', async()=>{
  const adopted=[];
  const manager={accounts:new Map([[1,{uin:'111111'}],[2,{uin:'222222'}]]),invalidateAccounts(){},refreshAccounts:async()=>{}};
  for(const pid of [1,2,3])await adoptOnlyTarget(manager,{pid,onPipeUp(){adopted.push(pid);}},'222222');
  assert.deepEqual(adopted,[2]);
  assert.throws(()=>requireTargetAccount(manager,1,'222222'),/指定机器人/);
  assert.throws(()=>requireTargetAccount(manager,3,'222222'),/指定机器人/);
  assert.doesNotThrow(()=>requireTargetAccount(manager,2,'222222'));
});

test('加载、刷新等操作使用新账号证据；PID 对应账号改变后拒绝旧身份', async()=>{
  const manager={startPromise:Promise.resolve(),accounts:new Map([[2,{uin:'222222'}]]),
    assertValidPid(){},ensureSession(){},invalidateAccounts(){},refreshAccounts:async()=>{manager.accounts.set(2,{uin:'111111'});}};
  await assert.rejects(verifyTargetProcess(manager,2,'222222'),/指定机器人/);
});

test('旧 hook 恢复的其他账号不能创建 OneBot 接口或抢占机器人端口', () => {
  let receiver, unsubscribed = false;
  const manager = { subscribeSessions(listener) { receiver = listener; return () => { unsubscribed = true; }; } };
  const started = [], closed = [];
  const stop = targetSessionSource(manager, '222222').subscribeSessions({
    started: (...args) => started.push(args), closed: (...args) => closed.push(args)
  });
  // Both are already logged in; the unrelated account is adopted first.
  receiver.started('111111', { cachedHook: true });
  receiver.started('222222', { bot: true });
  receiver.closed('111111', {}, 10);
  receiver.closed('222222', {}, 20);
  assert.deepEqual(started.map(args => args[0]), ['222222']);
  assert.deepEqual(closed.map(args => args[0]), ['222222']);
  assert.equal(closed[0][2], 20);
  stop(); assert.equal(unsubscribed, true);
});
