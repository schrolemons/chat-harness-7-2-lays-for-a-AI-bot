import crypto from 'node:crypto';
import { readLauncherSettings } from '../scripts/launcher-settings.mjs';

const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
// Bridge treats these lists as membership sets, with numeric/string IDs equal.
const ids = value => [...new Set((Array.isArray(value) ? value : []).map(id => String(id).trim()).filter(id => /^\d+$/.test(id)))].sort();

/** Runtime restart identity, deliberately separate from settings' revision CAS.
 * Only host listener metadata and known equivalent/default representations are
 * excluded. Unknown config fields remain conservative restart dependencies. */
export function runtimeConfigFingerprint(cfg) {
  const settings = readLauncherSettings(undefined, cfg);
  const ports = { ...cfg.launcher?.ports, ...settings.ports }; delete ports.launcher;
  const owner = String(cfg.ownerQQ ?? '').trim();
  const { private: _private, privates: _privates, groups: _groups, group: _group, ...allow } = cfg.allow || {};
  const normalized = { ...cfg,
    ownerQQ: !owner ? null : /^\d+$/.test(owner) && Number.isSafeInteger(Number(owner)) && Number(owner) > 0 ? Number(owner) : cfg.ownerQQ,
    allow: { ...allow, private: ids(cfg.allow?.private ?? cfg.allow?.privates), groups: ids(cfg.allow?.groups ?? cfg.allow?.group) },
    snowluma: { ...cfg.snowluma, botUin: settings.botUin },
    launcher: { ...cfg.launcher, ports },
  };
  return crypto.createHash('sha256').update(JSON.stringify(sorted(normalized))).digest('hex');
}
