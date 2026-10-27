import test from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../plugins/qq-agent-presets/task-tool-restrict.mjs';

test('worker hides QQ tools, blocks direct user questions, and leaves work tools available',()=>{
  const hidden=[],guards=[],events={};
  let names=['pwsh','read','write','web_search','mcp__snowluma__qq_send_message','mcp__snowluma__qq_task_spawn','ask_user_question'];
  apply({tools:{schemas:()=>names.map(name=>({name})),restrict:({deny})=>hidden.push(...deny),guard:fn=>guards.push(fn)},on:(event,fn)=>events[event]=fn});
  assert.ok(hidden.includes('mcp__snowluma__qq_send_message'));
  assert.ok(hidden.includes('mcp__snowluma__qq_task_spawn'));
  for(const name of ['pwsh','read','write','web_search'])assert.equal(guards[0]({name}),undefined);
  assert.ok(guards[0]({name:'ask_user_question'}));
  assert.ok(guards[0]({name:'mcp__chatgpt-relay__send_message'}));
  assert.ok(guards[0]({name:'mcp__codex-peer__send_message'}));
  assert.ok(guards[0]({name:'mcp__snowluma__qq_task_input'}));
  names.push('mcp__snowluma__qq_send_sticker');events['tools/change']();
  assert.ok(hidden.includes('mcp__snowluma__qq_send_sticker'));
});
