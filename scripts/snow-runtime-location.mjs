import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function resolveSnowHome(cfg, { roots = [root, path.dirname(root), path.dirname(path.dirname(root))], env = process.env, exists = fs.existsSync } = {}) {
  const sl = cfg?.snowluma || {};
  const valid = home => home && exists(path.join(home, 'node.exe')) && exists(path.join(home, 'index.mjs'));
  const explicit = [sl.homeDir, sl.launcherPath && path.dirname(sl.launcherPath), env.SNOWLUMA_HOME].filter(Boolean).map(value => path.resolve(value));
  for (const home of explicit) if (valid(home)) return home;
  const found = new Set();
  for (const parent of roots) {
    let entries = [];
    try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch {}
    for (const entry of entries) if (entry.isDirectory() && /^snowluma(?:[-_\s]|$)/i.test(entry.name)) {
      const candidate = path.resolve(parent, entry.name);
      if (valid(candidate)) found.add(candidate);
    }
  }
  if (found.size === 1) return [...found][0];
  if (found.size > 1) throw new Error('发现多个 SnowLuma 发行版，请明确设置 snowluma.homeDir 或 SNOWLUMA_HOME');
  throw new Error('未找到有效的 SnowLuma 运行目录，请设置 snowluma.homeDir 或 SNOWLUMA_HOME');
}
