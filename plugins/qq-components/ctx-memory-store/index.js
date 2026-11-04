// ctx-memory-store（C 层｜记忆存储与调度）
//
// 从 bridge.js 搬走「记忆的存储/调度侧」：
//   · 持久记忆文件读写（state/memory/<会话>.md）
//   · <MEMORY> 捕获写盘
//   · 每小时重写调度（到点让桥接发 memoryWrite 唤醒）
//   · 每日日记：按配置时刻刷新后投递；手动发送不消耗定时机会，确认凭据跨重启防重。
//
// 桥接仍负责：DSH 回合/唤醒（requestMemoryWrite 能力）、QQ 发送（sendSessionText 能力）、
// 会话白名单与忙碌/静音判断。插件通过 ctx.root 直接读写 state/memory（与桥接同进程、同一用户）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const memoryModule = relative => { const url = new URL(relative, import.meta.url); url.search = new URL(import.meta.url).search; return import(url.href); };
const { createAffairStore } = await memoryModule('./affairs.mjs');
const {diaryTargetDay,diaryWindow,diaryPreviousDay,diaryHeading,diaryPartLimit,diaryDraftLimit,resolveDiaryDelivery}=await memoryModule('./diary-delivery.mjs');
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
  return lines.slice(start + 1, end).filter(line=>!line.startsWith('> 已发送：')).join('\n').replace(/\n*…（已截断）\s*$/, '').trim();
}
function diaryForDay(root, key, day, contentDay) {
  if (!ARCHIVE_DATE_RE.test(String(day || ''))) return { text: '', source: '', updatedAt: 0 };
  const mem = readMemory(root, key);
  const currentDiary = (contentDay || dateKey(new Date(mem.updatedAt))) === day ? extractDiary(mem.text) : '';
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
function diaryLengthError(text,maxChars){
  if(text.length<=maxChars)return null;
  return {ok:false,reason:'diary_too_long',chars:text.length,maxChars,error:'日记超过 '+maxChars+' 字，请重新取舍，只保留最值得写的片段和感受，提交完整短稿。'};
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
      diaryReceiptIds: s.diaryReceiptIds || {},
      diaryAttempts: s.diaryAttempts || {},
      lastDiaryDelivery: s.lastDiaryDelivery || {},
      diaryContentDates: s.diaryContentDates || {},
      scheduledDiaryRefresh: s.scheduledDiaryRefresh || {},
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
  const diaryDigest=text=>crypto.createHash('sha256').update(text).digest('hex');
  function saveDiaryDraft(key,day,text,now){
    if(!text)return {ok:true,empty:true};
    try{return writeDiaryArchive({root,key,day,text,now,maxChars:diaryArchiveMaxChars(cfg()),replaceExisting:true});}
    catch(error){ctx.warn('日记草稿归档失败 '+key+' '+day+': '+error.message);return {ok:false,error:error.message};}
  }
  function contentForDay(key,day){
    const text=extractDiary(readMemory(root,key).text),stamp=state().diaryContentDates[key];
    return diaryForDay(root,key,day,stamp?.hash===diaryDigest(text)?stamp.day:undefined);
  }
  function rollDiaryWindow(key,now){
    const currentDay=diaryTargetDay(now,cfg().dailyDiary),mem=readMemory(root,key),text=extractDiary(mem.text),st=state(),stamp=st.diaryContentDates[key];
    const contentDay=stamp?.hash===diaryDigest(text)?stamp.day:dateKey(new Date(mem.updatedAt));
    if(!text||!ARCHIVE_DATE_RE.test(contentDay)||contentDay>=currentDay)return;
    // Stage the ended diary without clearing it. Actual retirement follows the confirmed QQ receipt.
    if(diaryFromArchive(root,contentDay,key)!==text)writeDiaryArchive({root,key,day:contentDay,text,now,maxChars:diaryArchiveMaxChars(cfg()),replaceExisting:true});
  }
  function retireConfirmedDiary(key,day,now){
    const mem=readMemory(root,key),text=extractDiary(mem.text),st=state(),stamp=st.diaryContentDates[key];
    const contentDay=stamp?.hash===diaryDigest(text)?stamp.day:dateKey(new Date(mem.updatedAt));
    if(!text||contentDay!==day||day>=diaryTargetDay(now,cfg().dailyDiary))return;
    writeMemory(root,key,renderPersistentDocument({...parseMemoryDocument(mem.text),diary:[]}));
    if(mem.updatedAt>0)fs.utimesSync(memoryFile(root,key),new Date(mem.updatedAt),new Date(mem.updatedAt));
    saveState({diaryContentDates:{...st.diaryContentDates,[key]:{day:diaryTargetDay(now,cfg().dailyDiary),hash:diaryDigest('')}}});
  }
  function rememberDiaryAttempt({key,day,id,kind,stage,now=Date.now(),outcome={}}) {
    const st = state();
    const previous = (st.diaryAttempts[key] || []).find(item => item.id === id);
    const attempt = {
      id, day, kind, stage, startedAt: previous?.startedAt || now, updatedAt: now,
      reason: String(outcome.reason || ''), receiptStatus: String(outcome.receiptStatus || ''),
      partsSent: Number(outcome.partsSent) || 0, partsTotal: Number(outcome.partsTotal) || 0
    };
    const recent = (st.diaryAttempts[key] || []).filter(item => item.id !== id);
    saveState({diaryAttempts:{...st.diaryAttempts,[key]:[attempt,...recent].slice(0,40)}});
  }
  function diaryAttempts(key, day, now) {
    return (state().diaryAttempts[key] || []).filter(item => item.day === day).map(item => (
      item.stage === 'refreshing' && now - item.startedAt > 30 * 60000
        ? {...item, stage:'finished', reason:'refresh_expired'} : item
    ));
  }
  async function diaryAttemptAudit(key, day, now) {
    return Promise.all(diaryAttempts(key,day,now).map(async attempt => {
      if (attempt.stage !== 'sending' && attempt.receiptStatus !== 'claimed') return attempt;
      let receipt;
      try { receipt = await cap.deliveryStatus?.(attempt.id); } catch {}
      if (receipt?.ok === true && receipt.status === 'sent') return {...attempt, stage:'finished', reason:'', receiptStatus:'sent', updatedAt:receipt.finishedAt || attempt.updatedAt};
      if (receipt?.ok === true && receipt.status === 'uncertain') return {...attempt, stage:'finished', reason:'delivery_unconfirmed', receiptStatus:'uncertain'};
      if (now - attempt.updatedAt <= 30 * 60000) return attempt;
      if (receipt?.ok === true && receipt.status === 'absent') return {...attempt, stage:'finished', reason:'delivery_not_started'};
      return {...attempt, stage:'finished', reason:'delivery_unconfirmed', receiptStatus:receipt?.status || 'unavailable'};
    }));
  }
  async function finalDeliveryForDay(key,day){
    if(typeof cap.deliveryStatus!=='function')return {sentForDay:false,deliveryStatus:'unavailable',sentAt:0};
    const prefix='diary:'+key+':'+day,endAt=Date.parse(diaryWindow(day,cfg().dailyDiary).end.replace(' ','T')+':00+08:00');
    const records=await Promise.all([prefix+':scheduled',prefix+':catchup',prefix].map(async id=>{try{return {id,...await cap.deliveryStatus(id)};}catch{return {id,ok:false};}}));
    const sent=records.filter(r=>r.ok===true&&r.status==='sent'&&(r.id!==prefix||Number(r.finishedAt)>=endAt)).sort((a,b)=>Number(b.finishedAt)-Number(a.finishedAt))[0];
    if(sent)return {sentForDay:true,deliveryStatus:'sent',sentAt:Number(sent.finishedAt)||0,deliveryId:sent.id};
    const pending=records.find(r=>r.status==='claimed')||records.find(r=>r.status==='uncertain');
    return {sentForDay:false,deliveryStatus:pending?.status||(records.some(r=>r.ok!==true)?'unavailable':diaryDateRecorded({key,day,st:state(),notes:receiptNotes(key)})?'legacy_unconfirmed':'absent'),sentAt:0};
  }
  async function deliveryForDay(key,day){
    const st=state(),notes=receiptNotes(key);
    return resolveDiaryDelivery({key,day,notes,indexed:[st.diaryReceiptIds[key]?.[day],...diaryAttempts(key,day,Date.now()).map(attempt=>attempt.id)].filter(Boolean),recorded:diaryDateRecorded({key,day,st,notes}),archiveOnly:diaryArchiveHasDay(key,day),lookup:typeof cap.deliveryStatus==='function'?id=>cap.deliveryStatus(id):undefined});
  }
  function rememberDelivery(key,day,id,sentAt){
    const st=state(),days={...(st.diaryReceiptIds[key]||{}),[day]:id};
    const kept=Object.fromEntries(Object.entries(days).sort(([a],[b])=>b.localeCompare(a)).slice(0,200));
    saveState({lastDiaryDate:{...st.lastDiaryDate,[key]:mergeDiaryDate(st.lastDiaryDate[key],day)},diaryReceiptIds:{...st.diaryReceiptIds,[key]:kept},lastDiaryDelivery:{...st.lastDiaryDelivery,[key]:Number(st.lastDiaryDelivery[key]?.sentAt)>sentAt?st.lastDiaryDelivery[key]:{day,id,sentAt}}});
  }
  async function sendDiaryDetailed({key,now=Date.now(),day=dateKey(new Date(now)),allowArchiveRetry=false,manualRequestId='',confirmLegacyUnsent=false,purpose=''}={}) {
    const targetKey = String(key || '');
    if (!/^(?:group|private):\d+$/.test(targetKey)) return { ok: false, reason: 'invalid_key' };
    if (!ARCHIVE_DATE_RE.test(String(day))) return { ok: false, reason: 'invalid_day', day: String(day || '') };
    const manualId = /^[a-zA-Z0-9-]{8,80}$/.test(String(manualRequestId || '')) ? String(manualRequestId) : '';
    const scheduled=purpose==='scheduled'&&!manualId;
    const catchup=purpose==='catchup'&&!manualId;
    const receiptId='diary:'+targetKey+':'+day+(manualId?':manual:'+manualId:scheduled?':scheduled':catchup?':catchup':'');
    const attempt = {key:targetKey, day, id:receiptId, kind:manualId?'manual':scheduled?'scheduled':catchup?'catchup':'on_demand', now};
    const finish = outcome => {
      rememberDiaryAttempt({...attempt, stage:'finished', now:Math.max(now, Date.now()), outcome});
      return {day, ...outcome};
    };
    if(typeof cap.deliveryStatus!=='function'||typeof cap.sendDiaryDelivery!=='function')return finish({ok:false,reason:'receipt_unavailable'});
    let receipt;try{receipt=await cap.deliveryStatus(receiptId);}catch{}
    if(receipt?.ok!==true)return finish({ok:false,reason:receipt?.reason?'receipt_'+receipt.reason:'receipt_unavailable'});
    const existing=manualId||scheduled?{deliveryStatus:receipt.status,sentForDay:receipt.status==='sent',sentAt:Number(receipt.finishedAt)||0,deliveryId:receiptId}:catchup?await finalDeliveryForDay(targetKey,day):await deliveryForDay(targetKey,day);
    if(existing.sentForDay){rememberDelivery(targetKey,day,existing.deliveryId,existing.sentAt);return {ok:false,reason:'already_sent',day,lastDiaryDate:day,receiptStatus:'sent',reconciled:true};}
    if(['claimed','uncertain'].includes(existing.deliveryStatus)||(existing.deliveryStatus==='legacy_unconfirmed'&&confirmLegacyUnsent!==true))return {ok:false,reason:'delivery_unconfirmed',day,receiptStatus:existing.deliveryStatus};
    if(existing.deliveryStatus==='unavailable'||receipt.status!=='absent')return {ok:false,reason:'receipt_unavailable',day};
    if(manualId){
      const text=extractDiary(readMemory(root,targetKey).text),st=state();
      if(text)saveState({diaryContentDates:{...st.diaryContentDates,[targetKey]:{day,hash:diaryDigest(text)}}});
    }
    const archiveOnly = diaryArchiveHasDay(targetKey, day);
    if (archiveOnly && allowArchiveRetry !== true && !manualId && !scheduled) return { ok: false, reason: 'archive_only', day, receiptStatus: 'archive_only' };
    const refreshed=state().scheduledDiaryRefresh[targetKey];
    const availability = scheduled&&refreshed?.day===day&&refreshed.completedAt
      ? {text:refreshed.diary||'',source:'scheduled_refresh',updatedAt:refreshed.completedAt}
      : contentForDay(targetKey, day);
    const { text: diary } = availability;
    if(!diary)return finish({ok:false,reason:'missing_diary'});
    const config=cfg().dailyDiary;
    const body=diaryHeading(day,config)+diary;
    let sourceAt = availability.updatedAt;
    if (availability.source === 'archive') { try { sourceAt = fs.statSync(diaryArchiveFile(root, day)).mtimeMs; } catch { sourceAt = Date.parse(day + 'T00:00:00'); } }
    const meta={id:receiptId,sourceAt,partMaxChars:diaryPartLimit(config),expiresAt:new Date(new Date(now).getFullYear(),new Date(now).getMonth(),new Date(now).getDate()+1).getTime()};
    rememberDiaryAttempt({...attempt, stage:'sending'});
    let outcome;try{outcome=await cap.sendDiaryDelivery(targetKey,body,meta);}catch{outcome={ok:false,reason:'send_unconfirmed'};}
    if(outcome?.ok!==true)return finish({ok:false,reason:outcome?.reason||'send_unconfirmed',receiptStatus:outcome?.receiptStatus||'',partsSent:outcome?.partsSent,partsTotal:outcome?.partsTotal});
    // The transport only returns sent after committing the central receipt.
    if(outcome.receiptStatus!=='sent')return finish({...outcome,ok:false,reason:'delivery_unconfirmed',receiptStatus:'unavailable'});
    const confirmedAt=Date.now();
    {
      rememberDelivery(targetKey,day,receiptId,confirmedAt);
      try{affairsService.appendReceipt({key:targetKey,text:'日记已发：'+day+'｜凭据：'+receiptId});}catch(e){ctx.warn('日记收据索引写入失败：'+e.message);}
      // 归档失败绝不能影响发送：独立 try/catch，只告警。
      // 归档保存完整正文。
      let archived=false;
      try{archived=writeDiaryArchive({root,key:targetKey,day,text:diary,now,maxChars:diaryArchiveMaxChars(cfg()),replaceExisting:!!manualId||scheduled||catchup}).ok===true;}
      catch(e){ctx.warn('日记归档写入失败（'+targetKey+' '+day+'）：'+(e?.message??e));}
      try { markDiaryArchiveSent({ root, key: targetKey, day, now:confirmedAt }); }
      catch (e) { ctx.warn('日记归档发送时间记录失败（' + targetKey + ' ' + day + '）：' + (e?.message ?? e)); }
      if(archived)retireConfirmedDiary(targetKey,day,now);
    }
    return finish({...outcome,ok:true,source:availability.source,chars:diary.length,receiptStatus:'sent',deliveryId:receiptId});
  }
  const sendDiary = async (payload = {}) => (await sendDiaryDetailed(payload)).ok === true;
  async function catchUpDiaries({ key, now = Date.now(), confirmLegacyUnsent=false } = {}) {
    const targetKey = String(key || '');
    if (!/^(?:group|private):\d+$/.test(targetKey)) return { ok: false, reason: 'invalid_key', results: [] };
    const candidates = new Set();
    const today = diaryTargetDay(now,cfg().dailyDiary);
    // 补发只处理已结束日期的归档；今天的日记由当晚自动发送或“发送今天”按钮处理。
    for (const day of allDiaryArchiveDays(root)) {
      if (day < today && diaryArchiveHasDay(targetKey, day)) candidates.add(day);
    }
    const previousDay=diaryPreviousDay(now,cfg().dailyDiary);
    if(contentForDay(targetKey,previousDay).text)candidates.add(previousDay);
    const results = [];
    for (const day of [...candidates].sort()) {
      const result = await sendDiaryDetailed({ key: targetKey, now, day, allowArchiveRetry: true, confirmLegacyUnsent,purpose:'catchup' });
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
      const candidate=contentForDay(key,day);
      const diary = candidate.source==='memory'?candidate.text:'';
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
        const delivery=entry.date<diaryTargetDay(Date.now(),cfg().dailyDiary)?await finalDeliveryForDay(key,entry.date):await deliveryForDay(key,entry.date);
        deliveries.push({key,status:delivery.deliveryStatus,attempts:await diaryAttemptAudit(key,entry.date,Date.now()),...(delivery.sentAt?{sentAt:delivery.sentAt}:{})});
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
        noteManualDiaryRefresh({key,day,requestId,reason='',now=Date.now()}={}) {
          if (!/^(?:group|private):\d+$/.test(key) || !ARCHIVE_DATE_RE.test(day) || !/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) return;
          rememberDiaryAttempt({key,day,id:'diary:'+key+':'+day+':manual:'+requestId,kind:'manual',stage:reason?'finished':'refreshing',now,outcome:{reason}});
        },
        catchUpDiaries,
        diaryTargetDay({now=Date.now()}={}){const day=diaryTargetDay(now,cfg().dailyDiary);return {ok:true,...diaryWindow(day,cfg().dailyDiary)};},
        diaryDraftContext({key,now=Date.now()}={}){
          const refresh=state().scheduledDiaryRefresh[key];
          const day=refresh&&!refresh.completedAt?refresh.day:diaryTargetDay(now,cfg().dailyDiary);
          const config=cfg().dailyDiary;
          return {ok:true,...diaryWindow(day,config),maxDiaryChars:diaryDraftLimit(day,config),sameWindowDiary:contentForDay(key,day).text};
        },
        diaryCurrent({key,now=Date.now()}={}){
          const config=cfg().dailyDiary,day=diaryTargetDay(now,config);
          return {ok:true,...diaryWindow(day,config),maxDiaryChars:diaryDraftLimit(day,config),text:contentForDay(key,day).text};
        },
        updateDiary({key,day,text,now=Date.now()}={}){
          if(!/^(?:private|group):\d+$/.test(String(key)))return {ok:false,error:'会话格式不正确'};
          const currentDay=diaryTargetDay(now,cfg().dailyDiary);
          if(day!==currentDay)return {ok:false,error:'日记已换窗，请重新读取当前日记后再更新',day:currentDay};
          if(typeof text!=='string'||!text.trim())return {ok:false,error:'请提交日记正文'};
          const lengthError=diaryLengthError(text.trim(),diaryDraftLimit(day,cfg().dailyDiary));
          if(lengthError)return lengthError;
          const submitted=parseMemoryDocument('【日记】\n'+text);
          if(submitted.facts.length||submitted.portrait.length||submitted.unfinished.length)return {ok:false,error:'只提交日记正文，不能夹带其他记忆栏目'};
          rollDiaryWindow(key,now);
          const parts=parseMemoryDocument(readMemory(root,key).text);
          const body=text.trim();writeMemory(root,key,renderPersistentDocument({...parts,diary:body.split(/\r?\n/)}));
          const st=state();saveState({diaryContentDates:{...st.diaryContentDates,[key]:{day,hash:diaryDigest(body)}}});
          const archive=saveDiaryDraft(key,day,body,now);
          return {ok:archive.ok===true,saved:true,archiveSaved:archive.ok===true,...(archive.error?{error:archive.error}:{}),day,chars:body.length,sent:false};
        },
        async diaryStatus({key,day,now=Date.now()}={}){
          day=day||diaryTargetDay(now,cfg().dailyDiary);
          const st=state(),notes=receiptNotes(key),noteDate=lastDiaryDateFromNotes(notes),lastDiaryDate=mergeDiaryDate(st.lastDiaryDate[key],noteDate);
          const delivery=await deliveryForDay(key,day);
          const last=st.lastDiaryDelivery[key];
          const latest=await resolveDiaryDelivery({key,notes,indexed:[last?.id,lastDiaryDate?'diary:'+key+':'+lastDiaryDate:null,delivery.deliveryId].filter(Boolean),lookup:typeof cap.deliveryStatus==='function'?id=>cap.deliveryStatus(id):undefined});
          const lastConfirmedDiaryDate=latest.deliveryId?.slice(('diary:'+key+':').length,('diary:'+key+':').length+10)||'';
          let scheduledReceipt;try{scheduledReceipt=await cap.deliveryStatus?.('diary:'+key+':'+day+':scheduled');}catch{}
          const scheduledDeliveryStatus=scheduledReceipt?.ok===true?scheduledReceipt.status:'unavailable';
          const previousDay=diaryPreviousDay(now,cfg().dailyDiary),previous=await finalDeliveryForDay(key,previousDay);
          return {ok:true,key,day,...diaryWindow(day,cfg().dailyDiary),lastDiaryDate,noteDiaryDate:noteDate,...delivery,
            attempts:await diaryAttemptAudit(key,day,now),previousAttempts:await diaryAttemptAudit(key,previousDay,now),
            previousDay,previousDiaryMissing:!previous.sentForDay,previousDiaryStatus:previous.deliveryStatus,previousDiaryAvailable:!!contentForDay(key,previousDay).text,previousSentAt:previous.sentAt,
            scheduledDeliveryStatus,scheduledSentAt:scheduledDeliveryStatus==='sent'?Number(scheduledReceipt.finishedAt)||0:0,
            scheduledRefreshing:st.scheduledDiaryRefresh[key]?.day===day&&!st.scheduledDiaryRefresh[key]?.completedAt,
            lastConfirmedDiaryDate,lastConfirmedSentAt:latest.sentAt||0,retryAt:Number(st.retryAt[key])||0,forceWriteAt:Number(st.forceWriteAt[key])||0};
        },
        diaryForDay({key,day}={}){
          const result=contentForDay(String(key||''),String(day||''));
          return {ok:true,key,day,available:!!result.text,chars:result.text.length,source:result.source};
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
          const target=this.diaryDraftContext({key:payload.key,now:payload.now||Date.now()});
          const lengthError=diaryLengthError(extractDiary(m[1].trim()),target.maxDiaryChars);
          if(lengthError){
            ctx.warn?.('日记成稿超过写作上限 '+lengthError.chars+'/'+lengthError.maxChars);
            return {matched:false,...lengthError};
          }
          rollDiaryWindow(payload.key,payload.now||Date.now());
          const chars = writePersistent(payload.key, m[1].trim(), true);
          const st=state(),refresh=st.scheduledDiaryRefresh[payload.key];
          const diary=extractDiary(readMemory(root,payload.key).text);
          saveState({diaryContentDates:{...st.diaryContentDates,[payload.key]:{day:target.day,hash:diaryDigest(diary)}}});
          if(refresh&&!refresh.completedAt){
            saveState({scheduledDiaryRefresh:{...st.scheduledDiaryRefresh,[payload.key]:{...refresh,completedAt:Date.now(),diary}}});
          }
          const archive=saveDiaryDraft(payload.key,target.day,diary,payload.now||Date.now());
          return { matched: true, chars,archiveSaved:archive.ok===true };
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
        for(const key of allKeys){try{rollDiaryWindow(key,now);}catch(e){ctx.warn('日记换窗归档失败 '+key+': '+e.message);}}

        // 1) 每日日记：到点先强制刷新一次记忆（每晚一次，force 跳过「会话繁忙」），刷新完成后再发
        const dcfg = c.dailyDiary || {};
        if (dcfg.enabled !== false) {
          const rawHour = Number(dcfg.hour);
          const hour = Math.min(23, Math.max(0, Number.isFinite(rawHour) ? rawHour : 22));
          const rawMinute = Number(dcfg.minute);
          const minute = Math.min(59, Math.max(0, Number.isFinite(rawMinute) ? rawMinute : 0));
          const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
          const todayAt = Date.parse(today+'T'+pad2(hour)+':'+pad2(minute)+':00+08:00');
          const runtimeStartedAt=Number.isFinite(Number(cap.runtimeStartedAt))?Number(cap.runtimeStartedAt):Date.now();
          if (runtimeStartedAt<=todayAt&&(now >= todayAt || Object.values(st.scheduledDiaryRefresh).some(r=>r?.day<today))) {
          for (const key of allKeys) {
            const dueDay=now>=todayAt?today:st.scheduledDiaryRefresh[key]?.day;
            if(!ARCHIVE_DATE_RE.test(String(dueDay||'')))continue;
            if (typeof cap.deliveryStatus === 'function') {
              let receipt;
              try { receipt = await cap.deliveryStatus('diary:' + key + ':' + dueDay+':scheduled'); } catch { receipt = { ok: false, status: 'unavailable' }; }
              if (receipt?.ok !== true || receipt.status === 'claimed' || receipt.status === 'uncertain') continue;
              if (receipt.status === 'sent') {
                st.lastDiaryDate[key] = mergeDiaryDate(st.lastDiaryDate[key], dueDay);
                saveState({ lastDiaryDate: st.lastDiaryDate });
                continue;
              }
            }

            const budgetStage=typeof cap.budgetRecoveryStatus==='function'?cap.budgetRecoveryStatus(key)?.stage:'normal';
            if(['weak','silent'].includes(budgetStage)){await sendDiaryDetailed({key,now,day:dueDay,purpose:'scheduled'});continue;} // Existing dated diary only; never invoke the model to refresh it under a budget limit.


            // 每晚到点强制刷新一次记忆（每天一次）：force=true 跳过「会话繁忙」判断，唤醒会排队等空闲再写；
            // 这样即使白天 pendingMemoryWrite 卡过、或每小时调度因忙被跳过，到点也能把日记刷成最新。
            const refresh=st.scheduledDiaryRefresh[key];
            if (refresh?.day!==dueDay || (!refresh.completedAt&&now-Number(refresh.requestedAt)>30*60000)) {
              st.forceWriteAt = st.forceWriteAt || {};
              if (Number(st.retryAt[key]) > now) continue;
              let fired = false;
              try { fired = typeof cap.requestMemoryWrite === 'function' ? cap.requestMemoryWrite(key, { force: true }) === true : false; } catch { fired = false; }
              if (fired) { st.forceWriteAt[key]=now;st.lastWriteAt[key]=now;st.scheduledDiaryRefresh[key]={day:dueDay,requestedAt:now};saveState({forceWriteAt:st.forceWriteAt,lastWriteAt:st.lastWriteAt,scheduledDiaryRefresh:st.scheduledDiaryRefresh}); }
              else {st.retryAt[key]=now+RETRY_MS;saveState({retryAt:st.retryAt});}
              ctx.log(fired ? '每晚强制刷新记忆 ' + key : '每晚强制刷新记忆未触发（暂停/静音）' + key);
              continue; // 记忆回合是异步的，本轮先不发，等记忆写完再发，避免把刷新前的旧日记发出去。
            }

            // 只发送本次强制刷新捕获的快照；后续手动或小时刷新不能替换此份待发送内容。
            if(!refresh?.completedAt)continue;

            await sendDiary({key,now,day:dueDay,purpose:'scheduled'});
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
