// Targeted Cordis module HMR only: never unload an Agent or rewrite a session.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const BEGIN = '# === SCHNIE GUARD HOT WATCH BEGIN ===';
const END = '# === SCHNIE GUARD HOT WATCH END ===';
export function addWatch(text, file, config) {
  if (text.includes(BEGIN) || text.includes(END)) throw Error('Hot watch already present');
  if (!Array.isArray(config.root) || config.root.length) throw Error('Existing module watcher needs separate review');
  const rows = [{ id: 'hmr', config: { ...config, root: [file] } }, { insert: [{
    // Old preset generations can outlive their loader entries. A disabled entry
    // makes the old module discoverable by HMR without applying a global guard.
    id: 'schnie-existing-guard-hmr-target', name: 'qq-agent-presets/qq-tool-restrict.mjs', disabled: true
  }] }];
  return text + BEGIN + '\n' + yaml.dump(rows, { lineWidth: -1 }) + END + '\n';
}
export function removeWatch(text) {
  const start = text.indexOf(BEGIN), end = text.indexOf(END);
  if (start < 0 || end < start || text.indexOf(BEGIN, start + BEGIN.length) >= 0 || text.indexOf(END, end + END.length) >= 0) throw Error('Invalid hot watch markers');
  const after = end + END.length;
  return text.slice(0, start) + text.slice(after + (text[after] === '\r' ? 2 : text[after] === '\n' ? 1 : 0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const profile = path.join(process.env.USERPROFILE, '.dsh/profiles/desktop');
  const file = path.join(profile, 'cordis.patch.yml');
  const before = fs.readFileSync(file, 'utf8');
  let next;
  if (process.argv.includes('--start')) {
    const req = createRequire(path.join(profile, 'package.json'));
    const bootFile = req.resolve('@deepseek-ai/dsh-app-boot');
    const anchor = path.resolve(path.dirname(bootFile), '../../../../package.json');
    if (JSON.parse(fs.readFileSync(anchor)).name !== '@deepseek-ai/dsh') throw Error('Invalid app anchor');
    const boot = await import(pathToFileURL(bootFile));
    const p = boot.loadProfileDirectory('dsh', profile, anchor);
    const flat = rows => rows.flatMap(x => [x, ...(x.group && Array.isArray(x.config) ? flat(x.config) : [])]);
    const hmr = flat(boot.composeEntries([...p.layers.map(x => x.patches), p.patches])).filter(x => x.id === 'hmr');
    if (hmr.length !== 1 || hmr[0].name !== '@deepseek-ai/dsh-hmr') throw Error('HMR entry unavailable');
    const guard = fs.realpathSync(fileURLToPath(new URL('../../qq-agent-presets/qq-tool-restrict.mjs', import.meta.url)));
    next = addWatch(before, guard, hmr[0].config);
  } else if (process.argv.includes('--stop')) next = removeWatch(before);
  else throw Error('Use --start or --stop; no process restart is performed');
  const backup = file + '.bak-schnie-guard-' + Date.now();
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  if (fs.readFileSync(file, 'utf8') !== before) throw Error('Profile changed concurrently; abort');
  fs.writeFileSync(file, next);
  console.log(JSON.stringify({ changed: true, restart: false, backup, action: process.argv.includes('--start') ? 'watch-exact-guard' : 'remove-owned-watch' }));
}
