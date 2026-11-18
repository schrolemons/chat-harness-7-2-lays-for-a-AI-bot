import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/life-wake-reasons/index.js';
import {frameModules} from '../plugins/qq-components/obs-context-assembly/frame.mjs';
import {compileModules} from '../plugins/qq-components/obs-context-assembly/policy.mjs';
import {MULTI_MESSAGE_REPLY_POLICY} from '../src/qq-reply-policy.js';
import fs from 'node:fs';
const plugin=()=>{let data={};return createPlugin({config:{},state:{get:()=>data,set:patch=>Object.assign(data,patch)},warn:()=>{},log:()=>{},capabilities:{}});};
test('wake permits inline grouping of selected sources and retains standalone fallback contracts',()=>{
 const wake=plugin().hooks.wakeTail({key:'group:1',reason:'probability'});assert.match(wake,/sourceSeqs/);assert.match(wake,/发送中完成分组/);assert.match(wake,/实际回应的准确seq/);assert.match(wake,/已有contentId沿用/);
 const preset=fs.readFileSync(new URL('../dsh/agent-presets/qq-chat-v2/agent.cordis.yml',import.meta.url),'utf8');assert.match(preset,/sourceSeqs/);assert.match(preset,/已有contentId就沿用/);
 const contracts=[MULTI_MESSAGE_REPLY_POLICY];
 for(const text of contracts){assert.match(text,/同一人连续补充/);assert.match(text,/一条自然消息/);assert.match(text,/缺少.*qq_reply_contents/);assert.match(text,/contentId/);assert.match(text,/普通群聊可以只读不插话/);}
});
test('private entry guidance contains private decisions and never uses the group-only action paragraph',()=>{
 const text=plugin().hooks.wakeTail({key:'private:1',reason:'private',triggeredLine:''});assert.match(text,/私聊/);assert(!/群里在聊什么|群聊正热|没人叫你/.test(text));assert.match(text,/qq_wait_for_messages/);
});
test('group entry retains group action guidance while the shared protocol moves to the stable prefix',()=>{
 const text=plugin().hooks.wakeTail({key:'group:1',reason:'probability',triggeredLine:''});assert.match(text,/【行动前｜群聊】/);assert.match(text,/优先回复本次@、点名、提问或拍一拍/);
 const rows=frameModules({prompt:text,snapshot:{messages:[{seq:1,text:'hi'}],recent:[]}}),compiled=compileModules(rows);
 const protocol=compiled.selected.find(row=>row.id==='session-protocol'),task=compiled.selected.find(row=>row.id==='wake-action');assert.equal(protocol.placement,'stable');assert.match(protocol.text,/messageId/);assert(!task.text.includes('【多条未读'));assert.match(task.text,/【行动前｜群聊】/);
});
