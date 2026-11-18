import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import yaml from 'js-yaml';
import {readInstanceSessionPolicy} from '../src/instance-session-policy.mjs';
import {presetBindings,summarizePreset} from '../src/console/preset-overview.js';
import {selectCostPolicy} from '../plugins/qq-components/obs-cost-policy/policy.mjs';
import {isAdminEnvironmentAuthorized} from '../src/tools/admin-policy.js';
const old=['qq-chat','qq-chat-v2','qq-admin','qq-learning','qq-task-worker','campus-summary'],map=Object.fromEntries(old.map(id=>[id,'owned:'+id]));
const descriptor={version:1,instanceId:'owned',root:path.join(os.tmpdir(),'memory-preset-test'),entryId:'owned-mode',settingsNamespace:'owned-mode',presetIdMap:map};
test('existing six preset identities survive the additive memory-preset upgrade',()=>{
 const p=readInstanceSessionPolicy({descriptor,env:{QQ_BRIDGE_PRESET_MAP:JSON.stringify(map)}});
 for(const id of old)assert.equal(p.resolvePreset(id),map[id]);assert.equal(p.resolvePreset('qq-memory-worker'),'owned:qq-memory-worker');assert.equal(p.workspaceKind('owned:qq-memory-worker'),'learning');
 const broken={...map};delete broken['qq-chat'];assert.throws(()=>readInstanceSessionPolicy({descriptor,env:{QQ_BRIDGE_PRESET_MAP:JSON.stringify(broken)}}),/PRESET_MAP/);
 assert.throws(()=>readInstanceSessionPolicy({descriptor,env:{QQ_BRIDGE_PRESET_MAP:JSON.stringify({...map,'qq-memory-worker':'other:qq-memory-worker'})}}),/PRESET_MAP/);
});
test('preset overview identifies the same mapped memory preset and its tool-free ownership',()=>{
 const p=readInstanceSessionPolicy({descriptor,env:{}}),binding=presetBindings({mode:'reserved2',sessionPolicy:p}).find(b=>b.key==='memory');assert.ok(binding);assert.equal(binding.label,'记忆整理');assert.equal(binding.preset,p.resolvePreset('qq-memory-worker'));
 const source=fs.readFileSync(new URL('../dsh/agent-presets/qq-memory-worker/agent.cordis.yml',import.meta.url),'utf8');assert(summarizePreset(source).features.some(s=>s.includes('记忆整理')));
 const rows=yaml.load(source);assert.deepEqual(rows.map(r=>r.id),['persona','memory-tool-restrict']);
 assert.equal(isAdminEnvironmentAuthorized({owner:true,enabled:true,selectedPreset:binding.preset,loadedPreset:binding.preset,hasSession:true,knownPresets:[binding.preset],presetMap:p.presetMap}),false);
});
test('memory model overrides do not change the existing independent task model range',()=>{
 const range={allowed:[{provider:'deepseek-official',model:'deepseek-flash',efforts:['off','high']}]};
 const policy={conversation:{provider:'ustc',model:'qwen3.8-flash-next',effort:''},task:{provider:'deepseek-official',model:'deepseek-flash',effort:'off'},presets:{'qq-memory-worker':{provider:'ustc',model:'deepseek-flash',effort:''},'qq-task-worker':range}};
 assert.equal(selectCostPolicy(policy,{preset:'qq-memory-worker',reason:'memoryWrite'}).model,'deepseek-flash');assert.deepEqual(policy.presets['qq-task-worker'],range);
});
