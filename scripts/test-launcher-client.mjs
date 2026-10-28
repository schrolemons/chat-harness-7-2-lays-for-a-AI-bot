import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

async function page(t, options = {}) {
  const nodes = new Map(), requests = [], opened = [];
  const roots = [], timers = new Set(), resizeListeners = new Set();
  let status = { light: 'red', starting: false, checks: {} }, api;
  let settings = { configured: !options.unconfigured, botUin: options.unconfigured ? '' : '10608', ownerQQ: 234567890,
    allow: { private: [345678901], groups: [456789012] }, revision: 'fixture' };
  const element = () => ({ style: {}, dataset: {}, handlers: {}, isConnected: true,
    children: [],
    focus() {},
    setAttribute() {}, append(...children) { this.children.push(...children); },
    remove() { this.isConnected = false; },
    addEventListener(event, fn) { this.handlers[event] = fn; },
    set id(v) { nodes.set(v, this); }, getBoundingClientRect: () => ({ width: 140, right: 180, height: 40 })
  });
  const body = element();
  body.append = host => { roots.push(host); };
  const document = { createElement: element, body, documentElement: element(), querySelector: () => element(),
    querySelectorAll: () => roots.filter(host => host.isConnected) };
  const context = vm.createContext({ document, AbortSignal, Date, console, MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => { const id = {}; timers.add(id); return id; }, clearInterval(id) { timers.delete(id); },
    window: { __ModuleLoader__: { load: mod => { api = mod.factory(() => ({})); } },
      open: (...args) => opened.push(args), addEventListener(event, fn) { resizeListeners.add(fn); },
      removeEventListener(event, fn) { resizeListeners.delete(fn); } },
    fetch: async (url, options = {}) => {
      if (url.endsWith('/config')) {
        if (options.method === 'POST') {
          requests.push(url);
          settings = { ...JSON.parse(options.body), configured: true, ok: true };
        }
        return { ok: true, json: async () => settings };
      }
      if (options.method === 'POST') {
        requests.push(url);
        if (url.endsWith('/stop')) status = { light: 'red', stopped: true, starting: false, checks: {} };
        else status = { light: 'amber', starting: true, checks: {} };
      }
      return { ok: true, json: async () => options.method === 'POST' ? { ok: true } : status };
    }
  });
  const source = fs.readFileSync(new URL('../plugins/qq-launcher/lib/client.js', import.meta.url), 'utf8');
  let dispose;
  const reload = async () => {
    const previousDispose = dispose;
    vm.runInContext(source, context);
    dispose = undefined;
    api.apply({ on(event, fn) { if (event === 'dispose') dispose = fn; } });
    await flush();
    return previousDispose;
  };
  const flush = () => new Promise(r => setTimeout(r, 15));
  await reload();
  t.after(() => { dispose?.(); });
  const click = async id => { await nodes.get(id).handlers.click(); await flush(); };
  return { nodes, requests, opened, click, reload, dispose: () => dispose?.(), roots, timers, resizeListeners,
    setStatus: async value => { status = value; await reload(); },
    submit: async () => { await nodes.get('qq-launcher-settings-form').handlers.submit({ preventDefault() {} }); await flush(); } };
}

test('第一次点击启动，启动期间第二次点击打开控制台且不重复启动', async t => {
  const p = await page(t);
  await p.click('qq-launcher-button');
  await p.click('qq-launcher-button');
  assert.equal(p.requests.length, 1);
  assert.ok(p.requests[0].endsWith('/start'));
  assert.equal(p.opened.length, 1);
  assert.equal(p.opened[0][0], 'http://127.0.0.1:3100');
});

test('设置按钮展开真实字段；缺少必填机器人 QQ 时启动先引导，取消不启动', async t => {
  const p = await page(t, { unconfigured: true });
  await p.click('qq-launcher-button');
  assert.equal(p.requests.length, 0);
  assert.equal(p.nodes.get('qq-launcher-settings-panel').style.display, 'block');
  assert.equal(p.nodes.get('qq-launcher-bot-qq').required, true);
  assert.equal(p.nodes.get('qq-launcher-owner-qq').value, '234567890');
  assert.equal(p.nodes.get('qq-launcher-allow-private').value, '345678901');
  await p.click('qq-launcher-settings-cancel');
  assert.equal(p.requests.length, 0);
});

test('引导表单空值不能启动；填写后保存真实数据并继续启动', async t => {
  const p = await page(t, { unconfigured: true });
  await p.click('qq-launcher-button');
  await p.submit();
  assert.equal(p.requests.length, 0);
  p.nodes.get('qq-launcher-bot-qq').value = '10608';
  await p.submit();
  assert.deepEqual(p.requests.map(url => url.split('/').at(-1)), ['config', 'start']);
});

test('信号灯右侧提供独立重启和关闭；关闭后主按钮恢复启动', async t => {
  const p = await page(t);
  assert.equal(p.nodes.get('qq-launcher-restart').textContent, '重启');
  assert.equal(p.nodes.get('qq-launcher-stop').textContent, '关闭');
  await p.click('qq-launcher-restart');
  await p.click('qq-launcher-stop');
  await p.click('qq-launcher-button');
  assert.deepEqual(p.requests.map(url => url.split('/').at(-1)), ['restart', 'stop', 'start']);
  assert.equal(p.opened.length, 0);
});

test('标题栏已经存在的快速挂载路径也注册卸载清理', async t => {
  const p = await page(t);
  assert.equal(p.roots.filter(x => x.isConnected).length, 1);
  p.dispose();
  assert.equal(p.roots.filter(x => x.isConnected).length, 0);
  assert.equal(p.timers.size, 0);
  assert.equal(p.resizeListeners.size, 0);
});

test('连续热重载始终只保留一组按钮、一份状态文字和一个轮询', async t => {
  const p = await page(t);
  for (let i = 0; i < 4; i++) await p.reload();
  assert.equal(p.roots.filter(x => x.isConnected).length, 1);
  assert.equal(p.timers.size, 1);
  assert.equal(p.resizeListeners.size, 1);
});

test('热重载清理旧版本残留，旧作用域迟到的卸载不能删除新按钮', async t => {
  const p = await page(t);
  const legacy = { isConnected: true, remove() { this.isConnected = false; } };
  p.roots.push(legacy);
  const previousDispose = await p.reload();
  previousDispose();
  assert.equal(legacy.isConnected, false);
  assert.equal(p.roots.filter(x => x.isConnected).length, 1);
  assert.equal(p.timers.size, 1);
});

test('启动、等待登录、关闭和就绪各状态只显示一份对应文字', async t => {
  const p = await page(t);
  for (const [state, expected] of [
    [{ starting: true, light: 'amber' }, '启动中'],
    [{ starting: true, light: 'amber', message: '等待 QQ 登录' }, '等待登录'],
    [{ starting: true, light: 'amber', phase: 'waiting_gateway', message: 'QQ 接口有响应，但机器人账号鉴权尚未通过' }, '连接中'],
    [{ operation: 'stopping', light: 'red' }, '关闭中'],
    [{ ready: true, light: 'green' }, '小鲸鱼']
  ]) {
    await p.setStatus(state);
    const live = p.roots.filter(x => x.isConnected);
    assert.equal(live.length, 1);
    assert.equal(live[0].children[0].children[1].textContent, expected);
  }
});
