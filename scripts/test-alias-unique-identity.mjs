import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-member-alias/index.js';
import {resolveWhaleAddressing,WHALE_ADDRESS_RULE} from '../plugins/qq-components/ctx-context-dynamics/whale-addressing.mjs';
function fixture(saved={}){let state=structuredClone(saved);const tools=new Map();const p=createPlugin({config:{autoExtract:false},runtime:{},state:{get:()=>structuredClone(state),set:s=>state={...state,...structuredClone(s)}},registerTool:(n,s)=>tools.set(n,s),capabilities:{getOwnerQQ:()=>12345},isActive:()=>true});return {p,call:(n,i)=>tools.get(n).handler(i),state:()=>state};}
test('all confirmation paths enforce one normalized alias per QQ and preserve unrelated aliases',()=>{
 const f=fixture();assert.equal(f.call('alias_add',{alias:'小猫',qq:'11111',key:'group:456'}).ok,true);
 const before=structuredClone(f.state());assert.equal(f.call('alias_add',{alias:'小猫',qq:'22222',key:'group:456'}).ok,false);assert.deepEqual(f.state(),before);
 assert.equal(f.call('alias_add',{alias:'小猫咪',qq:'11111',key:'group:456'}).ok,true);
 const pending=f.call('alias_submit',{alias:'猫猫',qq:'22222',key:'group:456'});assert.equal(pending.ok,false,'autoExtract off remains enforced');
 const candidate=fixture({entries:[...f.state().entries,{id:'candidate',alias:'猫猫',qq:'22222',status:'candidate',originKey:'group:456',sourceKeys:['group:456']}]});
 assert.equal(candidate.call('alias_confirm',{id:'candidate',alias:'小猫',qq:'22222'}).ok,false);
 assert.equal(candidate.p.services.aliases.lookupConfirmed({alias:'小猫'}).qq,'11111');
});
test('legacy conflicting confirmed rows remain inspectable but cannot be injected or resolved',()=>{
 const entries=[{id:'a',alias:'猫猫',qq:'11111',status:'confirmed',originKey:'group:456',sourceKeys:['group:456']},{id:'b',alias:'猫猫',qq:'22222',status:'confirmed',originKey:'group:456',sourceKeys:['group:456']}];
 const f=fixture({entries});assert.equal(f.call('alias_list',{}).entries.length,2);
 const q=f.p.services.aliases.query({key:'group:456',q:'猫猫'});assert.equal(q.ambiguous,true);assert.equal(q.entries?.length||0,0);
 const prompt=f.p.hooks.beforePrompt({key:'group:456'});assert.ok(!prompt.includes('猫猫 = '));assert.match(prompt,/一个绰号.*QQ|一个.*QQ/);
 assert.deepEqual(f.state().entries,entries,'no destructive automatic migration');
});
test('same display nickname on different QQs never grants a shared specific nickname',()=>{
 const a=resolveWhaleAddressing({key:'group:456',roleName:'AI助手',st:{unread:[{userId:'11111',sender:'示例猫'},{userId:'22222',sender:'示例猫'}]}},'12345');
 assert.equal(a.speakers.length,2);assert.ok(a.speakers.every(s=>!s.addresses.includes('示例猫用户')));
 assert.match(WHALE_ADDRESS_RULE,/前缀/);assert.match(WHALE_ADDRESS_RULE,/QQ/);
});

test('similar nickname prefixes remain distinct identities and a prefix query never selects the first person',()=>{
 const f=fixture();
 f.call('alias_add',{alias:'示例猫',qq:'11111',key:'group:456'});
 f.call('alias_add',{alias:'示例茶',qq:'22222',key:'group:456'});
 assert.equal(f.p.services.aliases.lookupConfirmed({alias:'示例'}).ok,false);
 const q=f.p.services.aliases.query({key:'group:456',q:'示例'});
 assert.equal(q.ambiguous,true);assert.deepEqual(new Set(q.entries.map(e=>e.qq)),new Set(['11111','22222']));
 assert.equal(f.p.services.aliases.lookupConfirmed({alias:'示例猫'}).qq,'11111');
 assert.equal(f.p.services.aliases.lookupConfirmed({alias:'示例茶'}).qq,'22222');
});
