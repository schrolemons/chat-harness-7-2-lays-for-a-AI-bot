// 全局用户画像组件（global user profiles）
//
// 目标：
//   · 一份跨会话、跨群/私聊都有效的用户状态（谁、在哪些会话出现过、互动多少次、我记下的备注）；
//   · 分成两层：完整 info（只存在本地，给管理端看/给 AI 判断用）与可分享 info（能被拿到别的会话里当谈资）；
//   · 可分享层强制脱敏：不出现 QQ 号/电话/地址/密码/邮箱/真实姓名，长数字串一律拒绝；
//   · 结构化字段（称呼/喜欢/讨厌/最近/名言）由 profile-extract.js 规则抽取写入，不靠模型记忆。
//
// 只读写 state/user-profiles.json，不发消息。

import fs from 'node:fs';
import path from 'node:path';

const MAX_USERS = 500;
const MAX_NOTES_PER_USER = 20;
const MAX_NAMES_PER_USER = 5;
const MAX_KEYS_PER_USER = 10;
const FIELD_MAX = { aliases: 3, likes: 5, dislikes: 4, recents: 4, quotes: 3, routines: 8 };

const FORBIDDEN_RE = /(QQ|qq|微信|vx|VX|电话|手机|地址|住址|密码|验证码|身份证|银行卡|真实姓名|真名|学号|工号|邮箱)/;
const CONTACT_RE = /(@|https?:\/\/|www\.|\.com|\.cn|[\w.+-]+@[\w-]+\.[\w.]+)/;

/** 能不能拿去别的会话讲：只放性格/喜好/趣事，不放联系方式与身份信息。 */
export function isShareableTrait(text) {
  const t = String(text || '').trim();
  if (t.length < 4 || t.length > 60) return false;
  if (FORBIDDEN_RE.test(t)) return false;
  if (CONTACT_RE.test(t)) return false;
  if (/\d{5,}/.test(t)) return false;
  return true;
}

function nowSafe(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : Date.now();
}

function keyOf({ userId, name }) {
  const id = String(userId || '').trim();
  if (id) return 'u:' + id;
  const n = String(name || '').trim();
  return n ? 'n:' + n : '';
}

function blank() {
  return { version: 1, users: {}, updatedAt: 0 };
}

function cleanArr(list, max) {
  return (Array.isArray(list) ? list : [])
    .map((x) => String(x || '').trim().slice(0, 40))
    .filter(Boolean)
    .slice(-max);
}

function emptyFields() {
  return { aliases: [], likes: [], dislikes: [], recents: [], quotes: [], routines: [] };
}

// 作息解析与固定展示块在 src/user-routines.js（单独模块：插件热加载时不会被旧模块缓存挡住）。
export { ROUTINE_LABELS, routineKind, parseRoutine, normalizeRoutineEntry, collectRoutineEntries, routineView, foodTaste, routineBlockLines } from './user-routines.js';
import { routineKind, collectRoutineEntries, routineBlockLines } from './user-routines.js';

function ensureShape(raw) {
  const base = blank();
  if (!raw || typeof raw !== 'object' || !raw.users || typeof raw.users !== 'object') return base;
  for (const [k, v] of Object.entries(raw.users)) {
    if (!v || typeof v !== 'object') continue;
    const f = v.fields && typeof v.fields === 'object' ? v.fields : {};
    base.users[k] = {
      userId: v.userId != null ? String(v.userId).slice(0, 20) : null,
      names: Array.isArray(v.names) ? v.names.map(String).slice(0, MAX_NAMES_PER_USER) : [],
      keys: Array.isArray(v.keys) ? v.keys.map(String).slice(0, MAX_KEYS_PER_USER) : [],
      isOwner: !!v.isOwner,
      warmConnectionAt: Number(v.warmConnectionAt) || 0,
      firstSeenAt: Number(v.firstSeenAt) || 0,
      lastSeenAt: Number(v.lastSeenAt) || 0,
      messageCount: Number(v.messageCount) || 0,
      notes: Array.isArray(v.notes)
        ? v.notes
          .map((n) => (n && typeof n === 'object' ? { text: String(n.text || '').slice(0, 60), at: Number(n.at) || 0, shared: !!n.shared } : null))
          .filter((n) => n && n.text)
          .slice(-MAX_NOTES_PER_USER)
        : [],
      fields: {
        aliases: cleanArr(f.aliases, FIELD_MAX.aliases),
        likes: cleanArr(f.likes, FIELD_MAX.likes),
        dislikes: cleanArr(f.dislikes, FIELD_MAX.dislikes),
        recents: cleanArr(f.recents, FIELD_MAX.recents),
        quotes: cleanArr(f.quotes, FIELD_MAX.quotes),
        routines: cleanArr(f.routines, FIELD_MAX.routines)
      }
    };
  }
  return base;
}

/**
 * @param {{ file: string, logger?: (msg: string) => void }} opts
 */
export function createUserProfileStore(opts = {}) {
  const file = String(opts.file || '');
  const log = typeof opts.logger === 'function' ? opts.logger : () => {};
  let data = null;
  let dirty = false;

  function load() {
    if (data) return data;
    try {
      if (file && fs.existsSync(file)) data = ensureShape(JSON.parse(fs.readFileSync(file, 'utf8')));
      else data = blank();
    } catch (error) {
      log('[user-profile] 读取失败，按空库处理: ' + (error?.message ?? error));
      data = blank();
    }
    return data;
  }

  function save() {
    if (!dirty) return !!file;
    if (!file) return false;
    try {
      data.updatedAt = Date.now();
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
      fs.renameSync(tmp, file);
      dirty = false;
      return true;
    } catch (error) {
      log('[user-profile] 写盘失败: ' + (error?.message ?? error));
      return false;
    }
  }

  function touch(meta) {
    const store = load();
    const k = keyOf(meta);
    if (!k) return null;
    if (!store.users[k] && Object.keys(store.users).length >= MAX_USERS) {
      let oldest = null;
      let oldestAt = Infinity;
      for (const [uk, uv] of Object.entries(store.users)) {
        const at = Number(uv.lastSeenAt) || 0;
        if (at < oldestAt) { oldestAt = at; oldest = uk; }
      }
      if (oldest) delete store.users[oldest];
    }
    const at = nowSafe(meta.at);
    const u = store.users[k] || {
      userId: meta.userId != null ? String(meta.userId).slice(0, 20) : null,
      names: [],
      keys: [],
      isOwner: false,
      warmConnectionAt: 0,
      firstSeenAt: at,
      lastSeenAt: at,
      messageCount: 0,
      notes: [],
      fields: emptyFields()
    };
    if (!u.fields || typeof u.fields !== 'object') u.fields = emptyFields();
    const name = String(meta.name || '').trim().slice(0, 30);
    if (name && !u.names.includes(name)) {
      u.names.push(name);
      if (u.names.length > MAX_NAMES_PER_USER) u.names.shift();
    }
    const convKey = String(meta.key || '').trim().slice(0, 40);
    if (convKey && !u.keys.includes(convKey)) {
      u.keys.push(convKey);
      if (u.keys.length > MAX_KEYS_PER_USER) u.keys.shift();
    }
    if (meta.isOwner) u.isOwner = true;
    u.lastSeenAt = Math.max(Number(u.lastSeenAt) || 0, at);
    if (!u.firstSeenAt) u.firstSeenAt = at;
    u.messageCount = (Number(u.messageCount) || 0) + 1;
    store.users[k] = u;
    dirty = true;
    save();
    return u;
  }

  function mergeField(u, field, values) {
    if (!Array.isArray(values) || !values.length) return false;
    if (!u.fields || typeof u.fields !== 'object') u.fields = emptyFields();
    if (!Array.isArray(u.fields[field])) u.fields[field] = [];
    let changed = false;
    for (const raw of values) {
      const v = String(raw || '').trim().slice(0, 40);
      if (!v) continue;
      if (u.fields[field].includes(v)) continue;
      u.fields[field].push(v);
      changed = true;
    }
    const max = FIELD_MAX[field] || 5;
    if (u.fields[field].length > max) u.fields[field] = u.fields[field].slice(-max);
    return changed;
  }

  return {
    /** 收到消息时调用：谁、在哪个会话、什么时候。 */
    recordContact(meta) {
      try { return touch(meta || {}); } catch { return null; }
    },
    /** AI 写下对某人的印象时调用：只在通过脱敏时进「可分享」层。 */
    recordNote(meta = {}) {
      try {
        const text = String(meta.trait || meta.text || '').trim().slice(0, 60);
        if (!text) return false;
        const shareable = isShareableTrait(text);
        const u = touch({ userId: meta.userId, name: meta.name, key: meta.key, at: meta.at });
        if (!u) return false;
        if (u.notes.some((n) => n.text === text)) return true;
        u.notes.push({ text, at: nowSafe(meta.at), shared: shareable });
        if (u.notes.length > MAX_NOTES_PER_USER) u.notes.shift();
        dirty = true;
        save();
        return shareable;
      } catch { return false; }
    },
    /** 已核实的群内正向印象：写入人物档案并持久标记亲近关系，不重复计作一条来信。 */
    recordPromotedImpression(meta = {}) {
      try {
        const userId = String(meta.userId || '').trim();
        const key = String(meta.key || '').trim();
        if (!/^\d{1,20}$/.test(userId) || !key.startsWith('group:')) return false;
        const k = 'u:' + userId;
        const u = load().users[k];
        if (!u || !u.keys.includes(key)) return false;
        const target = String(meta.target || '').trim().toLocaleLowerCase();
        const knownNames = [...u.names, ...(u.fields?.aliases || []), String(meta.name || '')]
          .map((n) => String(n || '').trim().toLocaleLowerCase()).filter(Boolean);
        if (!target || !knownNames.includes(target)) return false;
        const traits = (Array.isArray(meta.traits) ? meta.traits : [])
          .map((x) => String(x || '').trim().slice(0, 60)).filter(Boolean).slice(0, 10);
        if (!traits.length) return false;
        let changed = false;
        for (const text of traits) {
          if (u.notes.some((n) => n.text === text)) continue;
          u.notes.push({ text, at: nowSafe(meta.at), shared: isShareableTrait(text) });
          if (u.notes.length > MAX_NOTES_PER_USER) u.notes.shift();
          changed = true;
        }
        const at = nowSafe(meta.at);
        if (u.warmConnectionAt !== at) { u.warmConnectionAt = at; changed = true; }
        if (changed) dirty = true;
        if (!save()) return false;
        const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
        const saved = persisted?.users?.[k];
        return !!saved && Number(saved.warmConnectionAt) === at
          && traits.every((text) => Array.isArray(saved.notes) && saved.notes.some((n) => n?.text === text));
      } catch { return false; }
    },
    /** 规则抽取出来的结构化事实（称呼/喜欢/讨厌/最近/名言）→ 写入画像。 */
    recordFacts(meta = {}) {
      try {
        const facts = meta.facts && typeof meta.facts === 'object' ? meta.facts : null;
        if (!facts) return false;
        const u = touch({ userId: meta.userId, name: meta.name, key: meta.key, at: meta.at });
        if (!u) return false;
        // 作息入口统一收口（routines 短句/对象、workWindows、breakfast/lunch/dinner/wake/sleep）。
        const routineInputs = collectRoutineEntries(facts);
        let changed = false;
        for (const field of Object.keys(FIELD_MAX)) {
          if (field !== 'routines') { changed = mergeField(u, field, facts[field]) || changed; continue; }
          if (!routineInputs.length) continue;
          if (!Array.isArray(u.fields.routines)) u.fields.routines = [];
          for (const value of routineInputs) {
            if (!value) continue;
            const kind = routineKind(value);
            const previous = kind ? u.fields.routines.findIndex((item) => routineKind(item) === kind) : -1;
            if (previous >= 0) {
              if (u.fields.routines[previous] !== value) { u.fields.routines[previous] = value; changed = true; }
            } else if (!u.fields.routines.includes(value)) { u.fields.routines.push(value); changed = true; }
          }
          if (u.fields.routines.length > FIELD_MAX.routines) u.fields.routines = u.fields.routines.slice(-FIELD_MAX.routines);
        }
        if (changed) { dirty = true; save(); }
        return changed;
      } catch { return false; }
    },
    /** 取「完整 info」：管理端/AI 自己看。 */
    snapshot() {
      const store = load();
      return JSON.parse(JSON.stringify(store));
    },
    /**
     * 生成注入提示词的画像块。
     * @param {{ participants?: string[], maxShare?: number, includeParticipants?: boolean, excludeTexts?: string[] }} opts
     */
    blockFor(opts = {}) {
      try {
        const store = load();
        const list = Object.entries(store.users).map(([k, v]) => ({ k, ...v }));
        if (!list.length) return { text: '', shared: [] };
        const participants = (Array.isArray(opts.participants) ? opts.participants : []).map((p) => String(p || '').trim()).filter(Boolean);
        const norm = (s) => String(s || '').toLowerCase();
        const isParticipant = (u) => participants.some((p) => {
          const q = norm(p);
          if (!q) return false;
          return norm(u.userId) === q || u.names.some((n) => norm(n) === q) || u.keys.some((x) => norm(x).endsWith(':' + q));
        });

        const here = opts.includeParticipants === false ? [] : list.filter(isParticipant).sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0)).slice(0, 5);
        const others = opts.includeOthers === false ? [] : list.filter((u) => !isParticipant(u) && (u.notes.some((n) => n.shared) || (u.fields && (u.fields.likes.length || u.fields.quotes.length))));

        const normalizeFact = (value) => String(value || '').toLocaleLowerCase()
          .replace(/^\s*(名言|喜欢|喜好|偏好)[：:]\s*/, '')
          .replace(/[\s，。！？、；：:「」『』“”‘’"'()（）【】\[\]{}]/g, '');
        const excludedFacts = new Set((Array.isArray(opts.excludeTexts) ? opts.excludeTexts : []).map(normalizeFact).filter(Boolean));
        const isExcludedFact = (value) => {
          const normalized = normalizeFact(value);
          if (!normalized) return false;
          for (const excluded of excludedFacts) {
            if (normalized === excluded || (excluded.length >= 8 && normalized.includes(excluded)) || (normalized.length >= 8 && excluded.includes(normalized))) return true;
          }
          return false;
        };

        const lines = [];
        if (here.length) {
          lines.push('【本会话用户画像（完整，仅供你判断，别念出来）】');
          for (const u of here) {
            const name = u.names[u.names.length - 1] || (u.isOwner ? '管理员' : (u.userId ? 'QQ ' + u.userId : '某人'));
            const where = u.keys.length > 1 ? `出现过 ${u.keys.length} 个会话` : '本会话';
            const last = u.lastSeenAt ? `${Math.max(0, Math.round((Date.now() - u.lastSeenAt) / 60000))} 分钟前` : '未知';
            const f = u.fields || emptyFields();
            const bits = [];
            if (f.aliases.length) bits.push('称呼：' + f.aliases.join('/'));
            if (f.likes.length) bits.push('喜欢：' + f.likes.join('、'));
            if (f.dislikes.length) bits.push('讨厌：' + f.dislikes.join('、'));
            if (f.recents.length) bits.push('最近：' + f.recents.slice(-2).join('；'));
            const routineLines = opts.allowPrivateRoutines === true && u.userId && participants.includes(u.userId)
              ? routineBlockLines(f.routines, { fields: f })
              : [];
            const noteText = u.notes.slice(-2).map((n) => n.text).join('；');
            lines.push(`- ${name}${u.isOwner ? '（管理员）' : ''}：互动 ${u.messageCount} 次，${where}，最近 ${last}`
              + (bits.length ? `；${bits.join('；')}` : '')
              + (noteText ? `；我记下的：${noteText}` : ''));
            if (routineLines.length) {
              // 固定「作息」块：只在这个人自己的私聊里出现，没有数据就整块不出现。
              lines.push('  〔作息·仅本私聊〕本人明确分享过；到点附近顺口贴合一句即可，不催促、不假定对方有空：');
              for (const line of routineLines) lines.push('    · ' + line);
            }
          }
        }

        const maxShare = Math.max(1, Math.min(5, Number(opts.maxShare) || 3));
        const pool = [];
        for (const u of others) {
          const name = u.names[u.names.length - 1] || (u.isOwner ? '管理员' : '某人');
          for (const n of u.notes) if (n.shared && !isExcludedFact(n.text)) pool.push({ name, text: n.text, at: n.at || 0 });
          const f = u.fields || emptyFields();
          for (const t of f.likes || []) if (isShareableTrait(t) && !isExcludedFact('喜欢' + t)) pool.push({ name, text: '喜欢' + t, at: u.lastSeenAt || 0 });
          for (const t of f.quotes || []) if (isShareableTrait(t) && !isExcludedFact('「' + t + '」')) pool.push({ name, text: '「' + t + '」', at: u.lastSeenAt || 0 });
        }
        pool.sort((a, b) => (a.at || 0) - (b.at || 0));
        const start = pool.length ? Math.floor(Date.now() / 60000) % pool.length : 0;
        const shared = [];
        for (let i = 0; i < pool.length && shared.length < maxShare; i += 1) {
          const item = pool[(start + i) % pool.length];
          if (!item || shared.some((s) => s.text === item.text)) continue;
          shared.push(item);
        }
        if (shared.length) {
          lines.push('【别处听来的（可自然引用，只当谈资）】');
          for (const s of shared) lines.push(`- ${s.name}：${s.text}`);
          lines.push('注意：这些只是可分享的趣事/偏好，禁止透露任何联系方式、号码、住址、账号密码、聊天原文或截图；也不要说"我从别的群/别人那里知道的"。');
        }
        return { text: lines.length ? lines.join('\n') : '', shared };
      } catch {
        return { text: '', shared: [] };
      }
    }
  };
}
