import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ASSETS = { '/console/app.js': 'application/javascript; charset=utf-8', '/console/app.css': 'text/css; charset=utf-8', '/console/theme-init.js': 'application/javascript; charset=utf-8' };
const COOKIE = 'whale_console_assets';
const assetKey = token => crypto.createHash('sha256').update('whale:read-console-assets:' + token).digest('hex');

export function isConsoleAssetPath(pathname) { return Object.hasOwn(ASSETS, pathname); }
export function consoleAssetCookie(token) {
  return `${COOKIE}=${assetKey(token)}; Path=/console/; HttpOnly; SameSite=Strict`;
}
// This derived credential is accepted for the three compiled assets only. It is never an admin token.
export function hasConsoleAssetCookie(header, token) {
  if (!token) return false;
  const value = String(header || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
  const expected = assetKey(token);
  return /^[a-f0-9]{64}$/.test(value) && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
export function readConsoleAsset(root, pathname) {
  if (!isConsoleAssetPath(pathname)) return null;
  return { type: ASSETS[pathname], body: fs.readFileSync(path.join(root, 'public', pathname.slice(1))) };
}
export function renderConsoleDocument(root, { entry = 'public/console.html' } = {}) {
  const sourceRoot = fs.realpathSync(path.join(root, 'console'));
  const entryPath = path.resolve(root, entry);
  let document = fs.readFileSync(entryPath, 'utf8');
  for (let depth = 0; /<!--\s*include:/.test(document); depth++) {
    if (depth >= 8) throw new Error('Console include nesting exceeded');
    document = document.replace(/<!--\s*include:([^>]+?)\s*-->/g, (_, name) => {
      if (!/^(?:layers\/[CTELOVGSR]\/pages|shared\/layout)\/[a-z0-9-]+\.html$/.test(name)) throw new Error('Invalid console include');
      const file = fs.realpathSync(path.join(sourceRoot, name));
      if (!file.startsWith(sourceRoot + path.sep)) throw new Error('Console include escapes source tree');
      return fs.readFileSync(file, 'utf8').trim();
    });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/console/manifest.json'), 'utf8'));
  return document.replaceAll('{{BUILD}}', manifest.build);
}
