import test from 'node:test';
import assert from 'node:assert/strict';
import {visualGroups,contextLayerGuide,componentGuide} from '../console/layers/O/context-knowledge.js';
import {compileModules,normalizePolicy} from '../plugins/qq-components/obs-context-assembly/policy.mjs';
import {moduleCatalog,completeModuleSlots} from '../plugins/qq-components/obs-context-assembly/catalog.mjs';

test('settings follow loading layers, keep source numbers, and omit context management',()=>{
 const catalog=moduleCatalog(process.cwd());
 const rows=compileModules(completeModuleSlots([{id:'obs-context-assembly',text:''},{id:'personal-core',text:''},{id:'session-background',text:'背景'}],catalog),{order:['personal-core','session-background','role-card']}).modules;
 const groups=visualGroups(rows,catalog);
 assert.deepEqual(groups.map(group=>group.id),['fixed','stable','current']);
 assert.deepEqual(groups.map(group=>group.name),['系统上下文','稳定用户上下文','当前补充资料（历史后注入）']);
 const visible=groups.flatMap(group=>group.rows);
 assert(!visible.some(row=>row.id==='obs-context-assembly'));
 assert.equal(visible.find(row=>row.id==='personal-core').index,39);
 assert(groups[1].rows.some(row=>row.id==='session-background'));
 assert(groups[2].rows.some(row=>row.id==='ctx-context-dynamics'));
 assert.equal(catalog.length,40);
 assert.equal(catalog[39].id,'personal-core');
});
test('layer and component guides explain mechanisms and state the limits of the Tavern analogy',()=>{
 const guide=contextLayerGuide();for(const term of ['主提示词','世界书','角色','历史后注入','工具定义','独立','不改变'])assert(guide.includes(term),term);
 const c10=componentGuide({id:'ctx-chat-topic-drive',description:'话题推进'});for(const term of ['等待工具返回','冷却','发送成功'])assert(c10.includes(term),term);
 const c40=componentGuide({id:'personal-core'});assert.match(c40,/目录导读/);assert.match(c40,/按需读取/);
 assert(!componentGuide({id:'unknown',description:'<script>说明</script>'}).includes('<script>'));
 assert(moduleCatalog(process.cwd()).find(row=>row.id==='ctx-chat-topic-drive').description);
});

test('loading layer takes priority over user order; old history cleanup is not configurable',()=>{
 const rows=[{id:'ctx-context-dynamics',text:'心情'},{id:'session-background',text:'背景'},{id:'role-card',text:'人设'}];
 assert.deepEqual(compileModules(rows,{order:rows.map(row=>row.id)}).selected.map(row=>row.id),['role-card','session-background','ctx-context-dynamics']);
 assert.equal(Object.hasOwn(normalizePolicy({}),'compactHistory'),false);
 assert.throws(()=>normalizePolicy({compactHistory:true}),/未知/);
});
