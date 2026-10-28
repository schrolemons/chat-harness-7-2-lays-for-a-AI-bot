import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshot, compare } from './source-workspace.mjs';

test('source guard detects edits, additions and removals while excluding runtime data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-guard-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'state'));
    fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a=1;');
    fs.writeFileSync(path.join(root, 'src/b.js'), 'export const b=1;');
    fs.writeFileSync(path.join(root, 'state/secret.json'), '{"private":true}');
    const before = snapshot(root);
    assert.equal(Object.keys(before.files).length, 2);
    assert.deepEqual(compare(before, snapshot(root)), []);
    fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a=2;');
    fs.unlinkSync(path.join(root, 'src/b.js'));
    fs.writeFileSync(path.join(root, 'src/c.js'), 'export const c=1;');
    assert.deepEqual(compare(before, snapshot(root)).map(x => [x.file, x.status]), [
      ['src/a.js', 'changed'], ['src/b.js', 'removed'], ['src/c.js', 'added']
    ]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
