// life-daily-worklog（L 层｜每日工作总结）
//
// 每天固定时间（默认 23:00）把「这一天干了什么」汇总成一份 Markdown：
//   state/memory/worklog/<日期>.md
// 数据源全部是桥接已有的运行数据（只读）：
//   · state/memory/tasks-*.md    通用助手收尾前用 qq_task_note 记的中期进度
//   · state/tasks.json           qq_task_spawn 开的独立任务会话
//   · state/tool-calls.jsonl     工具调用与失败
//   · state/token-usage.jsonl    token 消耗
//
// 触发方式：插件宿主每 60 秒调一次 onTick；到点且当天文件不存在才生成。
// 桥接重启后如果发现昨天的日报没写，会先补昨天的（不补历史更早的）。
// 可选：sendToOwner=true 时把摘要发到管理员 QQ（默认关闭，避免打扰）。

import fs from 'node:fs';
import path from 'node:path';
// 入口热载时辅助模块也跟随 generation，防止仍执行旧模板。
const generation = new URL(import.meta.url).search;
const { buildDailyWorklog, dateKeyLocal } = await import('./worklog.js' + generation);
const { buildDailyWorklogSummary } = await import('./summary.js' + generation);

const RETRY_MS = 30 * 60 * 1000;

function intIn(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const hour = intIn(cfg.hour, 0, 23, 23);
  const minute = intIn(cfg.minute, 0, 59, 0);
  const maxChars = intIn(cfg.maxChars, 1000, 20000, 6000);
  const sendToOwner = cfg.sendToOwner === true;
  const capabilities = ctx.capabilities || {};
  const root = ctx.root;
  const dir = path.join(root, 'state', 'memory', 'worklog');
  const summary = dateKey => buildDailyWorklogSummary({ root, dateKey, maxChars: Math.min(maxChars, 880),
    isExcluded: key => { try { return capabilities.isConsoleConversationExcluded?.(key) === true; } catch { return false; } }
  });

  function generateReport(dateKey) {
    const markdown = buildDailyWorklog({ root, dateKey, maxChars });
    if (!markdown) return { ok: false, error: '这一天没有可汇总的数据' };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, dateKey + '.md'), markdown, 'utf8');
    return { ok: true, dateKey, file: 'state/memory/worklog/' + dateKey + '.md', chars: markdown.length, markdown };
  }

  const scheduledAt = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime();

  function visibleReport(markdown) {
    const text = String(markdown || '');
    const hidden = new Set((text.match(/\b(?:group|private):\d+\b/g) || [])
      .filter((key) => { try { return capabilities.isConsoleConversationExcluded?.(key) === true; } catch { return false; } }));
    if (!hidden.size) return text;
    const lines = text.split(/\r?\n/);
    const inTokenSection = lines.some((line, i) => line.startsWith('|') && [...hidden].some((key) => line.includes(key))
      && lines.slice(0, i).some((prev) => prev === '## 五、Token 用量'));
    const result = [];
    let hiddenGroupSection = false;
    let hiddenTokenSection = false;
    let section = '';
    for (const line of lines) {
      if (/^##\s/.test(line)) {
        section = line;
        hiddenGroupSection = false;
        if (inTokenSection && line === '## 五、Token 用量') hiddenTokenSection = true;
      }
      if (hiddenTokenSection) continue;
      if (inTokenSection && line.startsWith('- 模型调用：')) continue;
      if (/^###\s/.test(line) && [...hidden].some((key) => line.includes(key))) hiddenGroupSection = true;
      if (hiddenGroupSection || [...hidden].some((key) => line.includes(key))) continue;
      result.push(line);
    }
    if (section) {
      const at = result.findIndex((line) => /^##\s/.test(line));
      result.splice(at < 0 ? 1 : at, 0, '> 已根据控制台排除设置隐藏相关会话条目及汇总。', '');
    }
    return result.join('\n');
  }

  // 手动生成/补生成（管理端调用 /api/plugins/call：tool=worklog_generate）。
  // 定时生成走下面的 onTick；这个工具只用于验证和补数据，不会自动被模型调用。
  ctx.registerTool('worklog_generate', {
    description: '手动生成某一天的每日工作总结（默认今天）：写入 state/memory/worklog/<日期>.md 并返回路径与字数。',
    schema: { date: { type: 'string', description: 'YYYY-MM-DD，默认今天' } },
    handler: async (input = {}) => {
      const wanted = String(input.date || '').trim();
      const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : dateKeyLocal(new Date());
      const result = generateReport(dateKey);
      if (!result.ok) return result;
      return { ok: true, dateKey: result.dateKey, file: result.file, chars: result.chars };
    }
  });

  // 控制台只读日报索引与预览；严格限制日期和文件类型，不生成、不发送。
  ctx.registerTool('worklog_history', {
    description: '只读列出最近的运维日报，或读取指定日期的 Markdown 内容。',
    schema: { date: { type: 'string', description: '可选 YYYY-MM-DD；不填时列出最近日报' }, limit: { type: 'number', description: '列表条数，最多 60' } },
    handler: async (input = {}) => {
      const reportsDir = path.resolve(dir);
      const wanted = String(input.date || '').trim();
      const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? new Date(`${wanted}T00:00:00.000Z`) : null;
      if (wanted && (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== wanted)) {
        return { ok: false, error: '日期必须是有效的 YYYY-MM-DD' };
      }
      let entries = [];
      try {
        entries = fs.readdirSync(reportsDir, { withFileTypes: true })
          .filter((entry) => {
            if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name)) return false;
            const date = entry.name.slice(0, 10);
            const parsed = new Date(`${date}T00:00:00.000Z`);
            return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
          })
          .map((entry) => {
            const date = entry.name.slice(0, 10);
            const file = path.join(reportsDir, entry.name);
            const stat = fs.statSync(file);
            return { date, chars: visibleReport(fs.readFileSync(file, 'utf8')).length, updatedAt: stat.mtimeMs };
          })
          .sort((a, b) => b.date.localeCompare(a.date));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (wanted) {
        const found = entries.find((entry) => entry.date === wanted);
        if (!found) return { ok: false, error: '没有这一天的运维日报' };
        return { ok: true, ...found, text: visibleReport(fs.readFileSync(path.join(reportsDir, `${wanted}.md`), 'utf8')) };
      }
      const limit = intIn(input.limit, 1, 60, 14);
      return { ok: true, reports: entries.slice(0, limit) };
    }
  });

  return {
    services: {
      worklog: {
        generateNow() {
          const result = generateReport(dateKeyLocal(new Date()));
          return result.ok ? { ...result, sendText: summary(result.dateKey) } : result;
        }
      }
    },
    hooks: {
      async onTick({ now = Date.now() } = {}) {
        try {
          const d = new Date(now);
          const today = dateKeyLocal(d);
          const dueToday = now >= scheduledAt(d);
          const target = dueToday ? today : dateKeyLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12, 0, 0, 0));
          const st = ctx.state.get();
          if (dueToday && st.lastGeneratedDate === today) return; // 今天到点后已经写过，不再覆盖
          const file = path.join(dir, target + '.md');
          // 到点前（补昨天）：文件已存在就跳过；到点后生成今天：允许覆盖（例如白天手动生成过）
          if (!dueToday && fs.existsSync(file)) return;
          if (st.lastAttemptDate === target && now - Number(st.lastAttemptAt || 0) < RETRY_MS) return;
          ctx.state.set({ lastAttemptDate: target, lastAttemptAt: now });
          const markdown = buildDailyWorklog({ root, dateKey: target, maxChars });
          if (!markdown) return; // 当天还没有数据：30 分钟后再试
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file, markdown, 'utf8');
          if (dueToday) ctx.state.set({ lastGeneratedDate: today });
          ctx.log('已生成每日工作总结 state/memory/worklog/' + target + '.md（' + markdown.length + ' 字）');
          if (sendToOwner && target===today && typeof ctx.capabilities?.notifyOwnerOnce === 'function') {
            await ctx.capabilities.notifyOwnerOnce('【每日工作总结】\n' + summary(target),{id:'worklog:'+target,sourceAt:now,expiresAt:now+2*3600000});
          }
        } catch (error) {
          ctx.warn('生成每日工作总结失败：' + (error?.message ?? error));
        }
      }
    }
  };
}
