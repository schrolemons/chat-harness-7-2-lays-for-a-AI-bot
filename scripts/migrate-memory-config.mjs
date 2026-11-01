// Explicit one-time config rename. Run --apply only as part of the authorized activation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const file = path.join(root, 'state', 'plugins', 'config', 'ctx-memory-context.json');
if (!fs.existsSync(file)) { console.log('No memory config override to migrate.'); process.exit(0); }
const source = fs.readFileSync(file, 'utf8'), config = JSON.parse(source);
if (!Object.hasOwn(config, 'midTermSlice')) { console.log('Memory config already uses current keys.'); process.exit(0); }
if (!Object.hasOwn(config, 'affairsMaxChars')) config.affairsMaxChars = Math.max(200, Number(config.midTermSlice) || 1500);
delete config.midTermSlice;
if (!process.argv.includes('--apply')) { console.log('Pending one-time rename: midTermSlice -> affairsMaxChars; saved value preserved. No files changed.'); process.exit(0); }
const backup = path.join(root, 'state', 'memory', 'migration-originals', 'memory-config-' + Date.now() + '.json');
fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, source, { flag: 'wx' });
if (fs.readFileSync(file, 'utf8') !== source) throw new Error('Config changed during migration; no override written.');
fs.writeFileSync(file + '.memory-migration.tmp', JSON.stringify(config, null, 2)); fs.renameSync(file + '.memory-migration.tmp', file);
console.log('Memory config renamed with original backup.');
