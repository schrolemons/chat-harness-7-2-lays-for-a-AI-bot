import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './fixtures/personal-core.mjs';
import {indexLibrary} from './personal-core.mjs';
import {loadLibrary} from '../plugins/qq-components/personal-core/library.mjs';

test('offline indexing updates only reviewed metadata and preserves document bytes', t => {
  const f=fixture(t),catalog=path.join(f.root,'catalog.json'),manifest=path.join(f.root,'manifest.json');
  const before=[fs.readFileSync(manifest),fs.readFileSync(catalog)];
  fs.appendFileSync(path.join(f.root,f.topic.path),'\n整理者解释：这是虚构示例。');
  assert.throws(()=>indexLibrary(f.root),/reviewed/);
  assert.equal(indexLibrary(f.root,{dryRun:true}).ok,true);
  assert.deepEqual([fs.readFileSync(manifest),fs.readFileSync(catalog)],before);
  assert.equal(indexLibrary(f.root,{reviewed:true}).ok,true);
  assert.equal(loadLibrary(f.root).topics.length,1);
  assert.equal(fs.readFileSync(path.join(f.root,'sources/original.md'),'utf8'),f.text);
  assert.ok(fs.readdirSync(f.root).some(name=>name.startsWith('catalog.json.bak-core-index-')));
});

test('invalid provenance or relations cannot be legitimized by rehashing',t=>{
  const f=fixture(t);f.topic.related=['absent'];f.write();
  const file=path.join(f.root,'catalog.json'),before=fs.readFileSync(file);
  assert.throws(()=>indexLibrary(f.root,{reviewed:true}),/关联/);
  assert.deepEqual(fs.readFileSync(file),before);
});
