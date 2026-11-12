import test from 'node:test';import assert from 'node:assert/strict';
import {createModelPolicyController,modelPolicyRevision} from '../src/console/model-policy.mjs';
import {validateCatalogSelection,validateCatalogRange} from '../plugins/qq-components/obs-cost-policy/catalog.mjs';
export const catalogFixture={groups:[
 {id:'magpie-responses',models:[{id:'codex/gpt-6.1-sol',reasoning:{efforts:[{id:'low'},{id:'medium'},{id:'xhigh'},{id:'max'}]}}]},
 {id:'other',models:[{id:'codex/gpt-6.1-sol',reasoning:{efforts:[{id:'off'},{id:'custom-effort'}]}},{id:'plain'}]}
]};
const chat={provider:'magpie-responses',model:'codex/gpt-6.1-sol',effort:'low'};
function fixture(){let policy={conversation:chat,task:chat,presets:{}},offline=false,saves=0,syncs=0;
 const c=createModelPolicyController({fetchCatalog:async()=>{if(offline)throw Error('offline');return catalogFixture;},fetchPresets:async()=>[{id:'owned:qq-task-worker'},{id:'future'}],canonicalPreset:id=>id==='owned:qq-task-worker'?'qq-task-worker':id,readPolicy:()=>policy,savePolicy:async next=>{saves++;policy=next;return {ok:true};},synchronize:async()=>{syncs++;return {ok:true};}});
 const request=async(path,body)=>{let result;await c.route({req:{method:body?'POST':'GET'},url:new URL(path,'http://fixture'),readBody:async()=>body,sendJson:(data,status=200)=>{result={data,status};}});return result;};
 return {request,revision:()=>modelPolicyRevision(policy),policy:()=>policy,offline:()=>{offline=true;},counts:()=>({saves,syncs})};
}
test('all catalog tuples are supported, including same model IDs under different providers, custom and empty effort',()=>{
 for(const g of catalogFixture.groups)for(const m of g.models)for(const effort of ['',...(m.reasoning?.efforts||[]).map(e=>e.id)])assert.deepEqual(validateCatalogSelection({provider:g.id,model:m.id,effort},catalogFixture),{provider:g.id,model:m.id,effort});
 assert.throws(()=>validateCatalogSelection({...chat,effort:'off'},catalogFixture));assert.throws(()=>validateCatalogSelection({provider:'other',model:'plain',effort:'high'},catalogFixture));
 assert.throws(()=>validateCatalogRange({allowed:[{provider:'other',model:'plain',efforts:[]}]},catalogFixture));
});
test('current DSH preset list is canonicalized; concurrent stale revisions cannot overwrite another edit',async()=>{
 const f=fixture(),list=await f.request('/api/presets/model-policy');assert(list.data.presets.some(p=>p.id==='qq-task-worker'));
 const revision=f.revision();const values=await Promise.all(['conversation','task'].map(scope=>f.request('/api/presets/model-policy',{scope,selection:{...chat,effort:'medium'},revision})));
 assert.deepEqual(values.map(x=>x.status),[200,409]);assert.deepEqual(f.counts(),{saves:1,syncs:1});
});
test('invalid tuples, unknown presets and unavailable directory leave configuration and sessions untouched; retired endpoint cannot write',async()=>{
 const f=fixture(),request=(scope,selection,extra={})=>f.request('/api/presets/model-policy',{scope,selection,revision:f.revision(),...extra});
 assert.equal((await request('conversation',{...chat,effort:'off'})).status,400);
 assert.equal((await request('preset',chat,{presetId:'missing'})).status,400);
 assert.equal((await f.request('/api/dsh/effort',{reasoningEffort:'high'})).status,410);
 f.offline();assert.equal((await request('task',chat)).status,503);assert.equal((await f.request('/api/dsh/models')).status,503);assert.deepEqual(f.counts(),{saves:0,syncs:0});
});
