// 组件宿主（plugin host）
//
// 设计原则（管理员定的）：**万态皆插件** —— 每项能力是一个可独立插拔、独立优化的组件；
// 组件用一份 skill.md 描述自己，按时间或按需被调用，也能反过来调用 AI。
//
// 目录约定：plugins/qq-components/<id>/ 下放
//   plugin.json  { id, name, version, description, category, order, tags, hooks, schedule, config, enabled }
//   index.js     export function createPlugin(ctx) → { hooks: { onIncoming, beforePrompt, afterSend, onTick } }
//   skill.md     人读的说明书（插件管理页会直接展示）
//
// 约定：
//   · 插件崩溃/超时不影响桥接（全部 try/catch，加载失败只告警）；
//   · 插件是可信本地代码（非安全沙箱）；业务 IO 应通过 capabilities，生命周期撤销由宿主处理；
//   · 插件自己的持久状态在 state/plugins/<id>.json，启停/排序在 state/plugins/registry.json。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ETCLOVG 七层：管理页按层展示，哪怕某层还没有插件也要显示出来（缺口可见）。
const HARNESS_LAYERS = [
  { id: 'C', name: '上下文与记忆', desc: '提示词装配、快照、记忆、画像' },
  { id: 'T', name: '工具接口与协议', desc: 'MCP 工具、插件工具、调用约定' },
  { id: 'E', name: '执行环境与沙箱', desc: '沙箱、浏览器、本机执行、审批' },
  { id: 'L', name: '生命周期与编排', desc: '唤醒、回合、定时、恢复、多 agent' },
  { id: 'O', name: '可观测性与运维', desc: '日志、trace、成本、自愈' },
  { id: 'V', name: '验证与评估', desc: '基准、评分、回归' },
  { id: 'G', name: '治理与安全', desc: '权限、策略、审计、内容闸门' },
  { id: 'S', name: 'SCHNIE 参考', desc: 'SCHNIE 参考：哲学思考资料与逻辑方式驱动的参考核心' }
];

const HOOK_NAMES = ['onIncoming', 'beforePrompt', 'afterSend', 'onTick', 'relayIncoming', 'wakeTail'];
const MAX_PROMPT_BLOCK_CHARS = 1200;
const MAX_PLUGIN_PROMPT_CHARS = 8000;

function safeId(id) {
  return /^[a-z0-9][a-z0-9._-]{0,40}$/i.test(String(id || ''));
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(file, value) {
  let temp;
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    temp=file+'.tmp-'+process.pid+'-'+Math.random().toString(36).slice(2);
    fs.writeFileSync(temp, JSON.stringify(value, null, 1), {encoding:'utf8',mode:0o600});
    fs.renameSync(temp,file);
    return true;
  } catch {
    return false;
  } finally {
    if(temp && fs.existsSync(temp))try{fs.unlinkSync(temp);}catch{}
  }
}

/**
 * @param {{
 *   root: string,
 *   logger?: (msg: string) => void,
 *   askAI?: (prompt: string, opts?: object) => boolean,
 * }} opts
 */
export function createPluginHost(opts = {}) {
  const root = String(opts.root || '');
  const log = typeof opts.logger === 'function' ? opts.logger : () => {};
  const askAI = typeof opts.askAI === 'function' ? opts.askAI : () => false;
  // 桥接注入的受控能力（同一对象引用，晚绑定：桥接在 main() 里再往上面挂函数）。
  // 插件只能通过这里碰桥接内部（例如启动任务会话），拿不到裸 fs/网络之外的其它内部状态。
  const capabilities = opts.capabilities && typeof opts.capabilities === 'object' ? opts.capabilities : {};
  const plugins = new Map();
  const tools = new Map();
  const runtimes = new Map();
  let warnings = [];
  let loaded = false;
  let revision = 0;
  let reloadChain = Promise.resolve();
  const timeoutMs = Math.max(10, Number(opts.lifecycleTimeoutMs)||3000);
  async function bounded(value,label) {
    let timer;try{return await Promise.race([Promise.resolve(value),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timeout')),timeoutMs);})]);}finally{clearTimeout(timer);}
  }
  const warn = (message) => { warnings.push(String(message)); if (warnings.length > 200) warnings.splice(0, warnings.length - 200); };
  function failure(p, label, error) { p.metrics.errors++; p.metrics.lastError = label; warn(label + ' ' + p.id + ': ' + (error?.message ?? error)); }
  function invoke(p, label, fn, arg, fallback = null) {
    p.metrics.calls++; p.metrics.lastCallAt = Date.now();
    try { const value = fn(arg); return value && typeof value.then === 'function' ? Promise.resolve(value).catch(e => { failure(p,label,e); return fallback; }) : value; }
    catch(e) { failure(p,label,e); return fallback; }
  }
  function deactivate(p) {
    if (p.timer) clearInterval(p.timer);
    p.timer = null;
    if (p.life && p.life.active) { p.life.active = false; p.life.controller.abort(); }
    for (const name of p.tools || []) if (tools.get(name)?.plugin === p.id) tools.delete(name);
    if (typeof p.dispose === 'function') { const dispose=p.dispose; p.dispose=null; return bounded(invoke(p,'dispose',dispose),'dispose').catch(e=>failure(p,'dispose',e)); }
  }
  function chunks(text) { const t=String(text||'').trim().slice(0,MAX_PLUGIN_PROMPT_CHARS); const out=[];for(let i=0;i<t.length;i+=MAX_PROMPT_BLOCK_CHARS)out.push(t.slice(i,i+MAX_PROMPT_BLOCK_CHARS));return out; }

  const baseDir = () => path.join(root, 'plugins', 'qq-components');
  const registryFile = () => path.join(root, 'state', 'plugins', 'registry.json');
  const configFile = id => path.join(root,'state','plugins','config',id+'.json');
  const effectiveConfig = (id,manifest) => { const saved=readJsonSafe(configFile(id),{}); return Object.fromEntries(Object.entries(manifest.config||{}).map(([key,value])=>[key,Object.hasOwn(saved,key)?saved[key]:value])); };
  const registry = () => {
    const raw = readJsonSafe(registryFile(), {});
    return {
      disabled: Array.isArray(raw.disabled) ? raw.disabled.map(String) : [],
      enabled: Array.isArray(raw.enabled) ? raw.enabled.map(String) : [],
      order: Array.isArray(raw.order) ? raw.order.map(String) : []
    };
  };
  const saveRegistry = (next) => writeJsonSafe(registryFile(), next);

  function makeState(id) {
    const file = path.join(root, 'state', 'plugins', id + '.json');
    let cache = null;
    const load = () => {
      if (cache) return cache;
      const raw = readJsonSafe(file, {});
      cache = raw && typeof raw === 'object' ? raw : {};
      return cache;
    };
    return {
      get() { return structuredClone(load()); },
      set(patch) {
        const next = structuredClone({ ...load(), ...(patch && typeof patch === 'object' ? patch : {}) });
        if(!writeJsonSafe(file, next))throw Error('插件状态持久化失败：'+id);
        cache = next;
        return next;
      }
    };
  }

  async function loadOne(dir, disabledIds, builtin = true) {
    const manifestPath = path.join(dir, 'plugin.json');
    if (!fs.existsSync(manifestPath)) return;
    const manifest = readJsonSafe(manifestPath, null);
    if (!manifest || typeof manifest !== 'object') { warnings.push('plugin.json 解析失败：' + dir); return; }
    const id = String(manifest.id || path.basename(dir));
    if (!safeId(id)) { warnings.push('插件 id 不合法：' + id); return; }
    if (plugins.has(id)) { warn('重复插件 id，拒绝覆盖：' + id); return; }
    if ((manifest.enabled === false && !registry().enabled.includes(id)) || disabledIds.includes(id)) {
      plugins.set(id, { id, dir, manifest, ctx: null, hooks: {}, skillPath: fs.existsSync(path.join(dir,'skill.md')) ? path.join(dir,'skill.md') : null, disabled: true, timer: null, tools: [], builtin, metrics: {calls:0,errors:0} });
      return;
    }
    const entry = path.join(dir, String(manifest.main || 'index.js'));
    if (!path.resolve(entry).startsWith(path.resolve(dir) + path.sep)) { warn('插件入口越界：'+id); return; }
    if (!fs.existsSync(entry)) { warnings.push('插件入口缺失：' + id); return; }
    const skillPath = fs.existsSync(path.join(dir, 'skill.md')) ? path.join(dir, 'skill.md') : null;
    const life = { active:true, controller:new AbortController() };
    const pluginTools = [];
    try {
      const mod = await bounded(import(pathToFileURL(entry).href + '?generation=' + revision),'import');
      const factory = mod.createPlugin || mod.default;
      if (typeof factory !== 'function') { warnings.push('插件未导出 createPlugin：' + id); return; }
      const state = makeState(id);
      const scopedCapabilities = new Proxy({}, { get(_,name) { const value=capabilities[name]; if(typeof value!=='function')return value;return (...args)=>life.active ? value(...args) : false; } });
      const ctx = {
        id,
        dir,
        root,
        manifest,
        config: effectiveConfig(id,manifest),
        capabilities: scopedCapabilities,
        signal: life.controller.signal,
        isActive: () => life.active,
        runtime: runtimes.has(id) ? runtimes.get(id) : (runtimes.set(id,{}),runtimes.get(id)),
        isPluginEnabled: (id) => api.isEnabled(id),
        scheduler: {schedule:spec=>life.active?api.callService('scheduler','schedule',spec):null,cancel:handle=>api.callService('scheduler','cancel',handle)},
        state: {get:()=>state.get(),set:patch=>life.active ? state.set(patch) : state.get()},
        log: (m) => log('[plugin:' + id + '] ' + m),
        warn: (m) => { warn(id + ': ' + m); log('[plugin:' + id + '] WARN ' + m); },
        promptBlocks: [],
        addPromptBlock(text) {
          const t = String(text || '').trim();
          if (t && life.active && ctx.acceptBlocks) ctx.promptBlocks.push(...chunks(t));
        },
        askAI(prompt, askOpts = {}) {
          try { return life.active && askAI(String(prompt || ''), { ...askOpts, plugin: id, signal:life.controller.signal }); } catch { return false; }
        },
        registerTool(name, spec) {
          if(!life.active)return;
          const toolName = String(name || '').trim();
          if (!safeId(toolName)) { ctx.warn('工具名不合法：' + toolName); return; }
          if (!spec || typeof spec.handler !== 'function') { ctx.warn('工具缺少 handler：' + toolName); return; }
          if (tools.has(toolName)) { ctx.warn('工具名重复，拒绝覆盖：' + toolName); return; }
          tools.set(toolName, { plugin: id, life, description: String(spec.description || ''), schema: spec.schema || null, handler: spec.handler });
          pluginTools.push(toolName);
        }
      };
      const inst = await bounded(factory(ctx),'factory') || {};
      const hooks = inst.hooks && typeof inst.hooks === 'object' ? inst.hooks : {};
      const services = inst.services && typeof inst.services === 'object' ? inst.services : {};
      for (const h of Object.keys(hooks)) if (!HOOK_NAMES.includes(h)) warnings.push(id + '：未知钩子 ' + h);
      plugins.set(id, {
        id,
        manifest,
        ctx,
        dir,
        hooks,
        services,
        skillPath,
        disabled: false,
        tools: pluginTools,
        schedule: inst.schedule || manifest.schedule || null,
        timer: null,
        builtin
        , life, dispose: inst.dispose, canWake: inst.canWake, validateConfig: inst.validateConfig, metrics: {calls:0,errors:0,lastCallAt:0,lastError:null}, tickBusy: false
      });
      log('[plugin] 已加载 ' + id + (manifest.description ? ' — ' + manifest.description : ''));
    } catch (error) {
      life.active=false;life.controller.abort();
      for(const name of pluginTools)if(tools.get(name)?.plugin===id)tools.delete(name);
      warnings.push('插件加载失败 ' + id + ': ' + (error?.message ?? error));
    }
  }

  async function loadAll() {
    // 清掉上一次的定时器与注册表（热重载复用同一实例）
    for (const p of plugins.values()) {
      await deactivate(p);
    }
    plugins.clear();
    tools.clear();
    warnings = [];
    revision++;
    const disabledIds = registry().disabled;
    if (fs.existsSync(baseDir())) {
      for (const name of fs.readdirSync(baseDir())) {
        const dir = path.join(baseDir(), name);
        try { if (fs.statSync(dir).isDirectory()) await loadOne(dir, disabledIds); } catch {}
      }
    }
    const userDir = path.join(root,'plugins','qq-components-user');
    if(fs.existsSync(userDir))for(const name of fs.readdirSync(userDir)){const dir=path.join(userDir,name);if(fs.statSync(dir).isDirectory())await loadOne(dir,disabledIds,false);}
    // Only the central scheduler owns a native clock. Other periodic hooks are jobs.
    for (const p of plugins.values()) registerTick(p);
    loaded = true;
    opts.onChange?.();
    return api.summary();
  }
  async function tickOne(p,now) {
    if(p.disabled || !p.life?.active || p.tickBusy || typeof p.hooks.onTick!=='function')return;
    p.tickBusy=true;try{await invoke(p,'onTick',p.hooks.onTick,{now,signal:p.life.controller.signal});}finally{p.tickBusy=false;}
  }
  function registerTick(p) {
    const ms=Number(p.schedule?.everyMs);
    if(p.disabled || !Number.isFinite(ms) || typeof p.hooks.onTick!=='function')return;
    if(p.id==='life-scheduler'){
      if(opts.startTimers!==false && ms>=1000){p.timer=setInterval(()=>void tickOne(p,Date.now()),ms);p.timer.unref?.();}
    }else if(ms>=60000){api.callService('scheduler','schedule',{id:'plugin-tick:'+p.id,owner:p.id,type:'plugin-tick',at:Date.now()+ms,intervalMs:ms,maxLateMs:ms,expiresAt:Date.now()+ms*2,run:()=>tickOne(p,Date.now())});}
  }

  function orderedPlugins() {
    const reg = registry();
    const orderIndex = new Map(reg.order.map((id, i) => [id, i]));
    return [...plugins.values()].sort((a, b) => {
      const ai = orderIndex.has(a.id) ? orderIndex.get(a.id) : 1000 + (Number(a.manifest?.order) || 0);
      const bi = orderIndex.has(b.id) ? orderIndex.get(b.id) : 1000 + (Number(b.manifest?.order) || 0);
      if (ai !== bi) return ai - bi;
      return a.id.localeCompare(b.id);
    });
  }

  const api = {
    layers() {
      const byLayer = new Map(HARNESS_LAYERS.map((l) => [l.id, []]));
      for (const p of plugins.values()) {
        const id = String(p.manifest?.layer || '');
        if (!byLayer.has(id)) byLayer.set(id, []);
        byLayer.get(id).push({ id: p.id, name: p.manifest?.name || p.id, enabled: !p.disabled });
      }
      const layers=HARNESS_LAYERS.map((l) => ({ ...l, plugins: byLayer.get(l.id) || [] }));
      const unclassified=[...byLayer.entries()].filter(([id])=>!HARNESS_LAYERS.some(l=>l.id===id)).flatMap(([,items])=>items);
      if(unclassified.length)layers.push({id:'',name:'横切注册与集成',desc:'跨层组件，不增加概念层级',plugins:unclassified});
      return layers;
    },
    loadAll() { const next=reloadChain.then(loadAll);reloadChain=next.catch(()=>{});return next; },
    async reload(id) {
      if(!id)return api.loadAll();
      const next=reloadChain.then(async()=>{const p=plugins.get(String(id));if(!p)return api.summary();api.callService('scheduler','cancelOwner',p.id);await deactivate(p);plugins.delete(p.id);revision++;await loadOne(p.dir,registry().disabled,p.builtin);const fresh=plugins.get(p.id);if(fresh)registerTick(fresh);opts.onChange?.(id);return api.summary();});
      reloadChain=next.catch(()=>{});return next;
    },
    async dispose() { for(const p of plugins.values()) {p.disabled=true;await deactivate(p);} loaded=false; },
    async tick(now=Date.now()) { await Promise.all(orderedPlugins().map(p=>tickOne(p,now))); },
    isEnabled(id) { const p=plugins.get(String(id));return !!p && !p.disabled; },
    allowsWake(reason, payload={}) {
      reason=String(reason).split(':')[0];
      const required=readJsonSafe(path.join(root,'plugins','wake-contracts.json'),{})[String(reason)]||[];
      if(required.some(id=>!api.isEnabled(id)))return false;
      for(const p of orderedPlugins()) {
        if(!Array.isArray(p.manifest.wakeReasons) || !p.manifest.wakeReasons.includes(String(reason)))continue;
        if(p.disabled)return false;
        if(typeof p.canWake==='function' && invoke(p,'canWake',p.canWake,{...payload,reason},false)!==true)return false;
      }
      return true;
    },
    summary() {
      const reg = registry();
      return {
        runtime: {coreBuild:opts.runtimeBuildId||null,loaded:loaded},
        count: [...plugins.values()].filter((p) => !p.disabled).length,
        total: plugins.size,
        warnings: warnings.slice(-20),
        layers: api.layers(),
        plugins: orderedPlugins().map((p) => ({
          id: p.id,
          name: p.manifest?.name || p.id,
          version: p.manifest?.version || '',
          description: p.manifest?.description || '',
          category: p.manifest?.category || '未分类',
          layer: p.manifest?.layer || '',
          implementation: p.manifest?.implementation || 'active',
          builtin: p.builtin !== false,
          tags: Array.isArray(p.manifest?.tags) ? p.manifest.tags : [],
          enabled: !p.disabled,
          configKeys: Object.keys(p.manifest?.config || {}),
          hooks: Object.keys(p.hooks || {}),
          schedule: p.schedule || null,
          metrics: {...p.metrics},
          services: Object.fromEntries(Object.entries(p.services||{}).map(([name,svc])=>[name,Object.keys(svc)])),
          hasSkill: !!p.skillPath,
          tools: (p.tools || []).map((name) => ({ name, description: tools.get(name)?.description || '' })),
          stateFile: 'state/plugins/' + p.id + '.json'
        }))
      };
    },
    list() { return api.summary(); },
    get(id) {
      const p = plugins.get(String(id || ''));
      if (!p) return null;
      return {
        id: p.id,
        name: p.manifest?.name || p.id,
        version: p.manifest?.version || '',
        description: p.manifest?.description || '',
        category: p.manifest?.category || '未分类',
        layer: p.manifest?.layer || '',
        implementation: p.manifest?.implementation || 'active',
        builtin: p.builtin !== false,
        tags: Array.isArray(p.manifest?.tags) ? p.manifest.tags : [],
        enabled: !p.disabled,
        hooks: Object.keys(p.hooks || {}),
        schedule: p.schedule || null,
        main: p.manifest?.main || 'index.js',
        config: p.ctx?.config || effectiveConfig(p.id,p.manifest),
        configKeys: Object.keys(p.manifest?.config || {}),
        configSchema: p.manifest?.configSchema || {},
        metrics: {...p.metrics},
        services: Object.fromEntries(Object.entries(p.services||{}).map(([name,svc])=>[name,Object.keys(svc)])),
        skill: api.getSkill(p.id),
        state: p.ctx ? p.ctx.state.get() : {},
        tools: (p.tools || []).map((name) => ({ name, description: tools.get(name)?.description || '' }))
      };
    },
    getSkill(id) {
      const p = plugins.get(String(id || ''));
      if (!p || !p.skillPath) return '';
      try { return fs.readFileSync(p.skillPath, 'utf8'); } catch { return ''; }
    },
    setEnabled(id, enabled) {
      const pid = String(id || '');
      if (!plugins.has(pid)) return { ok: false, error: '没有这个插件：' + pid };
      const reg = registry();
      const set = new Set(reg.disabled);
      const on = new Set(reg.enabled);
      if (enabled) set.delete(pid); else set.add(pid);
      if(enabled)on.add(pid);else on.delete(pid);
      if(!saveRegistry({ ...reg, disabled: [...set],enabled:[...on] }))return {ok:false,error:'插件注册表写入失败'};
      if(!enabled){api.callService('scheduler','cancelOwner',pid);const p=plugins.get(pid);p.disabled=true;void deactivate(p);}
      return { ok: true, id: pid, enabled: !!enabled };
    },
    setConfig(id, patch) {
      const p=plugins.get(String(id));if(!p)return {ok:false,error:'没有这个插件'};
      if(!patch || typeof patch!=='object' || Array.isArray(patch))return {ok:false,error:'config 必须是对象'};
      if(JSON.stringify(patch).length>32000)return {ok:false,error:'config 过长'};
      const defaults=p.manifest.config||{},schema=p.manifest.configSchema||{};
      for(const [key,value] of Object.entries(patch)) {
        if(!Object.hasOwn(defaults,key) || ['__proto__','constructor','prototype'].includes(key))return {ok:false,error:'未知配置项：'+key};
        const ref=defaults[key];if((Array.isArray(ref)?!Array.isArray(value):typeof ref!==typeof value) || value===null || (typeof value==='number'&&!Number.isFinite(value)))return {ok:false,error:'配置类型错误：'+key};
        const rule=schema[key]||{};if(rule.readOnly || rule.readonly)return {ok:false,error:"只读配置项："+key};if(rule.enum && !rule.enum.includes(value))return {ok:false,error:'配置取值无效：'+key};
        if(typeof value==='number' && ((rule.min!==undefined&&value<rule.min)||(rule.max!==undefined&&value>rule.max)))return {ok:false,error:'配置范围无效：'+key};
      }
      const config={...effectiveConfig(p.id,p.manifest),...patch};
      if(typeof p.validateConfig==='function') {
        try { const result=p.validateConfig(config); if(result?.then || result?.ok!==true)return {ok:false,error:(result?.errors||['配置校验失败']).join('；')}; }
        catch(error){return {ok:false,error:error?.message||'配置校验失败'};}
      }
      return writeJsonSafe(configFile(p.id),config) ? {ok:true,id:p.id,config} : {ok:false,error:'配置保存失败'};
    },
    setOrder(order) {
      const ids = (Array.isArray(order) ? order : []).map(String).filter(safeId);
      const reg = registry();
      saveRegistry({ ...reg, order: ids });
      return { ok: true, order: ids };
    },
    emitIncoming(payload) {
      for (const p of orderedPlugins()) {
        if (p.disabled || typeof p.hooks.onIncoming !== 'function') continue;
        invoke(p,'onIncoming',p.hooks.onIncoming,{ ...(payload || {}), pluginState: p.ctx.state });
      }
    },
    /**
     * 入站消息「拦截」钩子：插件可以抢先处理一条消息并声明 handled（例如传话组件）。
     * 返回 handled 时桥接不再把这条消息交给后续流程（AI 回合）；没声明 handled 的插件不影响别的插件。
     */
    async relayIncoming(payload) {
      for (const p of orderedPlugins()) {
        if (p.disabled || typeof p.hooks.relayIncoming !== 'function') continue;
        try {
          const out = await invoke(p,'relayIncoming',p.hooks.relayIncoming,{ ...(payload || {}), pluginState: p.ctx.state });
          if (out && (out === true || out.handled === true)) return { handled: true, plugin: p.id, result: out };
        } catch (error) {
          warnings.push('relayIncoming 失败 ' + p.id + ': ' + (error?.message ?? error));
        }
      }
      return null;
    },
    /**
     * 唤醒原因尾巴：插件按 reason 产出一段「这一轮该干什么」的指令（L 层）。
     * 多个插件都返回时按加载顺序拼接；没有插件处理则返回空串，由桥接退回通用尾巴。
     */
    collectWakeTails(payload) {
      const parts = [];
      for (const p of orderedPlugins()) {
        if (p.disabled || typeof p.hooks.wakeTail !== 'function') continue;
        try {
          const out = invoke(p,'wakeTail',p.hooks.wakeTail,{ ...(payload || {}), pluginState: p.ctx.state });
          if (typeof out === 'string' && out.trim()) parts.push(out.trim());
        } catch (error) {
          warnings.push('wakeTail 失败 ' + p.id + ': ' + (error?.message ?? error));
        }
      }
      return parts.join('\n\n').slice(0, 8000);
    },
    collectPromptBlocks(payload) {
      const blocks = [];
      for (const p of orderedPlugins()) {
        if (p.disabled || typeof p.hooks.beforePrompt !== 'function') continue;
        try {
          p.ctx.acceptBlocks=true;
          const out = invoke(p,'beforePrompt',p.hooks.beforePrompt,{ ...(payload || {}), promptBlocks: [...p.ctx.promptBlocks] });
          p.ctx.acceptBlocks=false;
          if (typeof out === 'string' && out.trim()) p.ctx.promptBlocks.push(...chunks(out));
          const own=p.ctx.promptBlocks.join('\n\n').slice(0,MAX_PLUGIN_PROMPT_CHARS);blocks.push(...chunks(own));p.ctx.promptBlocks.length=0;
        } catch (error) {
          warnings.push('beforePrompt 失败 ' + p.id + ': ' + (error?.message ?? error));
        }
      }
      for (const p of plugins.values()) {
        if (p.disabled) continue;
        p.ctx.promptBlocks.length = 0;
      }
      return blocks;
    },
    emitSent(payload) {
      for (const p of orderedPlugins()) {
        if (p.disabled || typeof p.hooks.afterSend !== 'function') continue;
        invoke(p,'afterSend',p.hooks.afterSend,{ ...(payload || {}), pluginState: p.ctx.state });
      }
    },
    async callTool(name, input) {
      const tool = tools.get(String(name || ''));
      if (!tool) return { ok: false, error: '没有这个插件工具：' + name };
      try {
        const p=plugins.get(tool.plugin);if(!p || p.disabled || !tool.life.active || p.life!==tool.life)return {ok:false,error:'插件已停用'};
        p.metrics.calls++;p.metrics.lastCallAt=Date.now();
        const result = await tool.handler(input || {});
        return { ok: true, plugin: tool.plugin, result };
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) };
      }
    },
    /**
     * 调用插件暴露的服务（`services.<name>.<method>`）。
     * 不强制 async：同步服务（如 contextBlock）直接返回结果；需要异步的调用方自行 await。
     * 约定：桥接只认「服务名 + 方法名」，不 import 插件实现，实现可热替换。
     */
    callService(service, method, payload) {
      const sName = String(service || '');
      const mName = String(method || '');
      for (const p of orderedPlugins()) {
        if (p.disabled) continue;
        const svc = p.services && p.services[sName];
        if (!svc || typeof svc[mName] !== 'function') continue;
        try {
          return invoke(p,'service:'+sName+'.'+mName,svc[mName].bind(svc),payload);
        } catch (error) {
          warnings.push('服务调用失败 ' + sName + '.' + mName + '（' + p.id + '）：' + (error?.message ?? error));
          return null;
        }
      }
      return null;
    },
    hasService(service, method) {
      for (const p of plugins.values()) {
        if (p.disabled) continue;
        const svc = p.services && p.services[String(service || '')];
        if (svc && (method ? typeof svc[String(method)] === 'function' : true)) return true;
      }
      return false;
    },
    listTools() {
      return [...tools.entries()].map(([name, t]) => ({ name, plugin: t.plugin, description: t.description }));
    },
    /**
     * 七层管理化：把 qq-components-user 里的第三方插件补齐 layer/config 与占位文件，
     * 然后热重载并归入对应层。只做安全的脚手架补齐，不覆盖已有内容。
     */
    async harnessify(id, { layer } = {}) {
      const pid = String(id || '');
      const p = plugins.get(pid);
      if (!p) return { ok: false, error: '没有这个插件：' + pid };
      if (p.builtin !== false) return { ok: false, error: '只能管理化第三方插件（plugins/qq-components-user 目录）' };
      const layerNorm = String(layer || '').toUpperCase();
      const validLayers = HARNESS_LAYERS.map((l) => l.id);
      const pjFile = path.join(p.dir, 'plugin.json');
      const manifest = readJsonSafe(pjFile, {});
      if (!layerNorm && !manifest.layer) {
        return { ok: false, error: '该插件还没有 layer，请指定要归入的层（' + validLayers.join('/') + '）', validLayers };
      }
      if (layerNorm && !validLayers.includes(layerNorm)) {
        return { ok: false, error: '无效层：' + layerNorm + '（可用 ' + validLayers.join('/') + '）' };
      }
      const nextLayer = layerNorm || String(manifest.layer || '');
      const layerName = (HARNESS_LAYERS.find((l) => l.id === nextLayer) || {}).name || '';
      const config = (manifest.config && typeof manifest.config === 'object' && !Array.isArray(manifest.config)) ? manifest.config : {};
      const merged = {
        id: pid,
        name: manifest.name || pid,
        version: manifest.version || '0.1.0',
        description: manifest.description || '',
        layer: nextLayer,
        category: manifest.category || layerName,
        main: manifest.main || 'index.js',
        hooks: Array.isArray(manifest.hooks) ? manifest.hooks : [],
        config,
        enabled: manifest.enabled !== false
      };
      if (!writeJsonSafe(pjFile, merged)) return { ok: false, error: '写 plugin.json 失败' };
      const idxFile = path.join(p.dir, 'index.js');
      if (!fs.existsSync(idxFile)) {
        fs.writeFileSync(idxFile, '// ' + (merged.name || pid) + '（七层管理化生成的占位实现，请补充 hooks / tools）\nexport function createPlugin(ctx) {\n  return { hooks: {} };\n}\n', 'utf8');
      }
      const skillFile = path.join(p.dir, 'skill.md');
      if (!fs.existsSync(skillFile)) {
        fs.writeFileSync(skillFile, '# ' + (merged.name || pid) + '\n\n（七层管理化生成的占位说明，请补充用途、配置项与调用时机。）\n', 'utf8');
      }
      await api.reload(pid);
      return { ok: true, id: pid, layer: nextLayer, message: '已归入 ' + nextLayer + ' 层并热重载' };
    },
    isLoaded() { return loaded; }
  };

  return api;
}
