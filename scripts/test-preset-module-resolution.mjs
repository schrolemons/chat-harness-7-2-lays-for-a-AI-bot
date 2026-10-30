import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {GUARD_SPECIFIER,PRESETS,REPO_ROOT,renderPatch} from './build-agent-preset-patches.mjs';

test('generated presets reference the canonical guard and only existing bundle modules',()=>{
 assert.equal(GUARD_SPECIFIER,'qq-agent-presets/qq-tool-restrict.mjs');
 for(const preset of PRESETS){
  const rows=yaml.load(renderPatch(preset))[0].insert[0].config.plugins;
  for(const row of rows){
   if(row.name?.startsWith('qq-agent-presets/'))assert.ok(fs.existsSync(path.join(REPO_ROOT,'plugins',row.name)),preset+' references missing '+row.name);
  }
 }
});
