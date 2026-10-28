// Read-only comparison of reviewed source trees; never copies into a deployment.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const roots = ['src', 'plugins', 'public', 'dsh', 'scripts', 'roles', 'docs'];
const excluded = new Set(['node_modules', '.git', 'state', 'private', 'knowledge', 'venv', '__pycache__']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

export function snapshot(root) {
  const absolute = fs.realpathSync(root);
  const files = {};
  function visit(relative) {
    const file = path.join(absolute, relative);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      files[relative.replaceAll('\\', '/')] = { kind: 'link', sha256: hash(fs.readlinkSync(file)) };
    } else if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(file).sort()) {
        if (excluded.has(entry) || /\.bak(?:-|\.|$)/i.test(entry)) continue;
        visit(path.join(relative, entry));
      }
    } else if (stat.isFile() && /\.(?:[cm]?js|json|ya?ml|html|css|md)$/i.test(file)) {
      const bytes = fs.readFileSync(file);
      files[relative.replaceAll('\\', '/')] = { kind: 'file', bytes: bytes.length, sha256: hash(bytes) };
    }
  }
  for (const relative of roots) if (fs.existsSync(path.join(absolute, relative))) visit(relative);
  for (const relative of ['AGENTS.md', 'README.md', 'package.json', 'package-lock.json', 'workspace.example.json']) {
    if (fs.existsSync(path.join(absolute, relative))) visit(relative);
  }
  return { version: 1, files };
}

export function compare(before, after) {
  if (before?.version !== 1 || after?.version !== 1 || !before.files || !after.files) {
    throw new Error('Unsupported source manifest');
  }
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort().flatMap(file => {
    const a = before.files[file], b = after.files[file];
    if (a?.sha256 === b?.sha256 && a?.kind === b?.kind) return [];
    return [{ file, status: !a ? 'added' : !b ? 'removed' : 'changed', before: a?.sha256 || null, after: b?.sha256 || null }];
  });
}

function main(args) {
  const [command, ...rest] = args;
  if (command === 'snapshot' && rest.length === 1) {
    // Print the manifest; the caller chooses a local, ignored output location.
    console.log(JSON.stringify(snapshot(rest[0]), null, 2));
    return;
  }
  let differences;
  if (command === 'verify' && rest.length === 2) {
    differences = compare(JSON.parse(fs.readFileSync(rest[1], 'utf8').replace(/^\uFEFF/, '')), snapshot(rest[0]));
  } else if (command === 'diff' && rest.length === 2) {
    differences = compare(snapshot(rest[0]), snapshot(rest[1]));
  } else {
    throw new Error('Usage: source-workspace.mjs snapshot ROOT | verify ROOT MANIFEST | diff LEFT RIGHT');
  }
  console.log(JSON.stringify({ matching: differences.length === 0, differences }, null, 2));
  if (differences.length) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
