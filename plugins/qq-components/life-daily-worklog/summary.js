// 面向用户的短报：按事项归并，先保留概览、结果、待办和归档入口。
import fs from 'node:fs';
import path from 'node:path';
const { collectTaskNotes, collectTaskSessions, collectToolStats, collectTokenStats, collectFeedbackEvents, collectOptimizationSummary } =
  await import('./worklog.js' + new URL(import.meta.url).search);

const flat = value => String(value || '').replace(/\s+/g, ' ').trim();
function brief(value, limit) {
  const text = flat(value);
  if (text.length <= limit) return text;
  // 部署/验证限制可能位于长结果末尾，压缩时优先保留，不能仅截取成功描述。
  const caveats = [...new Set(text.match(/(?:尚未|暂未|还未|未)(?:上线|部署|验证|核实|确认|应用到运行环境)/g) || [])].join('、');
  const suffix = caveats ? '；' + caveats : '';
  const head = text.slice(0, Math.max(10, limit - suffix.length - 1));
  const boundary = Math.max(head.lastIndexOf('。'), head.lastIndexOf('；'));
  return (boundary >= head.length / 2 ? head.slice(0, boundary + 1) : head) + '…' + suffix;
}
function readable(root, file, json = false) {
  try {
    const text = fs.readFileSync(path.join(root, 'state', file), 'utf8');
    if (json) JSON.parse(text);
    return true;
  } catch { return false; }
}
const number = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? Math.round(n / 1000) + 'k' : String(n);

export function buildDailyWorklogSummary({ root, dateKey, maxChars = 880, isExcluded = () => false }) {
  const tasks = collectTaskSessions(root, dateKey);
  const notes = collectTaskNotes(root, dateKey).filter(group => !isExcluded(group.key));
  const tools = collectToolStats(root, dateKey);
  const tokens = collectTokenStats(root, dateKey);
  const tokenKeys = tokens.keys.filter(item => !isExcluded(item.name));
  const feedback = collectFeedbackEvents(root, dateKey);
  const updates = collectOptimizationSummary(root, dateKey);
  const available = stem => readable(root, stem + '.jsonl') || readable(root, stem + '.jsonl.1');
  const outcomes = new Map(), pending = new Map();
  for (const task of tasks) {
    const result = task.result || '缺少结果记录，具体交付与部署状态未核实。';
    const status = { done: '会话已完成', running: '进行中', failed: '会话失败' }[task.status] || '状态待核实';
    (task.status === 'done' ? outcomes : pending).set(flat(task.title), `${task.title}：${status}；${result}`);
  }
  // 同一事务的多次修改只保留当日最后状态，不把历史完成状态当作最终结果。
  const affairs = new Map();
  for (const group of notes) for (const entry of group.entries) {
    if (/^通知已发[：:]/.test(entry.body)) continue;
    affairs.set(group.key + ':' + (entry.id || flat(entry.body)), entry);
  }
  for (const entry of affairs.values()) {
    if (['cancelled', 'canceled', 'deleted', 'superseded'].includes(entry.status)) continue;
    const title = flat(entry.title || entry.body.replace(/^\[[^\]]+\]\s*/, ''));
    if (outcomes.has(title) || pending.has(title)) continue;
    const line = entry.title ? `${entry.title}：${entry.detail || '见完整进度记录'}${entry.nextAction ? '；下一步：' + entry.nextAction : ''}` : '进展记录：' + title;
    (entry.status && !['done', 'completed', 'resolved'].includes(entry.status) ? pending : outcomes).set(title, line);
  }
  for (const update of updates) {
    if (!outcomes.has(flat(update.heading)) && !pending.has(flat(update.heading)))
      outcomes.set(flat(update.heading), `更新记录｜${update.heading}：${update.body}`);
  }

  const overview = [
    readable(root, 'tasks.json', true)
      ? `- 任务会话：${tasks.length} 个（完成 ${tasks.filter(t => t.status === 'done').length} / 失败 ${tasks.filter(t => t.status === 'failed').length} / 进行中 ${tasks.filter(t => t.status === 'running').length}）`
      : '- 任务会话：未采集',
    available('tool-calls') ? `- 工具调用：${tools.calls} 次，失败 ${tools.errors} 次` : '- 工具调用：未采集',
    available('token-usage') ? `- 模型调用：${tokenKeys.reduce((s, k) => s + k.steps, 0)} 步；输入 ${number(tokenKeys.reduce((s, k) => s + k.input, 0))}（含缓存命中），输出 ${number(tokenKeys.reduce((s, k) => s + k.output, 0))} tokens` : '- 模型调用：未采集',
    readable(root, 'plugins/obs-self-review.json', true) ? `- 反馈处理：${Object.entries(feedback.byAction).map(([label, count]) => `${label} ${count}`).join('；') || '当天无队列事件'}` : '- 反馈处理：未采集'
  ];
  const render = (count, width) => [
    `# ${dateKey} 工作总结`, `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`, '', '## 一、概览', ...overview, '',
    '## 二、今日主要成果',
    ...(outcomes.size ? [...outcomes.values()].slice(0, count).map(value => '- ' + brief(value, width)) : ['- 缺少可核实的成果记录；调用数量不代表工作完成。']), '',
    '## 三、未完成与后续',
    ...(pending.size ? [...pending.values()].slice(0, count).map(value => '- ' + brief(value, width)) : ['- 未发现明确的未完成记录；未记录的验证或部署状态仍待核实。']), '',
    '## 四、反馈与修复', '- 数量见概览，明细见完整记录；队列标记不代表真实使用已验证。', '',
    `完整记录：state/memory/worklog/${dateKey}.md`
  ].join('\n');
  const budget = Math.min(880, Math.max(600, Number(maxChars) || 880));
  // 删除次要条目、缩短单条描述；不截整份报告，四个章节和归档入口始终保留。
  for (const [count, width] of [[5, 140], [3, 100], [2, 90], [1, 90], [1, 55]]) {
    const report = render(count, width);
    if (report.length <= budget) return report;
  }
  // 极端计数/标签只压缩统计说明，仍保留每类统计和最关键事项。
  for (let i = 0; i < overview.length; i++) overview[i] = brief(overview[i], 105);
  return render(1, 55);
}
