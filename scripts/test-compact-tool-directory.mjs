import test from'node:test';import assert from'node:assert/strict';import * as tools from'../plugins/qq-agent-presets/dynamic-tools.mjs';
test('large catalogs become a bounded category index while every tool remains discoverable',()=>{
 const available=Array.from({length:220},(_,i)=>({name:'mcp__snowluma__qq_memory_operation_'+i,description:'记忆工具：'+('这是一段很长的完整参数及操作说明。'.repeat(10))}));
 assert.equal(typeof tools.buildToolDirectory,'function');const index=tools.buildToolDirectory(available);
 assert(index.length<2000);assert.match(index,/220/);assert.match(index,/记忆/);assert.doesNotMatch(index,/完整参数及操作说明/);
 assert.equal(tools.searchChatTools(available,'记忆与档案').length,12);assert.equal(tools.searchChatTools(available,'qq_memory_operation_219')[0].name,available.at(-1).name);
});
test('private chat hides the group-only reply tool from the default schema without granting or deleting tools',()=>{
 const available=[{name:'mcp__snowluma__qq_reply'},{name:'mcp__snowluma__qq_send_message'},{name:'mcp__snowluma__qq_relay_image'}];
 assert.deepEqual(tools.selectChatTools(available,new Set(),{key:'private:123'}).map(x=>x.name),['mcp__snowluma__qq_send_message']);
 assert(tools.selectChatTools(available,new Set(['mcp__snowluma__qq_reply']),{key:'private:123'}).some(x=>x.name.endsWith('__qq_reply')));
 assert.equal(tools.selectChatTools(available).length,2);
});

test('the old namespaced selector resolves through the same filtered inventory without adding a duplicate schema or permissions',async()=>{
 const registered=new Map(),events=new Map(),ctx={tools:{register:tool=>registered.set(tool.name,tool)},on:(name,fn)=>events.set(name,fn)};
 tools.installDynamicChatTools(ctx);const agent={session:{id:'fixture-selector'}},alias='mcp__snowluma__qq_select_tools';
 assert(registered.has(alias));const available=[...registered.values(),{name:'mcp__snowluma__qq_get_message_images',description:'看图'}];
 const assemble=()=>events.get('system-prompt/assemble')({}, {agent},async()=>({tools:available,sections:[]}));
 const initial=await assemble();assert(!initial.tools.some(t=>t.name===alias));
 const selected=await registered.get(alias).execute({query:'qq_get_message_images'},{agent});assert.deepEqual(selected.loaded,['mcp__snowluma__qq_get_message_images']);
 const next=await assemble();assert(next.tools.some(t=>t.name==='mcp__snowluma__qq_get_message_images'));assert(!next.tools.some(t=>t.name===alias));
 const denied=await registered.get(alias).execute({query:'pwsh secret-admin-tool'},{agent});assert.deepEqual(denied.loaded,[]);
});
