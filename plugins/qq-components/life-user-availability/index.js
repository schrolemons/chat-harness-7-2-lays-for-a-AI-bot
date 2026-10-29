// life-user-availability（L 层｜语义时间约定与免打扰）
//
// 识别由模型负责，登记与执行由这里负责：
//   · 模型自己理解「别打扰 / 工作时段 / 晚上聊 / 改期 / 取消」等时间意愿，
//     通过 qq_availability 工具（桥接端点 /api/socialV2/availability）登记结构化计划；
//   · 本组件不再做关键词或格式解析，只校验参数、落盘、到期执行、
//     以及在免打扰期间拦住自动唤醒。
//
// 支持的约定：
//   daily        每天固定时段免打扰，支持多个时段、跨午夜（如 22:00–08:00）
//   quiet        一次性免打扰（起止 ISO，带时区）
//   later        稍后联系一次（到点唤醒 AI 发一条）
//   indefinite   无限期免打扰（用户现在不想聊又没给结束时间；用户再次直接找来时自动解除）
//
// 状态：state/plugins/life-user-availability.json
// 注意：到期只解除免打扰，不主动问候；只有明确约了「稍后联系」才触发一次联系。

import crypto from 'node:crypto';

// 仅用于丢弃重启后已过时的到期任务，不参与判断用户是否提前回来。
const CONTACT_TASK_EXPIRY_MS = 15 * 60000;

const validISO = (s) => /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s));
const clock = (s) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null);
const fmtMinute = (mins) => {
  const m = Math.max(0, Math.min(1439, Math.round(Number(mins) || 0)));
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
const fmtTime = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0
  ? new Date(Number(ms)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  : '—');

// windows: [{start:'HH:MM', end:'HH:MM'}]；允许跨午夜（start > end）。最多 6 段，去重并排序。
function normalizeWindows(input) {
  if (!Array.isArray(input) || !input.length) return { error: 'daily 需要 windows 数组，例如 [{"start":"09:00","end":"18:00"}]' };
  const seen = new Set();
  const windows = [];
  for (const item of input.slice(0, 6)) {
    const start = clock(String(item?.start ?? '').trim());
    const end = clock(String(item?.end ?? '').trim());
    if (start === null || end === null) return { error: 'windows 里的 start/end 必须是 HH:MM（24 小时制，例如 09:00）' };
    if (start === end) return { error: 'windows 里 start 与 end 不能相同' };
    const key = start + '-' + end;
    if (seen.has(key)) continue;
    seen.add(key);
    windows.push({ start, end });
  }
  windows.sort((a, b) => a.start - b.start);
  return { windows };
}

function describePlan(plan) {
  if (!plan) return '';
  const reason = plan.reason ? '（' + plan.reason + '）' : '';
  if (plan.kind === 'daily') {
    const list = (plan.windows ?? []).map((w) => fmtMinute(w.start) + '–' + fmtMinute(w.end)).join('、');
    return '每天免打扰 ' + list + reason;
  }
  if (plan.kind === 'later') return '稍后联系：' + fmtTime(plan.end) + reason;
  if (plan.kind === 'quiet' && plan.indefinite) return '无限期免打扰，直到用户再次直接找你' + reason;
  return '免打扰 ' + fmtTime(plan.start) + ' ~ ' + fmtTime(plan.end) + reason;
}

export function createPlugin(ctx) {
  const state = () => {
    const s = ctx.state.get();
    return { plans: s.plans || {}, incoming: s.incoming || {}, changes: s.changes || {} };
  };
  const minuteAt = (t) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
    return clock(parts);
  };
  const inWindow = (m, w) => (w.start < w.end ? m >= w.start && m < w.end : m >= w.start || m < w.end);
  const planWindows = (p) => (Array.isArray(p.windows) ? p.windows : (Number.isFinite(p.start) ? [{ start: p.start, end: p.end }] : []));

  function cancel(key, plan) {
    if (plan?.id) ctx.scheduler?.cancel('availability:' + key + ':' + plan.id);
  }

  function isQuiet({ key, now = Date.now() } = {}) {
    const p = state().plans[key];
    if (!p) return false;
    if (p.kind === 'daily') {
      const m = minuteAt(now);
      return planWindows(p).some((w) => inWindow(m, w));
    }
    if (p.kind === 'quiet') return now >= p.start && (!p.end || now < p.end);
    if (p.kind === 'later') return now >= p.start && now < p.end;
    return false;
  }

  function restore({ now = Date.now() } = {}) {
    const s = state();
    for (const [key, p] of Object.entries(s.plans)) {
      if (!p.end || p.kind === 'daily') continue;
      if (p.finished) continue;
      if (now > p.end + CONTACT_TASK_EXPIRY_MS) {
        p.finished = 'expired';
        ctx.state.set({ plans: s.plans });
        continue;
      }
      ctx.scheduler?.schedule({
        id: 'availability:' + key + ':' + p.id,
        owner: ctx.id || 'life-user-availability',
        type: 'user-availability',
        at: p.end,
        expiresAt: p.end + CONTACT_TASK_EXPIRY_MS,
        run: async () => {
          const live = state();
          const current = live.plans[key];
          if (!current || current.id !== p.id || current.finished) return;
          if (p.kind === 'later' && typeof ctx.capabilities?.requestScheduledContact !== 'function') return;
          if (p.kind === 'later' && ctx.capabilities?.scheduledContactReady?.({ key }) === false) return;
          current.finished = p.kind === 'later' ? 'triggered' : 'expired';
          ctx.state.set({ plans: live.plans });
          if (p.kind !== 'later') return;
          await ctx.capabilities?.requestScheduledContact?.({ key, id: p.id });
        }
      });
    }
  }

  function setPlan({ key, kind, windows, startISO, endISO, contactISO, reason, now = Date.now() } = {}) {
    if (!key) return { ok: false, error: '缺少会话 key' };
    const s = state();
    let plan;
    if (kind === 'daily') {
      const normalized = normalizeWindows(windows);
      if (normalized.error) return { ok: false, error: normalized.error };
      plan = { kind: 'daily', windows: normalized.windows };
    } else if (kind === 'quiet') {
      if (!validISO(String(startISO || '')) || !validISO(String(endISO || ''))) {
        return { ok: false, error: '一次性免打扰需要带时区的 startISO / endISO，例如 2026-10-27T22:00:00+08:00' };
      }
      const start = Date.parse(startISO);
      const end = Date.parse(endISO);
      if (end <= start) return { ok: false, error: '结束时间必须晚于开始时间' };
      if (end <= now) return { ok: false, error: '结束时间已经过去了，请确认用户说的日期' };
      plan = { kind: 'quiet', start, end };
    } else if (kind === 'indefinite') {
      plan = { kind: 'quiet', indefinite: true, start: now, end: null };
    } else if (kind === 'later') {
      if (!validISO(String(contactISO || ''))) {
        return { ok: false, error: '稍后联系需要带时区的 contactISO，例如 2026-10-27T20:00:00+08:00' };
      }
      const at = Date.parse(contactISO);
      if (at <= now) return { ok: false, error: '联系时间必须在未来，请确认用户说的日期' };
      plan = { kind: 'later', start: now, end: at };
    } else {
      return { ok: false, error: 'kind 必须是 daily / quiet / later / indefinite' };
    }
    const signature = crypto.createHash('sha256').update(key + ':' + JSON.stringify([kind, windows, startISO, endISO, contactISO])).digest('hex').slice(0, 20);
    const existing = s.plans[key];
    if (existing && !existing.finished && (existing.signature || existing.id) === signature) {
      return { ok: true, duplicate: true, planId: existing.id, kind, summary: describePlan(existing) };
    }
    const id = crypto.randomUUID();
    cancel(key, s.plans[key]);
    plan = { ...plan, id, signature, reason: String(reason || '').slice(0, 120), sourceAt: now, createdAt: now };
    s.plans[key] = plan;
    s.changes[key] = { status: 'scheduled', at: now };
    ctx.state.set(s);
    restore({ now });
    return { ok: true, planId: id, kind, summary: describePlan(plan), until: plan.end ? new Date(plan.end).toISOString() : null };
  }

  function markReturned({ key, planId } = {}) {
    if (!key || !planId) return { ok: false, error: '确认提前回来需要 key 和 planId；请先 query 当前约定' };
    const s = state();
    const current = s.plans[key];
    if (!current && s.changes[key]?.status === 'returned' && s.changes[key]?.planId === planId) {
      return { ok: true, duplicate: true, cancelled: true, planId, summary: '本次稍后联系已因用户回来而撤销' };
    }
    if (!current || current.id !== planId) return { ok: false, error: '约定已变化，请重新 query，不能撤销其他约定' };
    if (current.kind !== 'later') return { ok: false, error: 'returned 只用于本次稍后联系；其他免打扰计划请明确使用 cancel' };
    if (current.finished && current.finished !== 'triggered') return { ok: false, error: '本次联系已完成或过期，无需撤销' };
    cancel(key, current);
    delete s.plans[key];
    s.changes[key] = { status: 'returned', planId, at: Date.now() };
    ctx.state.set(s);
    return { ok: true, cancelled: true, planId, summary: '已确认用户提前回来，撤销本次稍后联系' };
  }

  function cancelPlan({ key } = {}) {
    if (!key) return { ok: false, error: '缺少会话 key' };
    const s = state();
    const current = s.plans[key];
    if (!current) return { ok: true, cancelled: false, summary: '当前没有登记免打扰或联系约定' };
    cancel(key, current);
    delete s.plans[key];
    s.changes[key] = { status: 'cancelled', at: Date.now() };
    ctx.state.set(s);
    return { ok: true, cancelled: true, summary: '已取消之前的约定' };
  }

  function getPlan({ key } = {}) {
    if (!key) return { ok: false, error: '缺少会话 key' };
    const p = state().plans[key];
    if (!p) return { ok: true, plan: null, quietNow: false, summary: '当前没有登记免打扰或联系约定' };
    return {
      ok: true,
      quietNow: isQuiet({ key }),
      plan: {
        id: p.id,
        kind: p.kind,
        windows: p.kind === 'daily' ? planWindows(p).map((w) => ({ start: fmtMinute(w.start), end: fmtMinute(w.end) })) : undefined,
        startISO: p.start ? new Date(p.start).toISOString() : null,
        endISO: p.end ? new Date(p.end).toISOString() : null,
        indefinite: p.indefinite === true,
        reason: p.reason || '',
        status: p.finished || 'active'
      },
      summary: describePlan(p)
    };
  }

  // 兼容旧入口：DSH 重启前，模型拿到的还是旧提示词（用 qq_memory_append 写「免打扰｜…」）。
  // 这里只做「结构化内容 → setPlan」的迁移转交，不参与识别用户意图；新版提示词生效后
  // 模型会直接调 qq_availability，本函数不再被用到。
  function recordMemory({ key, content, now = Date.now() } = {}) {
    const parts = String(content || '').split('｜').map((s) => s.trim());
    if (parts[0] === '免打扰') return setPlan({ key, kind: 'quiet', startISO: parts[1], endISO: parts[2], reason: parts[3], now });
    if (parts[0] === '免打扰每天') return setPlan({ key, kind: 'daily', windows: [{ start: parts[1], end: parts[2] }], reason: parts[3], now });
    if (parts[0] === '稍后联系') return setPlan({ key, kind: 'later', contactISO: parts[1], reason: parts[2], now });
    if (parts[0] === '取消约定') return cancelPlan({ key });
    return null;
  }

  const inst = {
    services: {
      availability: {
        isQuiet,
        setPlan,
        cancelPlan,
        markReturned,
        getPlan,
        restore,
        recordMemory,
        noteDirected(p = {}) { inst.hooks.onIncoming({ ...p, isOwner: true }); },
        markDispatched({ key, id } = {}) {
          const s = state();
          if (s.plans[key]?.id === id) {
            s.plans[key].finished = 'dispatched';
            ctx.state.set({ plans: s.plans });
          }
        },
        canWake(p = {}) {
          const raw = String(p.reason || '');
          const base = raw.split(':')[0];
          const AUTO = /^(?:timeBubble|startupGreeting|careCheck|newsShare|idleRescue|proactiveCheck|replyCheck|timeout|reminder|taskDone|scheduledContact)$/;
          if (base === 'scheduledContact') {
            const plan = state().plans[p.key];
            return !!plan && plan.id === raw.split(':')[1] && !['dispatched', 'expired', 'cancelled'].includes(plan.finished) && Date.now() <= plan.end + CONTACT_TASK_EXPIRY_MS;
          }
          return !AUTO.test(base) || !isQuiet({ key: p.key });
        }
      }
    },
    hooks: {
      onIncoming(p = {}) {
        if (!p.key) return;
        const s = state();
        const current = s.plans[p.key];
        const directed = String(p.key).startsWith('private:') || p.isOwner;
        // 无限期免打扰：用户重新直接找来就算恢复，自动解除（不需要模型再判断）。
        if (directed && current?.kind === 'quiet' && current.indefinite && !current.finished) {
          cancel(p.key, current);
          delete s.plans[p.key];
          s.changes[p.key] = { status: 'returned', at: Date.now() };
        }
        s.incoming[p.key] = { at: Date.now(), text: String(p.text || '').slice(0, 200), directed: !!directed };
        ctx.state.set(s);
      },
      beforePrompt(p = {}) {
        const plan = state().plans[p.key];
        if (!plan) return '';
        return '当前时间约定（本会话）：' + describePlan(plan) + '\n约定编号 planId：' + plan.id
          + '\n如果用户明确提前回来、恢复聊天且本次稍后联系已不再需要，用 qq_availability(action="returned", planId="' + plan.id + '") 撤销本次联系。只有 kind=later 才能这样处理；不因单条发言或经过固定分钟数自动认定回来。改期用 set，取消其他免打扰计划用 cancel，不要只嘴上答应。';
      },
      onTick(p) { restore(p); },
      wakeTail(p = {}) {
        return p.reason === 'scheduledContact'
          ? '【用户约定的稍后联系】按此前用户约好的时间简短联系一次；先看最新消息，用户已经回来或正在聊天则不另发问候。不要追问第二轮，不要重复通知。'
          : '';
      }
    }
  };
  return inst;
}
