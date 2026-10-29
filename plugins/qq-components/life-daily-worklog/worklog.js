// 每日工作总结的数据汇总（纯函数 + 只读文件）。
//
// 目的：把「今天到底干了什么」从散落的运行数据里汇总成一份可读的日报：
//   · 当前事务 state/memory/affairs/*.json；迁移前 Markdown 只作历史日报来源
//   · 任务会话注册表 state/tasks.json（qq_task_spawn 开的独立任务）
//   · 工具调用账本 state/tool-calls.jsonl（谁调了什么、失败几次）
//   · token 账本 state/token-usage.jsonl（白饭消耗）
//
// 只读，不改任何文件；写文件由插件负责。

import fs from 'node:fs';
import path from 'node:path';

const pad2 = (n) => String(n).padStart(2, '0');

/** 本地时区日期键 YYYY-MM-DD */
export function dateKeyLocal(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function readJson(file, fallback) {
  try { return JSON.parse(readText(file)); } catch { return fallback; }
}

function listFiles(dir, prefix, suffix) {
  try {
    return fs.readdirSync(dir)
      .filter((n) => n.startsWith(prefix) && n.endsWith(suffix))
      .map((n) => path.join(dir, n));
  } catch { return []; }
}

/** 解析 tasks-*.md：只保留 dateKey 当天的进度条目。 */
export function collectTaskNotes(root, dateKey) {
  const dir = path.join(root, 'state', 'memory');
  const out = [];
  for (const file of listFiles(dir, 'tasks-', '.md')) {
    const label = path.basename(file).replace(/^tasks-/, '').replace(/\.md$/, '');
    const key = label.replace(/^private_/, 'private:').replace(/^group_/, 'group:');
    const lines = readText(file).split(/\r?\n/);
    let cur = null;
    const entries = [];
    const flush = () => {
      if (!cur || cur.dateKey !== dateKey) return;
      const body = cur.lines.join('\n').trim();
      if (body) entries.push({ time: cur.time, body });
    };
    for (const line of lines) {
      const h = /^## \[(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\]/.exec(line.trim());
      if (h) {
        flush();
        cur = { dateKey: `${h[1]}-${pad2(h[2])}-${pad2(h[3])}`, time: h[4], lines: [] };
        continue;
      }
      if (cur) cur.lines.push(line);
    }
    flush();
    if (entries.length) out.push({ key, file: path.basename(file), entries });
  }
  // Canonical affairs own all post-migration progress; receipts are never work items.
  const canonical = [];
  const canonicalKeys = new Set();
  for (const file of listFiles(path.join(dir, 'affairs'), '', '.json')) {
    const doc = readJson(file, null);
    if (!doc || doc.version !== 1 || !Array.isArray(doc.items)) continue;
    if (dateKey >= dateKeyLocal(doc.migrations?.initial?.at || 0)) canonicalKeys.add(doc.key);
    const entries = [];
    for (const item of doc.items) {
      for (const version of [...(item.history || []), { ...item, at: item.updatedAt }]) {
        if (item.id.startsWith('import-') && version.revision === 1) continue;
        if (dateKeyLocal(version.at) !== dateKey) continue;
        const time = new Date(version.at).toLocaleTimeString('zh-CN', { hour12: false });
        entries.push({ time, id: item.id, title: version.title, status: version.status, detail: version.detail, nextAction: version.nextAction, body: `[${item.id}｜${version.status}] ${version.title}\n${version.detail}${version.nextAction ? '\n下一步：' + version.nextAction : ''}` });
      }
    }
    if (entries.length) canonical.push({ key: doc.key, file: path.basename(file), entries });
  }
  return [...out.filter(item => !canonicalKeys.has(item.key)), ...canonical];
}

/** 任务会话：当天创建或当天更新过的任务。 */
export function collectTaskSessions(root, dateKey) {
  const doc = readJson(path.join(root, 'state', 'tasks.json'), {});
  const tasks = doc && typeof doc.tasks === 'object' && doc.tasks ? Object.values(doc.tasks) : [];
  const fmtTime = (ms) => {
    const d = new Date(Number(ms) || 0);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };
  return tasks
    .filter((t) => t && typeof t === 'object')
    .filter((t) => dateKeyLocal(t.createdAt) === dateKey || dateKeyLocal(t.updatedAt) === dateKey)
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
    .map((t) => ({
      id: String(t.id || ''),
      title: String(t.title || '未命名任务'),
      status: String(t.status || 'unknown'),
      createdAt: Number(t.createdAt) || 0,
      updatedAt: Number(t.updatedAt) || 0,
      at: fmtTime(t.createdAt),
      result: String(t.result || t.error || '').trim()
    }));
}

/** 工具调用统计：只统计 time 落在 dateKey 的条目。 */
export function collectToolStats(root, dateKey) {
  const files = [
    path.join(root, 'state', 'tool-calls.jsonl.1'),
    path.join(root, 'state', 'tool-calls.jsonl')
  ];
  const byTool = new Map();
  let calls = 0;
  let errors = 0;
  for (const file of files) {
    const text = readText(file);
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (!rec || !rec.time) continue;
      if (dateKeyLocal(rec.time) !== dateKey) continue;
      if (rec.type === 'call') {
        calls += 1;
        const name = String(rec.tool || 'unknown');
        const item = byTool.get(name) || { calls: 0, errors: 0 };
        item.calls += 1;
        byTool.set(name, item);
      } else if (rec.type === 'result' && rec.ok === false) {
        errors += 1;
        const name = String(rec.tool || 'unknown');
        const item = byTool.get(name) || { calls: 0, errors: 0 };
        item.errors += 1;
        byTool.set(name, item);
      }
    }
  }
  const top = [...byTool.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 12)
    .map(([name, v]) => ({ name, ...v }));
  return { calls, errors, top };
}

/** token 用量：按模型和会话汇总当天数据。 */
export function collectTokenStats(root, dateKey) {
  const files = [
    path.join(root, 'state', 'token-usage.jsonl.1'),
    path.join(root, 'state', 'token-usage.jsonl')
  ];
  const byKey = new Map();
  const byModel = new Map();
  let steps = 0;
  const add = (map, name) => {
    const item = map.get(name) || { steps: 0, input: 0, output: 0 };
    map.set(name, item);
    return item;
  };
  for (const file of files) {
    const text = readText(file);
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (!rec || rec.k !== 'turn' || !rec.t) continue;
      if (dateKeyLocal(rec.t) !== dateKey) continue;
      const b = rec.b || {};
      const input = (Number(b.cacheMiss) || 0) + (Number(b.cacheHit) || 0) + (Number(b.cacheWrite) || 0);
      const output = (Number(b.output) || 0) + (Number(b.reasoning) || 0);
      steps += 1;
      const km = add(byKey, String(rec.key || 'unknown'));
      km.steps += 1; km.input += input; km.output += output;
      const mm = add(byModel, String(rec.model || rec.provider || 'unknown'));
      mm.steps += 1; mm.input += input; mm.output += output;
    }
  }
  const sortMap = (map) => [...map.entries()]
    .sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))
    .map(([name, v]) => ({ name, ...v }));
  return { steps, keys: sortMap(byKey), models: sortMap(byModel) };
}

/** 反馈修复账本事件：只写入运维动作和计数，不把用户反馈原文复制进日报。 */
export function collectFeedbackEvents(root, dateKey) {
  const doc = readJson(path.join(root, 'state', 'plugins', 'obs-self-review.json'), {});
  const events = Array.isArray(doc?.queueEvents) ? doc.queueEvents : [];
  const today = events.filter(e => e?.at && dateKeyLocal(e.at) === dateKey);
  const labels = { submitted: '新收反馈', research_started: '转移到 DSH 研究', resolved: '已修复', retry: '继续待处理', hidden: '从处理队列删除', deleted: '已删除', transfer: '从困难问题移回队列末尾', difficulty: '转入困难列表' };
  return {
    total: today.length,
    byAction: Object.fromEntries(Object.entries(labels).map(([key, label]) => [label, today.filter(e => e.action === key).length]).filter(([, n]) => n)),
    entries: today.map(e => ({ at: String(e.at), action: labels[e.action] || String(e.action || '更新'), id: String(e.id || '') }))
  };
}

/** 读取规范化的自我更新文件，只纳入当日结构化标题；旧混合内容已另存归档。 */
export function collectOptimizationSummary(root, dateKey) {
  const text=readText(path.join(root,'state','memory','_optimization.md'));
  if(!text.startsWith('# 自我更新发现与统一修复摘要'))return [];
  const lines=text.split(/\r?\n/), out=[]; let section=''; let current=null;
  const flush=()=>{if(current?.date===dateKey){const body=current.lines.join('\n').trim();if(body)out.push({section:current.section,heading:current.heading,body});}current=null;};
  for(const line of lines){
    if(/^##\s/.test(line)){flush();section=line.replace(/^##\s+/,'').trim();continue;}
    if(/^###\s/.test(line)){
      flush();const match=/\((\d{4}-\d{2}-\d{2}T[^)]+)\)\s*·\s*(.*)$/.exec(line);
      if(match)current={date:dateKeyLocal(Date.parse(match[1])),section,heading:match[2],lines:[]};
      continue;
    }
    if(current)current.lines.push(line);
  }
  flush();
  return out;
}

function fmtNum(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e4) return Math.round(v / 1000) + 'k';
  return String(Math.round(v));
}

/**
 * 生成一份 Markdown 日报。
 * @returns {string|null} 没有任何数据时返回 null（调用方据此决定是否重试）
 */
export function buildDailyWorklog({ root, dateKey }) {
  if (!root || !dateKey) throw new Error('buildDailyWorklog 需要 root 与 dateKey');
  const notes = collectTaskNotes(root, dateKey);
  const tasks = collectTaskSessions(root, dateKey);
  const tools = collectToolStats(root, dateKey);
  const tokens = collectTokenStats(root, dateKey);
  const feedback = collectFeedbackEvents(root, dateKey);
  const optimization = collectOptimizationSummary(root,dateKey);

  const hasData = notes.length || tasks.length || tools.calls || tokens.steps || feedback.total || optimization.length;
  if (!hasData) return null;

  const now = new Date();
  const lines = [];
  lines.push(`# ${dateKey} 工作总结（自动生成）`);
  lines.push('');
  lines.push(`> 生成时间：${dateKeyLocal(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())} · 数据来源：任务进度 / 任务会话 / 工具调用 / token 账本 / 自我更新发现与统一修复摘要 / 反馈队列事件`);
  lines.push('');

  // 概览
  const done = tasks.filter((t) => t.status === 'done').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const running = tasks.filter((t) => t.status === 'running').length;
  lines.push('## 一、概览');
  lines.push(`- 任务会话：${tasks.length} 个` + (tasks.length ? `（完成 ${done} / 失败 ${failed} / 进行中 ${running}）` : ''));
  lines.push(`- 工具调用：${tools.calls} 次` + (tools.errors ? `，其中失败 ${tools.errors} 次` : '，无失败'));
  lines.push(`- 模型调用：${tokens.steps} 步，输入 ${fmtNum(tokens.keys.reduce((s, k) => s + k.input, 0))} tokens（含缓存命中），输出 ${fmtNum(tokens.keys.reduce((s, k) => s + k.output, 0))} tokens`);
  lines.push(`- 有进度记录的会话：${notes.length} 个` + (notes.length ? '（' + notes.map((n) => n.key).join('、') + '）' : ''));
  lines.push(`- 反馈队列事件：${feedback.total} 条` + (feedback.total ? '（' + Object.entries(feedback.byAction).map(([k,v]) => `${k} ${v}`).join(' · ') + '）' : ''));
  lines.push('');

  if (feedback.entries.length) {
    lines.push('## 二、反馈与修复队列');
    for (const e of feedback.entries) lines.push(`- ${new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false })} ${e.action}${e.id ? `（编号 ${e.id}）` : ''}`);
    lines.push('> 为保护反馈隐私，日报只记录队列动作和编号，不复制反馈正文。');
    lines.push('');
  }

  if(optimization.length){
    lines.push('## 三、自我更新发现与统一修复摘要');
    for(const entry of optimization){
      lines.push(`### ${entry.section} · ${entry.heading}`);
      for(const row of entry.body.split(/\r?\n/).filter(Boolean))lines.push(row);
    }
    lines.push('');
  }

  if (tasks.length) {
    lines.push('## 四、任务会话');
    for (const t of tasks) {
      const statusText = { done: '完成', failed: '失败', running: '进行中' }[t.status] || t.status;
      lines.push(`- [${statusText}] ${t.title}（${t.at} 创建）`);
      if (t.result) lines.push(`  - 结果：${t.result.replace(/\s+/g, ' ')}`);
    }
    lines.push('');
  }

  if (notes.length) {
    lines.push('## 五、当日进度记录');
    for (const group of notes) {
      lines.push(`### ${group.key}`);
      for (const e of group.entries) {
        lines.push(`- ${e.time} ${e.body.replace(/\s+/g, ' ').trim()}`);
      }
      lines.push('');
    }
  }

  if (tools.top.length) {
    lines.push('## 六、工具调用');
    lines.push('| 工具 | 次数 | 失败 |');
    lines.push('| --- | --- | --- |');
    for (const t of tools.top) lines.push(`| ${t.name} | ${t.calls} | ${t.errors} |`);
    lines.push('');
  }

  if (tokens.steps) {
    lines.push('## 七、Token 用量');
    lines.push('| 会话 | 步数 | 输入 | 输出 |');
    lines.push('| --- | --- | --- | --- |');
    for (const k of tokens.keys) lines.push(`| ${k.name} | ${k.steps} | ${fmtNum(k.input)} | ${fmtNum(k.output)} |`);
    if (tokens.models.length) {
      lines.push('');
      lines.push('按模型：' + tokens.models.map((m) => `${m.name}（${fmtNum(m.input + m.output)}）`).join('、'));
    }
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}
