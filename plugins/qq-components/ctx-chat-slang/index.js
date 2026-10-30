const scopesUrl=new URL('../learning-scopes.mjs',import.meta.url);scopesUrl.search=new URL(import.meta.url).search;
const {migrateScope,sourceKeys,injectLimit,injectionReport,defaultEntries,queryEntries,changeCurrentSource,lookupHints,queryEnabled,sourceGuidance,semanticEntry}=await import(scopesUrl.href);
// ctx-chat-slang（C 层｜黑话学习与注入）
//
// 以前黑话学习整条链路在 bridge.js：收消息攒窗口、冷却、抽词、研究、写 state/slang.json、
// 每轮提示词注入黑话表。现在：
//   · 学习循环（窗口/冷却/抽词/研究/写回）在本组件；
//   · 注入也由本组件产出一段上下文（桥接只调 `pluginHost.callService('slang','contextBlock')`）；
//   · 桥接只保留：state/slang.json 的存储（cap.slangList/slangSave）、学习会话的
//     DSH 往返（cap.slangLearnerPrompt）和控制台/ MCP 的 CRUD 端点（数据面）。
//
// 学习会话仍由桥接创建/等待——它属于「网络与 DSH 连接」；插件不直连 DSH。

import {
  SLANG_STATUS,
  buildSlangContext,
  buildExtractionPrompt,
  buildResearchPrompt,
  parseExtractionJson,
  parseResearchJson,
  upsertSlangEntry
} from '../../../src/slang-learner.js';

const ROLE_CHANGE_RE = /(?:扮演角色卡|退出角色卡|切换角色|设置角色|改角色|换角色|关闭角色卡|启用角色卡)/;

export function createPlugin(ctx) {
  const cap = ctx.capabilities || {};
  const windows = new Map(); // key -> [{sender,text,time}]
  const cooldowns = new Map(); // key -> ts
  const researching = new Set(); // 候选 id
  let taskChain = Promise.resolve();

  const getCfg = () => {
    try { return (typeof cap.slangConfig === 'function' ? cap.slangConfig() : null) || {}; } catch { return {}; }
  };
  const list = () => {
    try { return (typeof cap.slangList === 'function' ? cap.slangList() : []) || []; } catch { return []; }
  };
  const save = (entries) => {
    try { return typeof cap.slangSave === 'function' ? cap.slangSave(entries) === true : false; } catch { return false; }
  };
  const migrated=list().map(migrateScope);if(JSON.stringify(migrated)!==JSON.stringify(list())&&!save(migrated))throw Error('黑话来源迁移写入失败');
  const learnerPrompt = async (text,keys=['*']) => {
    try { return typeof cap.slangLearnerPrompt === 'function' ? await cap.slangLearnerPrompt(String(text || ''),{signal:ctx.signal,keys}) : null; } catch (error) { ctx.warn('黑话学习会话调用失败：' + (error?.message ?? error)); return null; }
  };

  function queue(fn) {
    const work=taskChain.then(() => ctx.isActive?.() === false ? {ok:false,error:'插件已停用'} : fn()).catch((error) => {
      ctx.warn('黑话学习任务异常：' + (error?.message ?? error));
      return {ok:false,error:error?.message ?? String(error)};
    });
    taskChain=work.then(()=>{});return work;
  }

  function feed(key, sender, rawText) {
    const cfg = getCfg();
    if (cfg.enabled === false) return;
    if (!key || !rawText || typeof rawText !== 'string') return;
    // 黑话是群聊概念：只学群消息（私聊不喂窗口，避免把私聊原话拿去抽词）
    if (!String(key).startsWith('group:')) return;
    const text = rawText.trim();
    if (!text || text.startsWith('/')) return;
    if (ROLE_CHANGE_RE.test(text)) return;
    if (!windows.has(key)) windows.set(key, []);
    const win = windows.get(key);
    win.push({ sender: String(sender || '未知'), text: text.slice(0, 200), time: Date.now() });
    if (win.length > 80) win.splice(0, win.length - 80);
    maybeQueue(key);
  }

  function maybeQueue(key) {
    const cfg = getCfg();
    if (cfg.enabled === false) return;
    const cd = Number(cfg.extractCooldownMs ?? 300000);
    if (Date.now() - (cooldowns.get(key) || 0) < cd) return;
    const min = Math.max(1, Number(cfg.extractMinMessages ?? 10));
    if ((windows.get(key) || []).length < min) return;
    cooldowns.set(key, Date.now());
    queue(() => runExtraction(key));
  }

  async function runExtraction(key) {
    const cfg = getCfg();
    if (cfg.enabled === false) return;
    const messages = (windows.get(key) || []).slice();
    const min = Math.max(1, Number(cfg.extractMinMessages ?? 10));
    if (messages.length < min) return;
    const prompt = buildExtractionPrompt(messages) + '\n\n【类别边界】本库只收群内黑话、梗、缩写及其特殊语用。游戏玩法、兴趣百科和圈层文化事实请留给“词条学习”，不要把它们作为黑话条目；尤其不能把“入圈/退圈/出圈”写成三角洲玩法。';
    const output = await learnerPrompt(prompt,[key]);
    if (!output) return;
    let items;
    try { items = parseExtractionJson(output); } catch { return; }
    const entries = list();
    if (!items.length) {
      windows.set(key, (windows.get(key) || []).slice(messages.length));
      ctx.log('黑话提取：' + key + ' 未发现候选');
      return;
    }
    let added = 0;
    let updated = 0;
    const researchCandidates = [];
    const thresholds = Array.isArray(cfg.inferenceThresholds) ? cfg.inferenceThresholds.map(Number).filter(Boolean) : [2, 4, 8];
    const seen = new Set();
    for (const item of items) {
      if (!item?.content || seen.has(item.content)) continue;
      seen.add(item.content);
      const idx = Number(item.source_id) - 1;
      const src = Number.isInteger(idx) && idx >= 0 && idx < messages.length ? messages[idx] : null;
      const evidence = src ? [{ key, sender: src.sender, text: src.text, time: src.time }] : [];
      const result = upsertSlangEntry(entries, item.content, { evidence, countIncrement: 1 });
      if (result.created) added += 1; else updated += 1;
      if (result.entry && result.entry.status === SLANG_STATUS.CANDIDATE && thresholds.includes(result.entry.count) && result.entry.count > result.entry.lastInferenceCount) {
        researchCandidates.push(result.entry);
      }
    }
    windows.set(key, (windows.get(key) || []).slice(messages.length));
    save(entries);
    ctx.log(`黑话提取：${key} 新增 ${added} 条，更新 ${updated} 条`);
    if (researchCandidates.length && cfg.autoResearch !== false) queue(() => runResearch(researchCandidates));
  }

  async function runResearch(candidates) {
    const cfg = getCfg();
    if (cfg.enabled === false) return {ok:false,error:'黑话学习已关闭'};
    if (!Array.isArray(candidates) || !candidates.length) return {ok:false,error:'没有可研究的候选黑话'};
    const targets = candidates.filter((e) => e?.id && !researching.has(e.id));
    if (!targets.length) return {ok:false,error:'这些候选正在研究'};
    for (const e of targets) researching.add(e.id);
    try {
      const output = await learnerPrompt(buildResearchPrompt(targets),[...new Set(targets.flatMap(x=>(x.evidence||[]).map(e=>e.key)).filter(Boolean))]);
      if (!output) return {ok:false,error:'学习会话未返回结果或已超时'};
      let results;
      try { results = parseResearchJson(output); } catch { return {ok:false,error:'研究结果解析失败'}; }
      if(!results.length)return {ok:false,error:'研究结果为空或格式不正确'};
      const entries = list();
      const targetIds=new Set(targets.map(e=>e.id));let researched=0,uncertain=0;
      for (const r of results) {
        const entry = entries.find((e) => e.content === r.content);
        if (!entry||!targetIds.has(entry.id)||entry.status!==SLANG_STATUS.CANDIDATE) continue;
        const uncertainMeaning = /^(?:研究未确定[：:]\s*)?(?:不确定|无法确定|无法确认|尚不确定|不是黑话|并非黑话|不属于黑话)(?:[。；，,\s]|$)/.test(String(r.meaning||'').trim());
        if (r.confirmed === true&&r.meaning&&!uncertainMeaning) {
          entry.meaning = r.meaning;
          if (r.usage) entry.usage = r.usage;
          if (r.example) entry.example = r.example;
          if (r.risk) entry.risk = r.risk;
          else if (/^研究未确定[：:]/.test(entry.risk||'')) entry.risk = '';
          if (Array.isArray(r.sources) && r.sources.length) entry.sources = r.sources.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 10);
          researched++;
        } else uncertain++;
        entry.lastInferenceCount = entry.count;
        entry.updatedAt = new Date().toISOString();
      }
      if(!save(entries))return {ok:false,error:'研究结果保存失败'};
      ctx.log(`黑话研究：${researched} 条得到解释，${uncertain} 条仍不确定`);
      return {ok:true,requested:targets.length,researched,uncertain,missing:targets.length-researched-uncertain};
    } finally {
      for (const e of targets) researching.delete(e.id);
    }
  }

  function researchCandidatesByIds(ids) {
    const cfg = getCfg();
    if (cfg.enabled === false) return Promise.resolve({ok:false,error:'黑话学习已关闭'});
    const entries = list();
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    const candidates = entries.filter((e) => e.status === SLANG_STATUS.CANDIDATE && (!wanted.size || wanted.has(String(e.id))));
    if(!candidates.length)return Promise.resolve({ok:false,error:'没有可研究的候选黑话'});
    return queue(async()=>{
      const totals={ok:true,requested:0,researched:0,uncertain:0,missing:0};
      for(let i=0;i<candidates.length;i+=5){
        const result=await runResearch(candidates.slice(i,i+5));
        if(!result?.ok)return {...totals,ok:false,error:result?.error||'研究失败'};
        for(const key of ['requested','researched','uncertain','missing'])totals[key]+=result[key]||0;
      }
      return totals;
    });
  }

  ctx.registerTool?.('slang_research_batch',{description:'管理员按 ID 研究至多五条候选黑话，等待写回并返回实际结果',handler:input=>{
    const ids=[...new Set((Array.isArray(input?.ids)?input.ids:[]).map(String).filter(Boolean))];
    if(!ids.length||ids.length>5)return {ok:false,error:'请选择 1 至 5 条候选黑话'};
    return researchCandidatesByIds(ids);
  }});

  function extractFor(key) {
    const cfg = getCfg();
    if (cfg.enabled === false) return;
    const target = key && windows.has(key) ? key : windows.keys().next().value;
    if (!target) return;
    queue(() => runExtraction(target));
  }

  return {
    dispose() {windows.clear();cooldowns.clear();researching.clear();},
    services: {
      slang: {
        // 每轮提示词注入：当前时间 + 已确认黑话表（桥接 prepend 到 prompt）
        contextBlock(payload={}) {
          const cfg = getCfg();
          const now = new Date();
          const timeLine = '【当前时间】' + now.toLocaleString('zh-CN', { hour12: false }) + '（' + Intl.DateTimeFormat().resolvedOptions().timeZone + '）';
          const parts = [timeLine];
          const selected=defaultEntries(list(),'slang',payload.key,injectLimit(cfg.injectMax,8));
          const block = buildSlangContext(selected,selected.length);
          parts.push(sourceGuidance('slang',cap));
          const hints=queryEnabled(cap,'slang')?lookupHints(list(),'slang',{...payload,injected:selected}):'';if(hints)parts.push(hints);
          if (block) parts.push(block);
          return parts.join('\n\n');
        },
        injectionPreview:({key}={})=>injectionReport(list(),'slang',key,injectLimit(getCfg().injectMax,8)),
        query:input=>queryEntries(list(),'slang',input),
        defaultEntries:({key}={})=>defaultEntries(list(),'slang',key,injectLimit(getCfg().injectMax,8)).map(e=>semanticEntry(e,'slang',key)),
        updateSources:input=>{const rows=list(),out=changeCurrentSource(rows,input);if(out.ok&&out.changed&&!save(rows))return {ok:false,error:'黑话写入失败'};return out;},
        validateSourceKeys:({sourceKeys:keys}={})=>{try{return {ok:true,sourceKeys:sourceKeys(keys)};}catch(error){return {ok:false,error:error.message};}},
        reset() { windows.clear(); cooldowns.clear(); researching.clear(); },
        forget({ key } = {}) { if (key) { windows.delete(key); cooldowns.delete(key); } },
        clearWindows() { windows.clear(); cooldowns.clear(); },
        extract(payload = {}) { extractFor(String(payload.key || '')); return true; },
        research(payload = {}) {
          if (Array.isArray(payload.ids) && payload.ids.length) { researchCandidatesByIds(payload.ids); return true; }
          researchCandidatesByIds([]);
          return true;
        },
        stats() { return { keys: [...windows.keys()], windows: [...windows.entries()].map(([k, v]) => [k, v.length]) }; }
      }
    },
    hooks: {
      onIncoming(payload = {}) {
        if (!payload || payload.isSelf) return;
        feed(String(payload.key || ''), payload.sender, payload.text ?? payload.plainContent);
      },
      onTick({ now = Date.now() } = {}) {
        const cfg = getCfg();
        if (cfg.enabled === false) return;
        // 兜底：窗口里积压的消息（例如 onIncoming 时 DSH 还没就绪）也尝试抽一次
        for (const key of windows.keys()) maybeQueue(key);
        // 清理长期没动的窗口，避免内存泄漏
        for (const [key, win] of windows) {
          const last = win.length ? Number(win[win.length - 1].time) || 0 : 0;
          if (!last || now - last > 24 * 60 * 60 * 1000) windows.delete(key);
        }
      }
    }
  };
}
