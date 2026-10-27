import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function reportScriptHeartbeat(root, scriptPath, ok = true, hint = '') {
  const file = path.join(root, 'state', 'script-heartbeats.json');
  let current = {};
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  current[String(scriptPath)] = { at: Date.now(), ok: ok !== false, hint: String(hint).slice(0, 200) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp-' + process.pid;
  fs.writeFileSync(temp, JSON.stringify(current, null, 2));
  fs.renameSync(temp, file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [, , scriptPath, status, ...hint] = process.argv;
  if (!scriptPath) throw Error('用法：node scripts/script-heartbeat.mjs <脚本路径> <ok|error> [说明]');
  reportScriptHeartbeat(root, scriptPath, status !== 'error', hint.join(' '));
}
