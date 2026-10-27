import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import yaml from 'js-yaml';

const BEGIN = '# === SCHNIE PRIVATE PHI BEGIN ===';
const END = '# === SCHNIE PRIVATE PHI END ===';
const SCHEMA = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ __jsExpr: value }) }));
const parse = value => yaml.load(value, { schema: SCHEMA });
const dir = fileURLToPath(new URL('./', import.meta.url));

/** Append only the reviewed server entry; reject ambiguous or duplicate ownership. */
export function patchProfile(text, entry) {
  const start = text.indexOf(BEGIN), end = text.indexOf(END);
  if ((start < 0) !== (end < 0) || (start >= 0 && end < start) || text.indexOf(BEGIN, start + BEGIN.length) >= 0 || text.indexOf(END, end + END.length) >= 0) throw Error('Invalid SCHNIE patch markers');
  const owned = start < 0 ? '' : text.slice(start + BEGIN.length, end);
  if (owned && isDeepStrictEqual(parse(owned), [{ insert: [entry] }])) return text;
  const outside = start < 0 ? text : text.slice(0, start) + text.slice(end + END.length);
  const before = parse(outside);
  if (!Array.isArray(before)) throw Error('Profile patch must be an array');
  const hasId = rows => rows.some(row => row?.id === entry.id || (Array.isArray(row?.insert) && hasId(row.insert)));
  if (hasId(before)) throw Error('SCHNIE server entry already exists outside the managed block');
  const prefix = outside.trim() === '[]' ? '' : outside;
  const next = prefix + (prefix.endsWith('\n') ? '\n' : '\n\n') + BEGIN + '\n' + yaml.dump([{ insert: [entry] }], { lineWidth: -1, noRefs: true }) + END + '\n';
  if (!Array.isArray(parse(next))) throw Error('Invalid merged profile');
  return next;
}

/** Persist an idempotent desktop-profile patch, retaining the exact previous file. */
export function install({ profile = path.join(os.homedir(), '.dsh/profiles/desktop'), dryRun = false } = {}) {
  const file = path.join(profile, 'cordis.patch.yml');
  const original = fs.readFileSync(file, 'utf8');
  const entry = { id: 'mcp-schnie-private-phi', name: '@deepseek-ai/dsh-mcp-client', config: {
    serverName: 'schnie-private-phi', transport: 'stdio', command: process.execPath, args: [path.join(dir, 'mcp.mjs')]
  } };
  const next = patchProfile(original, entry);
  const result = { profile, changed: next !== original, dryRun, server: entry.config.serverName, backup: null };
  if (!dryRun && result.changed) {
    result.backup = file + '.bak-schnie-phi-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, result.backup, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(file, next, 'utf8');
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--profile');
  if (index >= 0 && !args[index + 1]) throw Error('--profile requires a path');
  console.log(JSON.stringify(install({ ...(index >= 0 ? { profile: args[index + 1] } : {}), dryRun: args.includes('--dry-run') }), null, 2));
}
