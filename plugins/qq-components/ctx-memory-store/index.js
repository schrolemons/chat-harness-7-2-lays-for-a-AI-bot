// ctx-memory-store（C 层｜记忆存储与调度）
//
// 从 bridge.js 搬走「记忆的存储/调度侧」：
//   · 持久记忆文件读写（state/memory/<会话>.md）
//   · <MEMORY> 捕获写盘
//   · 每小时重写调度（到点让桥接发 memoryWrite 唤醒）
//   · 每日日记 22:00：到点先强制刷新一次记忆（force 跳过「会话繁忙」），刷新完成后再发（含重启后的补发）
//
// 桥接仍负责：DSH 回合/唤醒（requestMemoryWrite 能力）、QQ 发送（sendSessionText 能力）、
// 会话白名单与忙碌/静音判断。插件通过 ctx.root 直接读写 state/memory（与桥接同进程、同一用户）。

import fs from 'node:fs';
import path from 'node:path';
const memoryModule = relative => { const url = new URL(relative, import.meta.url); url.search = new URL(import.meta.url).search; return import(url.href); };
const { createAffairStore } = await memoryModule('./affairs.mjs');
const { parseMemoryDocument, renderPersistentDocument, mergePersistentDocument } = await memoryModule('./sections.mjs');

const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

function safeKey(key) {
  return String(key || '').replace(/[^a-zA-Z0-9]/g, '_');
}
function memoryFile(root, key) {
  return path.join(root, 'state', 'memory', safeKey(key) + '.md');
}
function readMemory(root, key) {
  const file = memoryFile(root, key);
  try {
    const text = fs.readFileSync(file, 'utf8');
    let updatedAt = 0;
    try { updatedAt = fs.statSync(file).mtimeMs; } catch {}
    return { text, updatedAt };
  } catch { return { text: '', updatedAt: 0 }; }
}
function extractDiary(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const sectionName = (line) => {
    const value = String(line || '').trim();
    const bracketed = /^(?:#{1,3}\s*)?【([^】]+)】\s*$/.exec(value);
    if (bracketed) return bracketed[1].trim();
    const markdown = /^#{1,3}\s+(.+?)\s*$/.exec(value);
    return markdown ? markdown[1].trim() : '';
  };
  const start = lines.findIndex((line) => sectionName(line) === '日记');
  if (start < 0) return '';
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (sectionName(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
}
function writeMemory(root, key, text) {
  const file = memoryFile(root, key);
  const body = String(text || '').trim();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body + '\n', 'utf8');
  return body.length;
}

// ── 日记按天归档（state/memory/diary/<YYYY-MM-DD>.md）────────────────────────
// 记忆文件每次重写都会整段覆盖【日记】，旧日记只能靠这里留档：
// 发送成功后把当天正文追加到当天文件；同一天同一会话只写一节，别的会话继续追加。
const ARCHIVE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ARCHIVE_TRUNCATED = '\n\n…（已截断）\n';
const clockOf = (d = new Date()) => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
const diaryArchiveDir = (root) => path.join(root, 'state', 'memory', 'diary');
const diaryArchiveFile = (root, day) => path.join(diaryArchiveDir(root), day + '.md');
function diaryArchiveMaxChars(config = {}) {
  const raw = Number(config?.diaryArchive?.maxChars);
  return Math.min(200000, Math.max(200, Number.isFinite(raw) && raw > 0 ? raw : 20000));
}
function hasDiaryArchiveSection(text, key) {
  return String(text || '').includes('## ' + key + ' ·');
}
function writeDiaryArchive({ root, key, day, text, now = Date.now(), maxChars, replaceExisting = false } = {}) {
  const date = String(day || '');
  if (!ARCHIVE_DATE_RE.test(date)) return { ok: false, error: '日期格式不正确' };
  const body = String(text || '').trim();
  if (!body) return { ok: false, error: '日记为空' };
  const file = diaryArchiveFile(root, date);
  let existing = '';
  try { existing = fs.readFileSync(file, 'utf8'); } catch {}
  let head = existing.trim() ? existing.replace(/\s+$/, '') + '\n\n' : '# ' + date + ' 日记\n\n';
  if (hasDiaryArchiveSection(existing, key)) {
    if (!replaceExisting) return { ok: true, date, skipped: true };
    const lines = existing.split(/\r?\n/);
    const start = lines.findIndex((line) => line.startsWith('## ' + key + ' ·'));
    if (start >= 0) {
      let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
      if (end < 0) end = lines.length;
      lines.splice(start, end - start, '## ' + key + ' · ' + clockOf(new Date(now)), body);
      head = lines.join('\n').replace(/\s+$/, '') + '\n';
    }
  }
  const max = Math.max(200, Number(maxChars) || diaryArchiveMaxChars());
  let next = hasDiaryArchiveSection(existing, key) && replaceExisting
    ? head : head + '## ' + key + ' · ' + clockOf(new Date(now)) + '\n' + body + '\n';
  let truncated = false;
  if (next.length > max) {
    next = next.slice(0, Math.max(0, max - ARCHIVE_TRUNCATED.length)).replace(/\s+$/, '') + ARCHIVE_TRUNCATED;
    truncated = true;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, 'utf8');
  return { ok: true, date, chars: next.length, truncated };
}
function markDiaryArchiveSent({ root, key, day, now = Date.now() } = {}) {
  const file = diaryArchiveFile(root, String(day || ''));
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('## ' + key + ' ·'));
  if (start < 0) return false;
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end < 0) end = lines.length;
  const content = lines.slice(start + 1, end).filter((line) => !line.startsWith('> 已发送：'));
  const d = new Date(now);
  const sentAt = dateKey(d) + ' ' + clockOf(d) + ':' + pad2(d.getSeconds());
  lines.splice(start + 1, end - start - 1, '> 已发送：' + sentAt, ...content);
  fs.writeFileSync(file, lines.join('\n').replace(/\s+$/, '') + '\n', 'utf8');
  return true;
}
function listDiaryArchives(root, { limit = 30 } = {}) {
  const raw = Number(limit);
  const max = Math.min(200, Math.max(1, Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30));
  let names = [];
  try { names = fs.readdirSync(diaryArchiveDir(root)); } catch { return { ok: true, dates: [] }; }
  const days = names
    .filter((name) => /\.md$/i.test(String(name)))
    .map((name) => String(name).slice(0, -3))
    .filter((date) => ARCHIVE_DATE_RE.test(date))
    .sort()
    .reverse()
    .slice(0, max);
  const dates = days.map((date) => {
    let text = '';
    try { text = fs.readFileSync(diaryArchiveFile(root, date), 'utf8'); } catch {}
    const keys = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('## ')) continue;
      const rest = line.slice(3).trim();
      const at = rest.lastIndexOf(' ·');
      keys.push(at > 0 ? rest.slice(0, at).trim() : rest);
    }
    return { date, count: keys.length, keys, chars: text.length };
  });
  return { ok: true, dates };
}
function allDiaryArchiveDays(root) {
  try {
    return fs.readdirSync(diaryArchiveDir(root)).filter((name) => /\.md$/i.test(String(name)))
      .map((name) => String(name).slice(0, -3)).filter((day) => ARCHIVE_DATE_RE.test(day)).sort();
  } catch { return []; }
}
function readDiaryArchive(root, { date } = {}) {
  const day = String(date || '');
  if (!ARCHIVE_DATE_RE.test(day)) return { ok: false, error: '日期格式不正确' };
  try {
    return { ok: true, date: day, text: fs.readFileSync(diaryArchiveFile(root, day), 'utf8') };
  } catch {
    return { ok: false, error: '没有这一天的归档' };
  }
}
function diaryFromArchive(root, day, key) {
  let text = '';
  try { text = fs.readFileSync(diaryArchiveFile(root, day), 'utf8'); } catch { return ''; }
  const lines = text.split(/\r?\n/);
  const marker = '## ' + key + ' ·';
  const start = lines.findIndex((line) => line.startsWith(marker));
  if (start < 0) return '';
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end += 1;
  return lines.slice(start + 1, end).join('\n').replace(/\n*…（已截断）\s*$/, '').trim();
}
function diaryForDay(root, key, day) {
  if (!ARCHIVE_DATE_RE.test(String(day || ''))) return { text: '', source: '', updatedAt: 0 };
  const mem = readMemory(root, key);
  const currentDiary = dateKey(new Date(mem.updatedAt)) === day ? extractDiary(mem.text) : '';
  const archivedDiary = currentDiary ? '' : diaryFromArchive(root, day, key);
  return {
    text: currentDiary || archivedDiary,
    source: currentDiary ? 'memory' : archivedDiary ? 'archive' : '',
    updatedAt: mem.updatedAt
  };
}
function prevDateKey(now = Date.now()) {
  const d = new Date(now);
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12, 0, 0, 0));
}
function diaryWindowLabel(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!match) return '';
  const end = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  const key = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  return key(start) + ' 22:00 至 ' + key(end) + ' 22:00';
}

export function createPlugin(ctx) {
  const root = ctx.root;
  const cap = ctx.capabilities || {};
  const RETRY_MS = 5 * 60 * 1000;
  const affairStore = createAffairStore(root);
  const readyKeys = new Set();
  function ensureAffairs(key) {
    if (!readyKeys.has(key)) {
      affairStore.migrate({ key, persistentText: readMemory(root, key).text });
      readyKeys.add(key);
    }
  }
  const affairsService = Object.fromEntries(Object.entries(affairStore).map(([name, action]) => [name, input => {
    ensureAffairs(input?.key);
    try { return action(input); } catch (error) {
      if (name === 'upsert') return { ok: false, error: error.message };
      throw error;
    }
  }]));
  function receiptNotes(key) { return affairsService.receipts({ key }); }
  function writePersistent(key, text, merge = false) {
    if (String(text || '').length > 200000) throw new Error('单次提交超过 200000 字符；未截断、未写入。自动事实累积容量不按此截断');
    ensureAffairs(key);
    const incoming = parseMemoryDocument(text);
    for (const line of incoming.unfinished) {
      const title = line.replace(/^[-*]\s*/, '').trim().slice(0, 120);
      if (!title || /^(?:无|暂无|（无）)$/.test(title)) continue;
      const existing = affairsService.find({ key, detail: line });
      if (!existing) affairsService.upsert({ key, title, detail: line, status: 'needs_review', source: '会话记忆未完成事项导入；须核对现状' });
    }
    const body = merge ? mergePersistentDocument(readMemory(root, key).text, text) : renderPersistentDocument(incoming);
    return writeMemory(root, key, body);
  }

  const cfg = () => {
    try { return {...((typeof cap.memoryConfig === 'function' ? cap.memoryConfig() : null) || {}),...(ctx.config||{})}; } catch { return {}; }
  };
  const keys = () => {
    try { const list = typeof cap.listConversationKeys === 'function' ? cap.listConversationKeys() : []; return Array.isArray(list) ? list : []; } catch { return []; }
  };
  const state = () => {
    const s = ctx.state.get();
    return {
      lastWriteAt: s.lastWriteAt && typeof s.lastWriteAt === 'object' ? s.lastWriteAt : {},
      lastDiaryDate: s.lastDiaryDate && typeof s.lastDiaryDate === 'object' ? s.lastDiaryDate : {},
      retryAt: s.retryAt && typeof s.retryAt === 'object' ? s.retryAt : {},
      forceWriteAt: s.forceWriteAt && typeof s.forceWriteAt === 'object' ? s.forceWriteAt : {},
      lastIncomingAt: s.lastIncomingAt && typeof s.lastIncomingAt === 'object' ? s.lastIncomingAt : {},
      diaryBackfill: s.diaryBackfill && typeof s.diaryBackfill === 'object' ? s.diaryBackfill : {}
    };
  };
  const saveState = (patch) => ctx.state.set(patch);

  function lastDiaryDateFromNotes(notes) {
    const dates = [...String(notes || '').matchAll(/日记已发：(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
    return dates.sort().at(-1) || '';
  }
  function mergeDiaryDate(...values) {
    return values.map((v) => String(v || '')).filter((v) => ARCHIVE_DATE_RE.test(v)).sort().at(-1) || '';
  }
  function notesContainDiaryDate(notes, day) {
    const escaped = String(day || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('日记已发：' + escaped + '(?!\\d)').test(String(notes || ''));
  }
  function diaryArchiveHasDay(key, day) {
    try { return hasDiaryArchiveSection(fs.readFileSync(diaryArchiveFile(root, day), 'utf8'), key); } catch { return false; }
  }
  function diaryDateRecorded({ key, day, st, notes = '' } = {}) {
    return String(st?.lastDiaryDate?.[key] || '') === day
      || notesContainDiaryDate(notes, day);
  }
  async function sendDiaryDetailed({key,now=Date.now(),day=dateKey(new Date(now)),allowArchiveRetry=false,manualRequestId=''}={}) {
    const targetKey = String(key || '');
    if (!/^(?:group|private):\d+$/.test(targetKey)) return { ok: false, reason: 'invalid_key' };
    if (!ARCHIVE_DATE_RE.test(String(day))) return { ok: false, reason: 'invalid_day', day: String(day || '') };
    const manualId = /^[a-zA-Z0-9-]{8,80}$/.test(String(manualRequestId || '')) ? String(manualRequestId) : '';
    const st=state(),notes=receiptNotes(targetKey);
    const noteDate = lastDiaryDateFromNotes(notes);
    const previousDate = mergeDiaryDate(st.lastDiaryDate[targetKey], noteDate);
    const recordedForDay = diaryDateRecorded({ key: targetKey, day, st, notes });
    const receiptId = 'diary:' + targetKey + ':' + day + (manualId ? ':manual:' + manualId : '');
    let receipt = null;
    if (typeof cap.deliveryStatus === 'function') {
      try { receipt = await cap.deliveryStatus(receiptId); } catch { receipt = { ok: false, status: 'unavailable' }; }
      if (receipt?.ok !== true) return { ok: false, reason: 'receipt_unavailable', day };
      if (receipt.status === 'sent') {
        st.lastDiaryDate[targetKey] = mergeDiaryDate(st.lastDiaryDate[targetKey], day);
        saveState({ lastDiaryDate: st.lastDiaryDate });
        try { affairsService.appendReceipt({ key: targetKey, text: '日记已发：' + day + '（发送凭据核对）' }); } catch {}
        return { ok: false, reason: 'already_sent', day, lastDiaryDate: day, receiptStatus: 'sent', reconciled: true };
      }
      if (receipt.status === 'claimed' || receipt.status === 'uncertain') {
        return { ok: false, reason: 'delivery_unconfirmed', day, receiptStatus: receipt.status };
      }
      if (receipt.status !== 'absent') return { ok: false, reason: 'receipt_unavailable', day, receiptStatus: receipt.status };
    }
    if (recordedForDay && !manualId) return { ok: false, reason: 'already_sent', day, lastDiaryDate: previousDate || day };
    const archiveOnly = diaryArchiveHasDay(targetKey, day);
    if (archiveOnly && allowArchiveRetry !== true && !manualId) return { ok: false, reason: 'archive_only', day, receiptStatus: 'archive_only' };
    const availability = diaryForDay(root, targetKey, day);
    const { text: diary } = availability;
    if(!diary)return { ok: false, reason: 'missing_diary', day };
    const diaryText=diary.slice(0,Math.max(50,Math.min(2000,Number(cfg().dailyDiary?.maxChars)||500)));
    const body='【'+day+' 日日记】\n时间窗：'+diaryWindowLabel(day)+'\n'+diaryText;
    let sourceAt = availability.updatedAt;
    if (availability.source !== 'memory') { try { sourceAt = fs.statSync(diaryArchiveFile(root, day)).mtimeMs; } catch { sourceAt = Date.parse(day + 'T00:00:00'); } }
    const meta={id:receiptId,sourceAt,expiresAt:new Date(new Date(now).getFullYear(),new Date(now).getMonth(),new Date(now).getDate()+1).getTime()};
    let outcome;
    try {
      if (typeof cap.sendNotificationDetailed === 'function') outcome = await cap.sendNotificationDetailed(targetKey, body, meta);
      else if (typeof cap.sendNotification === 'function') outcome = { ok: await cap.sendNotification(targetKey, body, meta) === true };
      else outcome = { ok: typeof cap.sendSessionText === 'function' && await cap.sendSessionText(targetKey, body) === true };
    } catch { outcome = { ok: false, reason: 'send_unconfirmed' }; }
    if (outcome?.ok !== true) return { ok: false, reason: outcome?.reason || 'send_unconfirmed', day, receiptStatus: outcome?.receiptStatus || '' };
    const sent=true;
    if(sent){
      st.lastDiaryDate[targetKey]=mergeDiaryDate(st.lastDiaryDate[targetKey],day);saveState({lastDiaryDate:st.lastDiaryDate});
      try { affairsService.appendReceipt({ key: targetKey, text: '日记已发：' + day }); } catch (e) { ctx.warn('日记已发送，但收据记录写入失败（'+targetKey+' '+day+'）：'+(e?.message??e)); }
      // 归档失败绝不能影响发送：独立 try/catch，只告警。
      // 归档存完整日记（diary），不是发给 QQ 的截断版（diaryText）：历史留档要完整。
      try{writeDiaryArchive({root,key:targetKey,day,text:diary,now,maxChars:diaryArchiveMaxChars(cfg()),replaceExisting:!!manualId});}
      catch(e){ctx.warn('日记归档写入失败（'+targetKey+' '+day+'）：'+(e?.message??e));}
      try { markDiaryArchiveSent({ root, key: targetKey, day, now }); }
      catch (e) { ctx.warn('日记归档发送时间记录失败（' + targetKey + ' ' + day + '）：' + (e?.message ?? e)); }
    }
    return { ok: true, day, source: availability.source, chars: diary.length, receiptStatus: 'sent', deliveryId: receiptId };
  }
  const sendDiary = async (payload = {}) => (await sendDiaryDetailed(payload)).ok === true;
  async function catchUpDiaries({ key, now = Date.now() } = {}) {
    const targetKey = String(key || '');
    if (!/^(?:group|private):\d+$/.test(targetKey)) return { ok: false, reason: 'invalid_key', results: [] };
    const candidates = new Set();
    const today = dateKey(new Date(now));
    // 补发只处理已结束日期的归档；今天的日记由当晚自动发送或“发送今天”按钮处理。
    for (const day of allDiaryArchiveDays(root)) {
      if (day < today && diaryArchiveHasDay(targetKey, day)) candidates.add(day);
    }
    const results = [];
    for (const day of [...candidates].sort()) {
      const result = await sendDiaryDetailed({ key: targetKey, now, day, allowArchiveRetry: true });
      results.push({ day, ok: result.ok === true, reason: result.reason || '', receiptStatus: result.receiptStatus || (result.ok ? 'sent' : '') });
    }
    return { ok: results.every((item) => item.ok || item.reason === 'already_sent'), key: targetKey, results };
  }

  // 轻量回填：今天/昨天已发过日记，但归档里缺这一节时，把当前【日记】段补进去。
  // 每个会话每天最多补一次（state.diaryBackfill 记录 key+day），失败只告警、不影响调度。
  function backfillDiaryArchives({ allKeys, st, now = Date.now() }) {
    const today = dateKey(new Date(now));
    const yesterday = prevDateKey(now);
    const rec = st.diaryBackfill && typeof st.diaryBackfill === 'object' ? { ...st.diaryBackfill } : {};
    const maxChars = diaryArchiveMaxChars(cfg());
    let changed = false;
    for (const key of allKeys) {
      const day = String(st.lastDiaryDate?.[key] || '');
      if (day !== today && day !== yesterday) continue;
      const mark = key + '|' + day;
      if (rec[mark]) continue;
      let existing = '';
      try { existing = fs.readFileSync(diaryArchiveFile(root, day), 'utf8'); } catch {}
      if (hasDiaryArchiveSection(existing, key)) continue;
      const diary = extractDiary(readMemory(root, key).text);
      if (!diary) continue;
      try {
        const out = writeDiaryArchive({ root, key, day, text: diary, now, maxChars });
        if (out && out.ok) {
          rec[mark] = now;
          changed = true;
          if (!out.skipped) ctx.log('回填日记归档 ' + key + ' ' + day);
        }
      } catch (e) { ctx.warn('回填日记归档失败（' + key + ' ' + day + '）：' + (e?.message ?? e)); }
    }
    if (!changed) return;
    const keep = {};
    for (const [mark, at] of Object.entries(rec)) {
      const day = String(mark).split('|')[1] || '';
      if (day >= yesterday) keep[mark] = at;
    }
    saveState({ diaryBackfill: keep });
  }

  const archiveList = (payload = {}) => listDiaryArchives(root, payload);
  const archiveRead = (payload = {}) => readDiaryArchive(root, payload);
  const isConsoleHiddenKey = (key) => {
    try { return typeof cap.isConsoleConversationExcluded === 'function' && cap.isConsoleConversationExcluded(String(key || '')) === true; } catch { return false; }
  };
  const consoleArchiveText = (text) => {
    const kept = [];
    let include = true;
    for (const line of String(text || '').split(/\r?\n/)) {
      if (line.startsWith('## ')) {
        const marker = line.slice(3).trim();
        const sep = marker.lastIndexOf(' ·');
        const key = sep > 0 ? marker.slice(0, sep).trim() : marker;
        include = !isConsoleHiddenKey(key);
      }
      if (include) kept.push(line);
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  };
  const consoleArchiveList = async (payload = {}) => {
    const result = archiveList(payload);
    if (result.ok !== true) return result;
    const dates = [];
    for (const entry of result.dates) {
      const read = archiveRead({ date: entry.date });
      const visibleText = read.ok === true ? consoleArchiveText(read.text) : '';
      const keys = [];
      for (const line of visibleText.split(/\r?\n/)) {
        if (!line.startsWith('## ')) continue;
        const rest = line.slice(3).trim();
        const at = rest.lastIndexOf(' ·');
        keys.push(at > 0 ? rest.slice(0, at).trim() : rest);
      }
      const deliveries = [];
      for (const key of keys) {
        let receipt = null;
        if (typeof cap.deliveryStatus === 'function') {
          try { receipt = await cap.deliveryStatus('diary:' + key + ':' + entry.date); } catch { receipt = null; }
        }
        deliveries.push({ key, status: receipt?.ok === true ? receipt.status : 'unavailable',
          ...(receipt?.ok === true && receipt.status === 'sent' && Number(receipt.finishedAt) > 0 ? { sentAt: Number(receipt.finishedAt) } : {}) });
      }
      dates.push({ date: entry.date, count: keys.length, keys, chars: visibleText.length, deliveries });
    }
    return { ...result, dates };
  };
  // 供控制台 /api/plugins/call 调用的工具（插件工具返回 {} → 宿主包成 {ok,plugin,result}）。
  if (typeof ctx.registerTool === 'function') {
    ctx.registerTool('diary_history', {
      description: '列出按天归档的日记（日期倒序，含每天条数/会话/字数）。',
      schema: { type: 'object', properties: { limit: { type: 'number', description: '最多返回多少天，默认 30，上限 200' } } },
      handler: (input) => consoleArchiveList(input || {})
    });
    ctx.registerTool('diary_read', {
      description: '读取某一天归档的日记全文。',
      schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
      handler: (input) => {
        const result = archiveRead(input || {});
        return result.ok === true ? { ...result, text: consoleArchiveText(result.text) } : result;
      }
    });
  }
  return {
    services: {
      affairs: affairsService,
      memory: {
        sendDiary,
        sendDiaryDetailed,
        catchUpDiaries,
        async diaryStatus({ key, day } = {}) {
          const st = state();
          const notes = receiptNotes(key);
          const noteDate = lastDiaryDateFromNotes(notes);
          const lastDiaryDate = mergeDiaryDate(st.lastDiaryDate[key], noteDate);
          if (lastDiaryDate > String(st.lastDiaryDate[key] || '')) {
            st.lastDiaryDate[key] = lastDiaryDate;
            saveState({ lastDiaryDate: st.lastDiaryDate });
          }
          let deliveryStatus = 'absent';
          let sentForDay = false;
          let sentAt = 0;
          if (ARCHIVE_DATE_RE.test(String(day || ''))) {
            sentForDay = diaryDateRecorded({ key, day: String(day), st, notes });
            if (typeof cap.deliveryStatus === 'function') {
              let receipt;
              try { receipt = await cap.deliveryStatus('diary:' + key + ':' + day); } catch { receipt = { ok: false, status: 'unavailable' }; }
              if (receipt?.ok !== true) deliveryStatus = 'unavailable';
              else if (receipt.status === 'sent') { deliveryStatus = 'sent'; sentForDay = true; sentAt = Number(receipt.finishedAt) || 0; }
              else if (receipt.status === 'claimed' || receipt.status === 'uncertain') deliveryStatus = receipt.status;
              else deliveryStatus = sentForDay ? 'sent' : diaryArchiveHasDay(key, String(day)) ? 'archive_only' : 'absent';
            } else deliveryStatus = sentForDay ? 'sent' : diaryArchiveHasDay(key, String(day)) ? 'archive_only' : 'unavailable';
            if (deliveryStatus === 'sent' && String(st.lastDiaryDate[key] || '') < String(day)) {
              st.lastDiaryDate[key] = String(day);
              saveState({ lastDiaryDate: st.lastDiaryDate });
            }
          }
          return { ok: true, key, lastDiaryDate: mergeDiaryDate(st.lastDiaryDate[key], noteDate), noteDiaryDate: noteDate,
            ...(ARCHIVE_DATE_RE.test(String(day || '')) ? { day: String(day), sentForDay, deliveryStatus, ...(sentAt ? { sentAt } : {}) } : {}),
            retryAt: Number(st.retryAt[key]) || 0, forceWriteAt: Number(st.forceWriteAt[key]) || 0 };
        },
        diaryForDay({ key, day } = {}) {
          const result = diaryForDay(root, String(key || ''), String(day || ''));
          return { ok: true, key, day, available: !!result.text, chars: result.text.length, source: result.source };
        },
        read(payload = {}) {
          ensureAffairs(payload.key);
          const memory = readMemory(root, payload.key);
          return { ...memory, text: memory.text ? renderPersistentDocument(parseMemoryDocument(memory.text)) : '' };
        },
        write(payload = {}) {
          return writePersistent(payload.key, payload.text);
        },
        capture(payload = {}) {
          const text = String(payload.text || '');
          const m = /<MEMORY>([\s\S]*?)<\/MEMORY>/i.exec(text);
          if (!m || !m[1].trim()) return { matched: false, chars: 0 };
          const chars = writePersistent(payload.key, m[1].trim(), true);
          return { matched: true, chars };
        },
        diaryText(payload = {}) {
          return extractDiary(readMemory(root, payload.key).text);
        },
        // 日记历史（B/C 契约）：同步返回，控制台的 diary_history / diary_read 工具复用这两个函数。
        diaryArchiveList(payload = {}) {
          return archiveList(payload);
        },
        diaryArchiveRead(payload = {}) {
          return archiveRead(payload);
        }
      }
    },
    hooks: {
      onIncoming(p={}) { if(!p.key || p.isSelf)return;const st=state();st.lastIncomingAt[p.key]=Date.now();saveState({lastIncomingAt:st.lastIncomingAt}); },
      async onTick({ now = Date.now() } = {}) {
        const c = cfg();
        if (c.enabled === false) return;
        const st = state();
        const allKeys = keys();
        if (!allKeys.length) return;

        // 1) 每日日记：到点先强制刷新一次记忆（每晚一次，force 跳过「会话繁忙」），刷新完成后再发
        const dcfg = c.dailyDiary || {};
        if (dcfg.enabled !== false) {
          const rawHour = Number(dcfg.hour);
          const hour = Math.min(23, Math.max(0, Number.isFinite(rawHour) ? rawHour : 22));
          const rawMinute = Number(dcfg.minute);
          const minute = Math.min(59, Math.max(0, Number.isFinite(rawMinute) ? rawMinute : 0));
          const d = new Date(now);
          const todayAt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0).getTime();
          const today = dateKey(d);
          if (now >= todayAt) {
          const dueDay = today;
          for (const key of allKeys) {
            let notes = '';
            try { notes = receiptNotes(key); } catch {}
            if (diaryDateRecorded({ key, day: dueDay, st, notes }) || diaryArchiveHasDay(key, dueDay)) continue;
            if (typeof cap.deliveryStatus === 'function') {
              let receipt;
              try { receipt = await cap.deliveryStatus('diary:' + key + ':' + dueDay); } catch { receipt = { ok: false, status: 'unavailable' }; }
              if (receipt?.ok !== true || receipt.status === 'claimed' || receipt.status === 'uncertain') continue;
              if (receipt.status === 'sent') {
                st.lastDiaryDate[key] = mergeDiaryDate(st.lastDiaryDate[key], dueDay);
                saveState({ lastDiaryDate: st.lastDiaryDate });
                continue;
              }
            }

            const mem = readMemory(root, key);
            const diary = extractDiary(mem.text);
            const budgetStage=typeof cap.budgetRecoveryStatus==='function'?cap.budgetRecoveryStatus(key)?.stage:'normal';
            if(['weak','silent'].includes(budgetStage)){await sendDiaryDetailed({key,now,day:dueDay});continue;} // Existing dated diary only; never invoke the model to refresh it under a budget limit.


            // 每晚到点强制刷新一次记忆（每天一次）：force=true 跳过「会话繁忙」判断，唤醒会排队等空闲再写；
            // 这样即使白天 pendingMemoryWrite 卡过、或每小时调度因忙被跳过，到点也能把日记刷成最新。
            if (dueDay === today && Number(st.forceWriteAt?.[key] || 0) < todayAt) {
              st.forceWriteAt = st.forceWriteAt || {};
              if (Number(st.retryAt[key]) > now) continue;
              let fired = false;
              try { fired = typeof cap.requestMemoryWrite === 'function' ? cap.requestMemoryWrite(key, { force: true }) === true : false; } catch { fired = false; }
              if (fired) { st.forceWriteAt[key]=now;st.lastWriteAt[key]=now;saveState({forceWriteAt:st.forceWriteAt,lastWriteAt:st.lastWriteAt}); }
              else {st.retryAt[key]=now+RETRY_MS;saveState({retryAt:st.retryAt});}
              ctx.log(fired ? '每晚强制刷新记忆 ' + key : '每晚强制刷新记忆未触发（暂停/静音）' + key);
              continue; // 记忆回合是异步的，本轮先不发，等记忆写完再发，避免把刷新前的旧日记发出去。
            }

            // 强制刷新后，等记忆文件真正重写（mtime 晚于 force 时间）再发；重写完成前先跳过。
            if (dueDay === today && Number(st.forceWriteAt?.[key] || 0) > 0 && mem.updatedAt < Number(st.forceWriteAt[key])) continue;

            if (!diary) continue; // 没写日记就等下一次（记忆更新会补）

            await sendDiary({key,now,day:dueDay});
          }
          }
        }

        // 2) 轻量回填：已发过日记的会话，若归档里缺这一节就补进去（每会话每天最多一次）。
        //    用最新 state 快照（上面的发送会更新 lastDiaryDate），异常只告警，不影响后面的每小时调度。
        try { backfillDiaryArchives({ allKeys, st: state(), now }); }
        catch (e) { ctx.warn('日记归档回填异常：' + (e?.message ?? e)); }

        // 3) 每小时重写持久记忆（忙/静音时桥接能力返回 false，5 分钟后重试）
        const intervalMin = Math.max(1, Number(c.updateIntervalMin) || 60);
        for (const key of allKeys) {
          const last = Number(st.lastWriteAt[key]) || 0;
          if (last && (now - last < intervalMin * 60000 || Number(st.lastIncomingAt[key]||0) <= last)) continue;
          if (Number(st.retryAt[key]) > now) continue;
          let fired = false;
          try { fired = typeof cap.requestMemoryWrite === 'function' ? cap.requestMemoryWrite(key) === true : false; } catch { fired = false; }
          if (fired) {
            st.lastWriteAt[key] = now;
            saveState({ lastWriteAt: st.lastWriteAt });
            ctx.log('触发持久记忆更新 ' + key);
          } else {
            st.retryAt[key] = now + RETRY_MS;
            saveState({ retryAt: st.retryAt });
          }
        }
      }
    }
  };
}
