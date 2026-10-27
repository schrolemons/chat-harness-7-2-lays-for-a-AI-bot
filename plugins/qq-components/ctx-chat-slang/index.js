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
  const learnerPrompt = async (text) => {
    try { return typeof cap.slangLearnerPrompt === 'function' ? await cap.slangLearnerPrompt(String(text || '')) : null; } catch (error) { ctx.warn('黑话学习会话调用失败：' + (error?.message ?? error)); return null; }
  };

  function queue(fn) {
    taskChain = taskChain.then(() => ctx.isActive?.() === false ? null : fn()).catch((error) => ctx.warn('黑话学习任务异常：' + (error?.message ?? error)));
    return taskChain;
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
    const output = await learnerPrompt(buildExtractionPrompt(messages));
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
    if (cfg.enabled === false) return;
    if (!Array.isArray(candidates) || !candidates.length) return;
    const targets = candidates.filter((e) => e?.id && !researching.has(e.id));
    if (!targets.length) return;
    for (const e of targets) researching.add(e.id);
    try {
      const output = await learnerPrompt(buildResearchPrompt(targets));
      if (!output) return;
      let results;
      try { results = parseResearchJson(output); } catch { return; }
      const entries = list();
      for (const r of results) {
        const entry = entries.find((e) => e.content === r.content);
        if (!entry) continue;
        if (r.confirmed !== true) continue; // 不确定的保留候选，等下次再研究
        if (r.meaning) entry.meaning = r.meaning;
        if (r.usage) entry.usage = r.usage;
        if (r.example) entry.example = r.example;
        if (r.risk) entry.risk = r.risk;
        if (Array.isArray(r.sources) && r.sources.length) entry.sources = r.sources.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 10);
        entry.lastInferenceCount = entry.count;
        entry.updatedAt = new Date().toISOString();
      }
      save(entries);
      ctx.log(`黑话研究：已更新 ${results.length} 条候选解释`);
    } finally {
      for (const e of targets) researching.delete(e.id);
    }
  }

  function researchCandidatesByIds(ids) {
    const cfg = getCfg();
    if (cfg.enabled === false) return;
    const entries = list();
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    const candidates = entries.filter((e) => e.status === SLANG_STATUS.CANDIDATE && (!wanted.size || wanted.has(String(e.id))));
    if (candidates.length) queue(() => runResearch(candidates));
  }

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
        contextBlock() {
          const cfg = getCfg();
          const now = new Date();
          const timeLine = '【当前时间】' + now.toLocaleString('zh-CN', { hour12: false }) + '（' + Intl.DateTimeFormat().resolvedOptions().timeZone + '）';
          const parts = [timeLine];
          const block = buildSlangContext(list(), cfg.injectMax ?? 8);
          if (block) parts.push(block);
          return parts.join('\n\n');
        },
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
