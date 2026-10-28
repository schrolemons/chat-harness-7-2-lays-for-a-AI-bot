// Reuse SnowLuma's own account detection and load operation, scoped to the bot UIN.
// Hook adoption is independent of auto-load: a DLL can survive SnowLuma restarts.
// Scope the OneBot subscription before any account is adopted, so a restored
// non-bot session cannot bind the bot's HTTP/WS ports. Keep QQ sessions untouched.
const isTarget = (actual, expected) => /^[1-9]\d{4,19}$/.test(String(expected || '')) && String(actual || '') === String(expected);
export function targetSessionSource(manager, uin) {
  return {
    subscribeSessions(listener) {
      return manager.subscribeSessions({
        started: (actualUin, ...args) => {
          if (isTarget(actualUin, uin)) listener.started?.(actualUin, ...args);
        },
        closed: (actualUin, ...args) => {
          if (isTarget(actualUin, uin)) listener.closed?.(actualUin, ...args);
        }
      });
    }
  };
}

export function requireTargetAccount(manager, pid, uin) {
  if (!isTarget(manager.accounts.get(pid)?.uin, uin)) throw new Error('账号未确认为指定机器人 QQ，拒绝连接或操作 hook');
}

export async function verifyTargetProcess(manager, pid, uin) {
  manager.assertValidPid(pid);
  await manager.startPromise;
  manager.ensureSession(pid);
  manager.invalidateAccounts();
  await manager.refreshAccounts();
  requireTargetAccount(manager, pid, uin);
}

export async function adoptOnlyTarget(manager, session, uin) {
  try {
    manager.invalidateAccounts();
    await manager.refreshAccounts();
    if (isTarget(manager.accounts.get(session.pid)?.uin, uin)) session.onPipeUp();
  } catch { /* No identity evidence means no pipe connection. */ }
}

export async function reconcileTargetAccount(manager, uin) {
  const processes = await manager.listProcesses();
  for (const proc of processes) {
    const account = String(proc.account?.uin || '');
    if (isTarget(account, uin)) {
      if (!proc.connected && !['loading', 'connecting'].includes(proc.status)) await manager.loadProcess(proc.pid);
    }
  }
}

export function startTargetAccount(manager, uin) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await reconcileTargetAccount(manager, uin); }
    catch (error) { console.error('[qq-launcher] bot account load:', error?.message || error); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, 2000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
