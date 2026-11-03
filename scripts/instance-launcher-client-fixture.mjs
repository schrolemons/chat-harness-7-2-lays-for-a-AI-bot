import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Break caught: singleton ownership, address adoption without instance/epoch checks,
// and the HTML snapshot being mistaken for a live registry.
export async function clientFixture(t) {
  const nodes = new Map(), requests = [], opened = [], timers = new Set(), events = new Map();
  function element() {
    const node = { style: {}, dataset: {}, children: [], handlers: {}, isConnected: true,
      append(...children) { for (const child of children) { if (child.parent) child.parent.children = child.parent.children.filter(x => x !== child); child.parent = this; this.children.push(child); } },
      remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
      focus() {}, setAttribute(key, value) { this[key] = value; },
      addEventListener(key, fn) { this.handlers[key] = fn; }, removeEventListener(key) { delete this.handlers[key]; },
      getBoundingClientRect() { return { right: 120, width: 100, height: 40 }; },
      set id(value) { nodes.set(value, this); }, get id() { return [...nodes].find(([, n]) => n === this)?.[0]; } };
    return node;
  }
  let menubar = null;
  const body = element(), document = { body, documentElement: element(), createElement: element,
    querySelector: selector => selector === '[data-windows-menu]' ? menubar : null };
  const registry = {}, statuses = {}, configs = {}, pending = new Map(); let api;
  const window = { innerWidth: 1200, __qqBotInstances: { poison: { serviceUrl: 'http://127.0.0.1:3199' } },
    __ModuleLoader__: { load(mod) { api = mod.factory(() => ({})); } }, open: (...args) => opened.push(args),
    addEventListener(key, fn) { (events.get(key) || events.set(key, new Set()).get(key)).add(fn); },
    removeEventListener(key, fn) { events.get(key)?.delete(fn); } };
  const context = vm.createContext({ window, document, console, URL, AbortController, AbortSignal, setTimeout, clearTimeout,
    setInterval(fn) { const timer = { fn }; timers.add(timer); return timer; }, clearInterval(timer) { timers.delete(timer); },
    fetch: async (url, options = {}) => {
      requests.push({ url, ...options, body: options.body && JSON.parse(options.body) });
      if (pending.has(url)) return pending.get(url)(options);
      const [id, record] = Object.entries(registry).find(([, record]) => url.startsWith(record.serviceUrl + '/')) || [];
      assert.ok(id, 'only freshly discovered URLs may be contacted');
      const route = url.split('/').at(-1), identity = { instanceId: id, ...record };
      let data = { ok: true, ...identity, readiness: 'unverified', runtime: { state: statuses[id] || 'stopped' }, ...configs[id] };
      if (options.method === 'POST') {
        assert.equal(JSON.parse(options.body).instanceId, id); assert.equal(JSON.parse(options.body).generation, record.generation);
        if (route === 'config') {
          const patch = JSON.parse(options.body); configs[id] = { ...configs[id], ...patch, revision: 'saved' };
          const next = new URL(record.serviceUrl); next.port = String(patch.ports.launcher);
          registry[id] = { ...record, serviceUrl: next.origin, generation: record.generation + '-next' };
          data = { ...data, ...configs[id], ...registry[id] };
        } else { statuses[id] = route === 'stop' ? 'stopped' : 'running'; data.runtime.state = statuses[id]; }
      }
      return { ok: true, json: async () => data };
    } });
  vm.runInContext(fs.readFileSync(new URL('../plugins/qq-launcher/lib/client.js', import.meta.url), 'utf8'), context);
  const scopes = [], flush = () => new Promise(resolve => setTimeout(resolve, 12));
  const discovery={read:async()=>({ok:true,value:structuredClone(registry)})};
  function add(id, port, moduleId = 'module-' + id) {
    registry[id] = { label: 'Synthetic ' + id, serviceUrl: 'http://127.0.0.1:' + port, generation: id + '-1', clientModuleId: moduleId };
    configs[id] = { botUin: '123456789', configured: true, ownerQQ: '', allow: { private: [], groups: [] }, revision: 'initial',
      ports: { dsh: 3080, console: port + 1, snowHttp: 3000, snowWs: 3001, launcher: port, snowWebui: 5099 } };
    return registry[id];
  }
  function scope() { const listeners = new Map(); const ctx = { connection: { rpc: { async call(channel, endpoint) {
    assert.equal(channel, '/qq-bot-discovery'); assert.equal(endpoint, 'list'); return discovery.read();
  } } }, on(event, fn) { listeners.set(event, fn); return () => listeners.delete(event); } }; scopes.push(listeners); return { ctx, listeners }; }
  const mount = (id) => { const s = scope(); const dispose = api.mountBotLauncher(s.ctx, { instanceId: id, clientModuleId: registry[id].clientModuleId, label: registry[id].label }); t.after(dispose); return { ...s, dispose }; };
  const click = async (id, action) => { await nodes.get('qq-launcher-' + id + '-' + action).handlers.click(); await flush(); };
  const submit = async id => { await nodes.get('qq-launcher-' + id + '-settings-form').handlers.submit({ preventDefault() {} }); await flush(); };
  function insertMenu(rect) { menubar = element(); menubar.dataset.windowsMenu = ''; menubar.getBoundingClientRect = () => rect; body.append(menubar); return menubar; }
  return { api, window, registry, configs, statuses, nodes, body, timers, events, requests, opened, pending, discovery, add, mount, click, submit, flush,
    insertMenu,
    async tick() { await Promise.all([...timers].map(x => x.fn())); await flush(); } };
}
