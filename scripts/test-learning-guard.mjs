import test from 'node:test';import assert from 'node:assert/strict';
test('knowledge learner only sees public web tools and blocks QQ, local execution and cross-session actions',async()=>{
 const {apply}=await import('../plugins/qq-agent-presets/learning-tool-restrict.mjs');
 const hidden=[],guards=[],events={};let names=['web_search','web_fetch','mcp__web-search-safe__web_fetch','pwsh','read','write','ask_user_question','mcp__snowluma__qq_send_message','mcp__codex-peer__codex_chat_send','spawn_teammate'];
 apply({tools:{schemas:()=>names.map(name=>({name})),restrict:({deny})=>hidden.push(...deny),guard:f=>guards.push(f)},on:(event,f)=>events[event]=f});
 for(const name of ['web_search','web_fetch','mcp__web-search-safe__web_fetch'])assert.equal(guards[0]({name}),undefined);
 for(const name of ['pwsh','read','write','ask_user_question','mcp__snowluma__qq_send_message','mcp__codex-peer__codex_chat_send','spawn_teammate']){assert.ok(guards[0]({name}));assert.ok(hidden.includes(name));}
 names.push('mcp__snowluma__qq_term_submit');events['tools/change']();assert.ok(hidden.includes('mcp__snowluma__qq_term_submit'));
});
