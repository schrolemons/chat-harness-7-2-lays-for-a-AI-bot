// life-schedule-reminder（L 层｜日程工具与提醒调度）
//
// 把「日程」从提示词约定升级成真正的数据结构与工具：
//   · 存储：本插件 state（state/plugins/life-schedule-reminder.json），跨上下文重置/会话重置保留；
//   · 登记：qq_schedule（MCP）→ 桥接 POST /api/socialV2/schedules → services.schedules.*；
//   · 调度：onTick（60 秒）挑出「提前 advanceMinutes 分钟」到点的条目，交给桥接能力
//     requestReminderWake 放 pendingReminderItems + 触发 reminder 唤醒（文案仍走 life-wake-reasons）；
//   · 展示：beforePrompt 注入未来 horizonDays 天的日程，模型不用自己盯时间。
//
// 日程统一存储于本组件。桥接不再把「日程｜」文本当作日程，也不保留第二套提醒路径。

const DAY = 24 * 60 * 60 * 1000;
const MAX_TEXT = 200;
const pad2 = (n) => String(n).padStart(2, '0');

function fmtLocal(ts) {
  const d = new Date(Number(ts));
  if (!Number.isFinite(d.getTime())) return '';
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// when 支持：ISO（带 Z/+08:00）、'YYYY-MM-DD HH:MM[:SS]'、只有日期（按当天 09:00，沿用旧约定）。
// 解析失败返回 NaN —— 让调用方明确报错、模型去补问时间，而不是猜。
function parseWhen(when) {
  const raw = String(when ?? '').trim();
  if (!raw) return NaN;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(raw);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return NaN;
    if (m[4] === undefined) return new Date(y, mo, d, 9, 0, 0, 0).getTime();
    const hh = Number(m[4]);
    const mi = Number(m[5]);
    const ss = m[6] === undefined ? 0 : Number(m[6]);
    if (hh > 23 || mi > 59 || ss > 59) return NaN;
    if (m[7]) {
      const zone = m[7].toUpperCase() === 'Z' ? 'Z' : m[7].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
      const iso = y + '-' + pad2(mo + 1) + '-' + pad2(d) + 'T' + pad2(hh) + ':' + pad2(mi) + ':' + pad2(ss) + zone;
      return Date.parse(iso);
    }
    // 无时区：按桥接/服务器本地时间（Asia/Shanghai）理解。
    return new Date(y, mo, d, hh, mi, ss, 0).getTime();
  }
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : NaN;
}

function normalizeKey(key) {
  const k = String(key ?? '').trim();
  return /^(private|group):\d+$/.test(k) ? k : '';
}

function normalizeRepeat(repeat) {
  const r = String(repeat ?? '').trim().toLowerCase();
  if (r === 'daily' || r === '每天') return 'daily';
  if (r === 'weekly' || r === '每周') return 'weekly';
  return 'none';
}

function clamp(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function scheduleLine(item) {
  const parts = [fmtLocal(item.dueAt), String(item.title || '')];
  if (item.place) parts.push(String(item.place));
  if (item.detail) parts.push(String(item.detail));
  if (item.repeat && item.repeat !== 'none') parts.push('重复：' + (item.repeat === 'daily' ? '每天' : '每周'));
  return parts.filter(Boolean).join('｜').slice(0, MAX_TEXT);
}

function view(item) {
  return {
    id: item.id,
    key: item.key,
    title: item.title,
    dueAt: item.dueAt,
    when: fmtLocal(item.dueAt),
    dueISO: new Date(Number(item.dueAt)).toISOString(),
    place: item.place || '',
    detail: item.detail || '',
    repeat: item.repeat || 'none',
    createdAt: item.createdAt,
    lastRemindedAt: item.lastRemindedAt || 0,
    firedAt: item.firedAt || 0
  };
}

// Display is time-based, not reminder-based: firedAt means an advance reminder
// was queued, so a future one-off event must remain visible until its due time.
// Recurrence projection is read-only; onTick remains responsible for persistence.
function upcomingItem(item, now) {
  if (item.expired || item.cancelledAt || item.canceledAt || item.completedAt
      || /^(cancelled|canceled|completed|expired)$/.test(String(item.status || '').toLowerCase())) return null;
  const dueAt = Number(item.dueAt);
  if (!Number.isFinite(dueAt) || !Number.isFinite(new Date(dueAt).getTime())) return null;
  if (dueAt > now) return item;
  if (item.firedAt || (item.repeat !== 'daily' && item.repeat !== 'weekly')) return null;
  const step = item.repeat === 'daily' ? DAY : 7 * DAY;
  return { ...item, dueAt: dueAt + (Math.floor((now - dueAt) / step) + 1) * step };
}

export function createPlugin(ctx) {
  const cfg = () => (ctx.config && typeof ctx.config === 'object' ? ctx.config : {});
  const cap = () => (ctx.capabilities && typeof ctx.capabilities === 'object' ? ctx.capabilities : {});
  const maxItems = () => clamp(cfg().maxItems, 10, 1000, 200);
  const state = () => {
    const s = ctx.state.get();
    return {
      items: Array.isArray(s.items) ? s.items.filter((x) => x && typeof x === 'object') : [],
      backfill: s.backfill && typeof s.backfill === 'object' && !Array.isArray(s.backfill) ? s.backfill : {}
    };
  };
  const save = (patch) => { try { ctx.state.set(patch); } catch (error) { ctx.warn?.('状态写入失败：' + (error?.message ?? error)); } };

  let idSeed = 0;
  function newId() {
    idSeed += 1;
    return 'sch-' + Date.now().toString(36) + '-' + idSeed.toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function addItem(payload = {}) {
    const key = normalizeKey(payload.key);
    if (!key) return { ok: false, error: 'key 必须是 private:QQ号 或 group:群号' };
    const title = String(payload.title ?? '').trim().slice(0, 120);
    if (!title) return { ok: false, error: 'title 不能为空（写清是什么事，例如「计算机系统大作业截止」）' };
    const numericDue = Number(payload.dueAt);
    const dueAt = payload.when === undefined && Number.isFinite(numericDue) && numericDue > 0
      ? numericDue
      : parseWhen(payload.when ?? payload.dueAt);
    if (!Number.isFinite(dueAt)) {
      return { ok: false, error: 'when 解析失败：请传 ISO 时间（带时区，如 2026-11-22T23:59:00+08:00）或 YYYY-MM-DD HH:MM；只有日期按当天 09:00。时间不确定时先问清楚再登记。' };
    }
    if (dueAt < Date.now() - 60 * 1000) return { ok: false, error: 'when 已经过期：' + fmtLocal(dueAt) + '；如果要提醒未来的事，请给未来时间。' };
    const st = state();
    const duplicated = st.items.find((it) => it.key === key && String(it.title || '') === title && Math.abs(Number(it.dueAt) - dueAt) < 60 * 1000);
    if (duplicated) return { ok: true, duplicated: true, item: view(duplicated), message: '已有同一条日程，未重复添加' };
    const item = {
      id: newId(),
      key,
      title,
      place: String(payload.place ?? '').trim().slice(0, 120),
      detail: String(payload.detail ?? '').trim().slice(0, 300),
      dueAt,
      repeat: normalizeRepeat(payload.repeat),
      createdAt: Date.now()
    };
    st.items.push(item);
    if (st.items.length > maxItems()) st.items = st.items.slice(-maxItems());
    save({ items: st.items });
    return { ok: true, item: view(item), message: '已登记，' + fmtLocal(dueAt) + ' 的事，提前提醒你' };
  }

  function listItems(payload = {}) {
    const key = normalizeKey(payload.key);
    if (!key) return { ok: false, error: 'key 必须是 private:QQ号 或 group:群号' };
    const now = Date.now();
    const includePast = payload.includePast === true;
    const limit = clamp(payload.limit, 1, 100, 50);
    const st = state();
    const items = st.items
      .filter((it) => it.key === key)
      .map((it) => includePast ? it : upcomingItem(it, now))
      .filter(Boolean)
      .sort((a, b) => Number(a.dueAt) - Number(b.dueAt))
      .slice(0, limit)
      .map(view);
    return { ok: true, key, count: items.length, items, note: items.length ? '' : (includePast ? '这个会话还没有登记日程' : '这个会话暂无未来日程') };
  }

  function listAllItems(payload = {}) {
    const includePast = payload.includePast === true;
    const now = Date.now();
    const groups = new Map();
    for (const stored of state().items) {
      if (!normalizeKey(stored.key)) continue;
      const item = includePast ? stored : upcomingItem(stored, now);
      if (!item) continue;
      if (!groups.has(item.key)) groups.set(item.key, []);
      groups.get(item.key).push(view(item));
    }
    return { ok: true, conversations: [...groups].map(([key, items]) => ({
      key, items: items.sort((a, b) => a.dueAt - b.dueAt)
    })) };
  }

  function cancelItem(payload = {}) {
    const key = normalizeKey(payload.key);
    if (!key) return { ok: false, error: 'key 必须是 private:QQ号 或 group:群号' };
    const id = String(payload.id ?? '').trim();
    const match = String(payload.match ?? payload.title ?? '').trim();
    if (!id && !match) return { ok: false, error: '取消日程需要 id 或 match（标题关键词）；不确定就先用 list 看' };
    const st = state();
    const idx = st.items.findIndex((it) => it.key === key && (id ? String(it.id) === id : String(it.title || '').includes(match)));
    if (idx < 0) return { ok: false, error: '找不到这条日程（可能已提醒过或被取消）；用 list 看看当前有哪些' };
    const [removed] = st.items.splice(idx, 1);
    save({ items: st.items });
    return { ok: true, removed: view(removed), message: '已取消：' + removed.title + '｜' + fmtLocal(removed.dueAt) };
  }

  function fireDue(now) {
    const c = cfg();
    if (c.enabled === false) return;
    const st = state();
    let changed = false;
    const advanceMs = clamp(c.advanceMinutes, 1, 1440, 30) * 60 * 1000;
    const lateMs = clamp(c.lateMinutes, 1, 1440, 120) * 60 * 1000;
    const groups = new Map();
    for (const it of st.items) {
      if (it.firedAt) continue;
      const dueAt = Number(it.dueAt);
      if (!Number.isFinite(dueAt)) { it.firedAt = now; it.expired = true; changed = true; continue; }
      if (now < dueAt - advanceMs) continue;
      if (it.repeat === 'none' && now > dueAt + lateMs) { it.firedAt = now; it.expired = true; changed = true; continue; }
      const arr = groups.get(it.key) || [];
      arr.push(it);
      groups.set(it.key, arr);
    }
    if (!groups.size) {
      if (changed) save({ items: prune(st.items, now) });
      return;
    }
    const capabilities = cap();
    for (const [key, arr] of groups) {
      // 桥接能力负责「能不能提醒」（模式/静音/白名单），组件只负责条目与重复规则。
      let woken = false;
      try {
        woken = typeof capabilities.requestReminderWake === 'function'
          && capabilities.requestReminderWake(key, arr.map((it) => ({ text: scheduleLine(it), dueAt: Number(it.dueAt) }))) === true;
      } catch (error) {
        ctx.warn?.('requestReminderWake 失败：' + (error?.message ?? error));
        woken = false;
      }
      if (!woken) continue; // 静音/暂停/非 reserved2：条目保留，下个 tick 再试
      for (const it of arr) {
        it.lastRemindedAt = now;
        changed = true;
        if (it.repeat === 'daily' || it.repeat === 'weekly') {
          const step = it.repeat === 'daily' ? DAY : 7 * DAY;
          let next = Number(it.dueAt) + step;
          while (next - advanceMs <= now) next += step;
          it.dueAt = next;
        } else {
          it.firedAt = now;
        }
      }
      ctx.log?.('日程提醒 ' + key + '：' + arr.map((it) => it.title).join(' / '));
    }
    if (changed) save({ items: prune(st.items, now) });
  }

  function prune(items, now) {
    const kept = [];
    for (const it of items) {
      if (it.firedAt && now - Number(it.firedAt) > (it.expired ? DAY : 7 * DAY)) continue;
      kept.push(it);
    }
    return kept.slice(-maxItems());
  }

  return {
    services: {
      schedules: {
        add: (payload = {}) => addItem(payload),
        list: (payload = {}) => listItems(payload),
        listAll: (payload = {}) => listAllItems(payload),
        cancel: (payload = {}) => cancelItem(payload),
      }
    },
    hooks: {
      onTick({ now = Date.now() } = {}) {
        fireDue(now);
      },
      beforePrompt(payload = {}) {
        if (/^(memoryWrite|selfReview|selfOptimize|slangLearn)$/.test(String(payload?.reason || ''))) return '';
        const key = normalizeKey(payload.key);
        if (!key) return '';
        const c = cfg();
        if (c.enabled === false) return '';
        const horizonDays = clamp(c.horizonDays, 1, 90, 14);
        const maxPromptItems = clamp(c.maxPromptItems, 1, 20, 8);
        const now = Date.now();
        const horizon = now + horizonDays * DAY;
        const st = state();
        const upcoming = st.items
          .filter((it) => it.key === key)
          .map((it) => upcomingItem(it, now))
          .filter((it) => it && Number(it.dueAt) <= horizon)
          .sort((a, b) => Number(a.dueAt) - Number(b.dueAt))
          .slice(0, maxPromptItems);
        if (!upcoming.length) return '';
        const lines = upcoming.map((it) => '- ' + scheduleLine(it));
        ctx.addPromptBlock('【日程安排（未来 ' + horizonDays + ' 天）】\n' + lines.join('\n')
          + '\n到点桥接会自动唤醒你提醒；增删改用 qq_schedule（add / list / cancel），不用自己盯时间。');
        return '';
      }
    }
  };
}
