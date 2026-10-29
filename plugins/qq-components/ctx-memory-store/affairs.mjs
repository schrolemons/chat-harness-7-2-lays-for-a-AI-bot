import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const sectionsUrl = new URL('./sections.mjs', import.meta.url);
sectionsUrl.search = new URL(import.meta.url).search;
const { parseMemoryDocument } = await import(sectionsUrl.href);

export const AFFAIR_STATUSES = ['needs_review', 'pending', 'doing', 'waiting', 'done', 'cancelled', 'superseded'];
const ACTIVE = new Set(AFFAIR_STATUSES.slice(0, 4));
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 24);
const receiptText = text => /^(?:通知已发：|日记已发：)/.test(String(text).trim());
function keyName(key) {
  if (!/^(?:private|group):\d{1,20}$/.test(String(key))) throw new Error('会话 key 格式无效');
  return key.replace(':', '_');
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8'); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function createAffairStore(root) {
  const base = path.join(root, 'state', 'memory');
  const fileFor = key => path.join(base, 'affairs', keyName(key) + '.json');
  const receiptFor = key => path.join(base, 'receipts', keyName(key) + '.jsonl');
  function read(key) {
    try {
      const doc = JSON.parse(fs.readFileSync(fileFor(key), 'utf8'));
      if (doc.version !== 1 || doc.key !== key || !Array.isArray(doc.items)) throw new Error('事务文件结构无效，未覆盖原文件');
      return doc;
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, key, items: [], migrations: {} }; throw error; }
  }
  function list({ key, status = 'active', offset = 0, limit = 50 } = {}) {
    if (status !== 'active' && status !== 'all' && !AFFAIR_STATUSES.includes(status)) throw new Error('事务状态无效');
    const doc = read(key), all = doc.items.filter(item => status === 'all' || (status === 'active' ? ACTIVE.has(item.status) : item.status === status))
      .sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const start = Math.max(0, Math.floor(Number(offset) || 0)), size = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
    return { ok: true, key, total: all.length, offset: start, limit: size, items: all.slice(start, start + size) };
  }
  function upsert(payload = {}) {
    const { key, id, expectedRevision } = payload, doc = read(key);
    const index = id ? doc.items.findIndex(item => item.id === id) : -1;
    if (id && index < 0) throw new Error('该会话中不存在此事务');
    const old = index >= 0 ? doc.items[index] : null;
    if (old && expectedRevision !== old.revision) return { ok: false, conflict: true, error: '事务已更新，请重新加载后编辑', item: old };
    const now = Date.now(), item = { id: old?.id || 'a-' + randomUUID(), title: '', detail: '', nextAction: '', source: '', status: 'pending', priority: 1,
      createdAt: now, ...old, updatedAt: now, revision: (old?.revision || 0) + 1 };
    for (const [name, max] of [['title', 240], ['detail', 20000], ['nextAction', 2000], ['source', 2000]]) {
      if (payload[name] === undefined) continue;
      if (typeof payload[name] !== 'string' || payload[name].length > max) throw new Error(`${name} 超过单项输入上限 ${max} 字符或类型无效；未截断、未写入`);
      item[name] = payload[name].trim();
    }
    if (!item.title) throw new Error('事务标题不能为空');
    if (payload.status !== undefined) item.status = payload.status;
    if (!AFFAIR_STATUSES.includes(item.status)) throw new Error('事务状态无效');
    if (payload.priority !== undefined) item.priority = Number(payload.priority);
    if (![0, 1, 2].includes(item.priority)) throw new Error('优先级应为 0、1 或 2');
    item.history = [...(old?.history || []), ...(old ? [{ at: old.updatedAt, revision: old.revision, title: old.title, detail: old.detail, status: old.status, nextAction: old.nextAction, source: old.source }] : [])];
    if (old) doc.items[index] = item; else doc.items.push(item);
    atomicWrite(fileFor(key), doc);
    return { ok: true, key, item };
  }
  function find({ key, detail }) { return read(key).items.find(item => item.detail === detail) || null; }
  function context({ key, maxChars = 1500 } = {}) {
    const budget = Math.max(0, Number(maxChars) || 0), doc = read(key);
    const items = doc.items.filter(x => ACTIVE.has(x.status)).sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt);
    const selectedIds = [], omittedIds = []; let text = '';
    for (const item of items) {
      const block = `[${item.id}｜${item.status}｜版本${item.revision}] ${item.title}\n${item.detail}${item.nextAction ? '\n下一步：' + item.nextAction : ''}${item.source ? '\n来源：' + item.source : ''}`;
      if (text.length + block.length + (text ? 2 : 0) <= budget) { text += (text ? '\n\n' : '') + block; selectedIds.push(item.id); }
      else omittedIds.push(item.id);
    }
    return { text, selectedIds, omittedIds, total: items.length, maxChars: budget };
  }
  function appendReceipt({ key, text }) {
    const body = String(text || '').trim(); if (!body) return 0;
    const file = receiptFor(key); fs.mkdirSync(path.dirname(file), { recursive: true });
    const id = digest(body);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).some(line => { const row = JSON.parse(line); return (row.id || digest(row.text)) === id; })) return 0;
    fs.appendFileSync(file, JSON.stringify({ id, at: Date.now(), text: body }) + '\n', 'utf8'); return body.length;
  }
  function receipts({ key }) {
    try { return fs.readFileSync(receiptFor(key), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).text).join('\n'); }
    catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  }
  function migrate({ key, persistentText = '' }) {
    const doc = read(key); if (doc.migrations.initial) return { imported: 0 };
    const legacyFile = path.join(base, 'tasks-' + keyName(key) + '.md');
    let legacy = ''; try { legacy = fs.readFileSync(legacyFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const entries = legacy.split(/^## \[([^\]]+)\]\s*$/m), records = [];
    if (entries[0].trim()) records.push({ text: entries[0].trim(), source: '旧任务笔记（开头可能已截断）' });
    for (let i = 1; i < entries.length; i += 2) records.push({ text: (entries[i + 1] || '').trim(), source: '旧任务笔记 ' + entries[i] });
    for (const line of parseMemoryDocument(persistentText).unfinished) if (!/^[-*]?\s*(?:无|暂无|（无）)\s*$/.test(line.trim())) records.push({ text: line.trim(), source: '持久化记忆旧未完成事项' });
    const backup = path.join(base, 'migration-originals', keyName(key));
    fs.mkdirSync(backup, { recursive: true });
    for (const [name, content] of [['tasks.md', legacy], ['persistent.md', persistentText]]) {
      if (!content) continue;
      let file = path.join(backup, name);
      if (fs.existsSync(file)) {
        if (fs.readFileSync(file, 'utf8') === content) continue;
        file = path.join(backup, digest(content) + '-' + name);
      }
      if (!fs.existsSync(file)) fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
    }
    let imported = 0;
    for (const record of records) {
      if (!record.text) continue;
      if (receiptText(record.text)) { appendReceipt({ key, text: record.text }); continue; }
      const id = 'import-' + digest(record.source + '\n' + record.text);
      if (doc.items.some(item => item.id === id)) continue;
      const now = Date.now();
      doc.items.push({ id, title: record.text.split('\n')[0].replace(/^[-*]\s*/, '').slice(0, 120), detail: record.text, nextAction: '核对是否仍需处理；历史文字不构成当前授权', source: record.source,
        status: 'needs_review', priority: 0, createdAt: now, updatedAt: now, revision: 1, history: [] }); imported++;
    }
    doc.migrations.initial = { at: Date.now(), legacyDigest: digest(legacy), persistentDigest: digest(persistentText) };
    atomicWrite(fileFor(key), doc); return { imported };
  }
  return { list, upsert, find, context, appendReceipt, receipts, migrate };
}
