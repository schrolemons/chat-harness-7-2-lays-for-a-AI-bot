import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import {fileURLToPath} from 'node:url';
import {assertLegacyControlAllowed} from './legacy-control-guard.mjs';
assertLegacyControlAllowed(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const profile = process.argv[2] || 'desktop';
if (!/^[\w-]+$/.test(profile)) throw Error('Invalid profile name');
const file = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', profile, 'cordis.patch.yml');
const source = fs.readFileSync(new URL('../plugins/qq-agent-presets/presets/campus-summary.patch.yml', import.meta.url), 'utf8');
const begin = '# === CAMPUS WEB SUMMARY BEGIN ===', end = '# === CAMPUS WEB SUMMARY END ===';
const original = fs.readFileSync(file, 'utf8');
let next;
if (original.includes(begin)) {
  const start = original.indexOf(begin), finish = original.indexOf(end, start);
  if (finish < 0) throw Error('Incomplete summary configuration block');
  next = original.slice(0, start) + begin + '\n' + source + end + original.slice(finish + end.length);
} else {
  if (original.includes('preset-campus-summary')) throw Error('Existing summary preset outside managed block');
  next = original.trimEnd() + '\n\n' + begin + '\n' + source + end + '\n';
}
yaml.load(next);
if (next !== original) {
  fs.copyFileSync(file, file + '.bak-web-summary-' + Date.now());
  fs.writeFileSync(file, next, 'utf8');
}
console.log('网页整理预设已安装到 profile ' + profile + '；保留原有预设、模型和会话。');
