import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/life-wake-reasons/index.js';
import {frameModules} from '../plugins/qq-components/obs-context-assembly/frame.mjs';
import {compileModules} from '../plugins/qq-components/obs-context-assembly/policy.mjs';
const plugin=()=>{let data={};return createPlugin({config:{},state:{get:()=>data,set:patch=>Object.assign(data,patch)},warn:()=>{},log:()=>{},capabilities:{}});};
test('private entry guidance contains private decisions and never uses the group-only action paragraph',()=>{
 const text=plugin().hooks.wakeTail({key:'private:1',reason:'private',triggeredLine:''});assert.match(text,/私聊/);assert(!/群里在聊什么|群聊正热|没人叫你/.test(text));assert.match(text,/qq_wait_for_messages/);
});
test('group entry retains group action guidance while the shared protocol moves to the stable prefix',()=>{
 const text=plugin().hooks.wakeTail({key:'group:1',reason:'probability',triggeredLine:''});assert.match(text,/【行动前｜群聊】/);assert.match(text,/优先回复本次@、点名、提问或拍一拍/);
 const rows=frameModules({prompt:text,snapshot:{messages:[{seq:1,text:'hi'}],recent:[]}}),compiled=compileModules(rows);
 const protocol=compiled.selected.find(row=>row.id==='session-protocol'),task=compiled.selected.find(row=>row.id==='wake-action');assert.equal(protocol.placement,'stable');assert.match(protocol.text,/messageId/);assert(!task.text.includes('【多条未读'));assert.match(task.text,/【行动前｜群聊】/);
});
