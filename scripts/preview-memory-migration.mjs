// Copies only memory inputs into a separate candidate. Never loads a plugin host or touches live records.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAffairStore } from '../plugins/qq-components/ctx-memory-store/affairs.mjs';
import { parseMemoryDocument, renderPersistentDocument } from '../plugins/qq-components/ctx-memory-store/sections.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const destination = path.join(root, 'state', 'audits', 'memory-responsibilities-20261029', 'migration-preview-' + Date.now());
const source = path.join(root, 'state', 'memory'), copied = path.join(destination, 'state', 'memory');
fs.mkdirSync(copied, { recursive: true });
const hashes = [], keys = new Set();
for (const name of fs.readdirSync(source)) {
  const match = /^(?:tasks-)?(private|group)_(\d+)\.md$/.exec(name); if (!match) continue;
  const body = fs.readFileSync(path.join(source, name)); fs.writeFileSync(path.join(copied, name), body);
  hashes.push({ name, sha256: createHash('sha256').update(body).digest('hex') }); keys.add(match[1] + ':' + match[2]);
}
const store = createAffairStore(destination), counts = [];
for (const key of keys) {
  const file = path.join(copied, key.replace(':', '_') + '.md');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const result = store.migrate({ key, persistentText: text });
  if (text) fs.writeFileSync(file, renderPersistentDocument(parseMemoryDocument(text)), 'utf8');
  counts.push({ key, imported: result.imported, receipts: store.receipts({ key }).split('\n').filter(Boolean).length });
}
const report = { candidateOnly: true, createdAt: new Date().toISOString(), inputHashes: hashes, conversations: counts, imported: counts.reduce((n, x) => n + x.imported, 0) };
fs.writeFileSync(path.join(destination, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ candidateOnly: true, conversations: counts.length, imported: report.imported, report: path.join(destination, 'report.json') }));
