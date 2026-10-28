import './hidden-process-preload.mjs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// No changes to the vendor bundle on disk, and no WebUI authentication changes.
// Apply a checked startup adapter to this one entry only, in updater and worker.
export function scopeSnowSource(source, uin, helperUrl) {
  if (!/^[1-9]\d{4,19}$/.test(String(uin))) throw Error('缺少明确的 bot QQ 账号，拒绝全账号自动加载');
  const anchor = 'const notificationManager = createNotificationManager(';
  const networkAnchor = 'oneBotManager.bind(bridgeManager);';
  if (source.split(anchor).length !== 2 || source.split(networkAnchor).length !== 2) throw Error('SnowLuma 启动接口已变化，拒绝自动加载；请检查版本');
  const start = source.indexOf('var HookManager = class {');
  const end = source.indexOf('\nfunction isTransientLibcMappingError(', start);
  if (start < 0 || end < 0) throw Error('SnowLuma hook 接口已变化，拒绝跨账号连接');
  let hook = source.slice(start, end);
  const clientAnchor = 'this.makeClient = deps.makeClient ?? ((pid) => new QqHookClient(pid));';
  if (hook.split(clientAnchor).length !== 2 || hook.split('session.onPipeUp();').length !== 3) throw Error('SnowLuma pipe 接口已变化，拒绝跨账号连接');
  const account = JSON.stringify(String(uin));
  hook = hook.replace(clientAnchor,
    `const nativeInjector = this.injector;\n` +
    `this.injector = {inject: async(pid) => {await __qqAccountAdapter.verifyTargetProcess(this,pid,${account});return nativeInjector.inject(pid);},` +
    `unload: async(pid) => {await __qqAccountAdapter.verifyTargetProcess(this,pid,${account});return nativeInjector.unload(pid);}};\n` +
    `this.makeClient = (pid) => {__qqAccountAdapter.requireTargetAccount(this,pid,${account});return (deps.makeClient ?? ((targetPid) => new QqHookClient(targetPid)))(pid);};`);
  hook = hook.replaceAll('session.onPipeUp();', `void __qqAccountAdapter.adoptOnlyTarget(this,session,${account});`);
  for (const method of ['loadProcess', 'refreshProcess', 'unloadProcess']) {
    const methodAnchor = `async ${method}(pid) {`;
    if (hook.split(methodAnchor).length !== 2) throw Error('SnowLuma 账号操作接口已变化，拒绝启动');
    hook = hook.replace(methodAnchor, `${methodAnchor}\nawait __qqAccountAdapter.verifyTargetProcess(this,pid,${account});`);
  }
  const loginAnchor = 'session.on("login", (uin, sender) => {';
  if (hook.split(loginAnchor).length !== 2) throw Error('SnowLuma 登录接口已变化，拒绝启动');
  hook = hook.replace(loginAnchor, `${loginAnchor}\nif(String(uin)!==${account}){session.dispose();return;}`);
  source = source.slice(0, start) + hook + source.slice(end);
  return `const __qqAccountAdapter = await import(${JSON.stringify(helperUrl)});\n` + source.replace(networkAnchor,
    `oneBotManager.bind(__qqAccountAdapter.targetSessionSource(bridgeManager, ${account}));`)
    .replace(anchor,
    `__qqAccountAdapter.startTargetAccount(hookManager, ${account});\n\t` + anchor);
}

if (process.env.SNOWLUMA_BRIDGE_ENTRY) {
  const entry = pathToFileURL(process.env.SNOWLUMA_BRIDGE_ENTRY).href;
  const helper = new URL('./snow-target-account.mjs', import.meta.url).href;
  registerHooks({ load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== entry) return result;
    const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    return { ...result, source: scopeSnowSource(source, process.env.SNOWLUMA_BRIDGE_UIN, helper) };
  } });
}
