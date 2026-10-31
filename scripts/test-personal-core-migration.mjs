import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import os from 'node:os';import path from 'node:path';import yaml from 'js-yaml';
import {fixture} from './fixtures/personal-core.mjs';
import {preparePersonalCoreMigration,applyPersonalCoreMigration} from '../src/migrations/personal-core.mjs';
import {planPersonalCoreMigration} from '../src/migrations/personal-core.mjs';
import {patchProfile,createMcpEntry} from '../plugins/qq-components/personal-core/install.mjs';
test('one-time migration plans a single canonical component and MCP namespace',async()=>{assert.ok(fs.existsSync(new URL('../src/migrations/personal-core.mjs',import.meta.url)),'one-time migration must exist');const {planPersonalCoreMigration}=await import('../src/migrations/personal-core.mjs');const original='# model configuration remains here\n[]\n';const plan=planPersonalCoreMigration({root:process.cwd(),profileText:original,legacyConfig:{coreSessionKeys:['private:7'],worldviewPatterns:['自由'],coreCarePatterns:['孤独']},registry:{disabled:['schnie-core'],enabled:['other'],order:['other','schnie-core']}});assert.deepEqual(plan.config.careSessionKeys,['private:7']);assert.ok(plan.registry.disabled.includes('personal-core'));assert.ok(!JSON.stringify(plan.registry).includes('schnie-core'));assert.match(plan.profileText,/mcp-personal-core/);assert.doesNotMatch(plan.profileText,/mcp-schnie-private-phi/);assert.ok(plan.profileText.startsWith('# model configuration remains here'));});

test('installer preserves unrelated YAML and is idempotent',()=>{
  const entry=createMcpEntry(process.cwd()),original='# untouched\n- id: unrelated\n  config: { flag: true }\n';
  const next=patchProfile(original,entry);assert.ok(next.startsWith(original));
  assert.deepEqual(yaml.load(next)[0],yaml.load(original)[0]);
  assert.equal(patchProfile(next,entry),next);
  assert.throws(()=>patchProfile('- insert:\n    - id: mcp-personal-core\n',entry),/outside/);
});

test('unmarked legacy profile row is replaced without changing adjacent settings',()=>{
 const before='# retained\n- id: previous\n  config: {keep: yes}\n',after='- id: following\n  config: {keep: true}\n';
 const old='- insert:\n    - id: mcp-schnie-private-phi\n      name: client\n      config:\n        serverName: schnie-private-phi\n';
 const plan=planPersonalCoreMigration({root:process.cwd(),profileText:before+old+after,legacyConfig:{coreSessionKeys:[],worldviewPatterns:[],coreCarePatterns:[]}});
 assert.ok(plan.profileText.startsWith(before+after));assert.doesNotMatch(plan.profileText,/schnie-private-phi/);
 assert.equal((plan.profileText.match(/id: mcp-personal-core/g)||[]).length,1);
});

function migrationFixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'core-cutover-')),p=fixture(t);
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(rel,text)=>{const dest=path.join(root,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);};
  write('roles/persona.md','原样保留的人设');
  write('plugins/qq-components/schnie-core/plugin.json',JSON.stringify({config:{coreSessionKeys:['private:7'],worldviewPatterns:['自由'],coreCarePatterns:['孤独']}}));
  write('state/plugins/config/schnie-core.json',JSON.stringify({coreSessionKeys:['private:8']}));
  write('state/plugins/registry.json',JSON.stringify({enabled:['schnie-core','other'],disabled:[],order:['other','schnie-core'],custom:'retain'}));
  write('profile/cordis.patch.yml','# preserve profile\n[]\n');
  fs.cpSync(p.root,path.join(root,'private-libraries/schnie'),{recursive:true});
  const plan=preparePersonalCoreMigration({root,profile:path.join(root,'profile')});
  const stage=()=>{fs.unlinkSync(path.join(root,'plugins/qq-components/schnie-core/plugin.json'));write('plugins/qq-components/personal-core/mcp.mjs','// staged');};
  return {root,plan,stage,write};
}

test('cutover migrates exact owner scope, leaves roles untouched and cannot apply twice',t=>{
  const f=migrationFixture(t);f.stage();assert.equal(applyPersonalCoreMigration(f.plan).ok,true);
  const read=rel=>JSON.parse(fs.readFileSync(path.join(f.root,rel)));
  assert.deepEqual(read('state/plugins/config/personal-core.json').careSessionKeys,['private:8']);
  assert.equal(read('state/plugins/registry.json').custom,'retain');
  assert.equal(fs.readFileSync(path.join(f.root,'roles/persona.md'),'utf8'),'原样保留的人设');
  assert.ok(!fs.existsSync(path.join(f.root,'state/plugins/config/schnie-core.json')));
  assert.equal(applyPersonalCoreMigration(f.plan).alreadyApplied,true);
});

test('cutover refuses stale profiles and rolls back an invalid package',t=>{
  const f=migrationFixture(t);f.stage();const profile=path.join(f.root,'profile/cordis.patch.yml'),before=fs.readFileSync(profile);
  fs.appendFileSync(profile,'# concurrent change');assert.throws(()=>applyPersonalCoreMigration(f.plan),/profile/);
  fs.writeFileSync(profile,before);fs.unlinkSync(path.join(f.root,'private-libraries/schnie/topics/belonging.md'));
  assert.throws(()=>applyPersonalCoreMigration(f.plan));assert.deepEqual(fs.readFileSync(profile),before);
  assert.ok(fs.existsSync(path.join(f.root,'state/plugins/config/schnie-core.json')));
  assert.ok(!fs.existsSync(path.join(f.root,'state/plugins/config/personal-core.json')));
  assert.ok(!fs.existsSync(path.join(f.root,'state/migrations/personal-core-v1.json')));
});
