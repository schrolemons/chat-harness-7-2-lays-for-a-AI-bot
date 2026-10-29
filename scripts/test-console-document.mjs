import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const modulePath = new URL('../src/console/document.js', import.meta.url);
test('console assets never expose source, state or traversal paths', async () => {
  assert.ok(fs.existsSync(modulePath), 'modular console document service exists');
  const { readConsoleAsset, consoleAssetCookie, hasConsoleAssetCookie } = await import(modulePath);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-document-'));
  try {
    fs.mkdirSync(path.join(root, 'public/console'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public/console/app.js'), 'test script');
    assert.equal(readConsoleAsset(root, '/console/app.js').body.toString(), 'test script');
    for (const name of ['/console/../config.json', '/console/%2e%2e/config.json', '/console/source.js', '/config.json']) {
      assert.equal(readConsoleAsset(root, name), null);
    }
    const cookie = consoleAssetCookie('test-admin-secret');
    assert.equal(cookie.includes('test-admin-secret'), false);
    assert.equal(hasConsoleAssetCookie(cookie, 'test-admin-secret'), true);
    assert.equal(hasConsoleAssetCookie(cookie, 'wrong-secret'), false);
    assert.equal(hasConsoleAssetCookie('whale_console_assets='+'é'.repeat(64), 'test-admin-secret'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('template includes cannot escape the owned frontend tree', async () => {
  assert.ok(fs.existsSync(modulePath), 'modular console document service exists');
  const { renderConsoleDocument } = await import(modulePath);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-template-'));
  try {
    fs.mkdirSync(path.join(root, 'console/layers/C/pages'), { recursive: true });
    fs.mkdirSync(path.join(root, 'public/console'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public/console/manifest.json'), '{"build":"fixture"}');
    fs.writeFileSync(path.join(root, 'public/console.html'), '<!-- include:layers/C/pages/memory.html --> {{BUILD}}');
    fs.writeFileSync(path.join(root, 'console/layers/C/pages/memory.html'), '<p>current memory form</p>');
    assert.equal(renderConsoleDocument(root), '<p>current memory form</p> fixture');
    fs.writeFileSync(path.join(root, 'public/console.html'), '<!-- include:../config.json -->');
    assert.throws(() => renderConsoleDocument(root), /include/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
