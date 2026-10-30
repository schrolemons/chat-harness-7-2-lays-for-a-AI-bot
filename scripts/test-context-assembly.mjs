import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolicy, compileModules } from '../plugins/qq-components/obs-context-assembly/policy.mjs';
import { encodePacket, decodePacket, redact } from '../plugins/qq-components/obs-context-assembly/packet.mjs';
import {frameModules} from '../plugins/qq-components/obs-context-assembly/frame.mjs';
test('generated receipt protocol enters stable data once, while the current task and QQ text stay separate',()=>{
 const protocol='【双戳窗口回查｜按消息条数】核对逐条回执。',task='【唤醒】group:1\n原因：probability';
 const input={prompt:protocol+'\n\n'+task,snapshot:{messages:[{seq:1,text:'真实用户原话'}]}};
 const rows=frameModules(input),out=compileModules(rows);
 assert.equal(out.selected.find(row=>row.id==='session-protocol').placement,'stable');
 assert.equal(out.selected.find(row=>row.id==='session-protocol').text,protocol);
 assert(!out.selected.find(row=>row.id==='wake-action').text.includes(protocol));assert(out.selected.find(row=>row.id==='wake-action').text.includes(task));
 assert.equal(out.selected.find(row=>row.id==='message-snapshot').text.includes('真实用户原话'),true);
});

const modules=[
 {id:'role-card',text:'角色设定',placement:'fixed',protected:true},
 {id:'ctx-user-mood',text:'心情当前值',source:'C'},
 {id:'tool-injection-lab',text:'未触发的弹药',source:'T'},
 {id:'wake-action',text:'只做本次任务',protected:true}
];
test('O rules reorder and mask output without mutating input or component config',()=>{
 const before=JSON.stringify(modules);
 const out=compileModules(modules,{order:['ctx-user-mood','role-card'],disabled:['ctx-user-mood']},'message');
 assert.equal(JSON.stringify(modules),before);
 assert.equal(out.modules.find(x=>x.id==='ctx-user-mood').included,false);
 assert.deepEqual(out.selected.map(x=>x.id),['role-card','tool-injection-lab','wake-action']);
 assert.ok(out.beforeChars>out.afterChars);
});
test('protected blocks cannot be disabled; fixed section precedes data',()=>{
 const out=compileModules(modules,{disabled:['role-card','wake-action'],order:['wake-action','ctx-user-mood','role-card']},'message');
 assert.equal(out.selected[0].id,'role-card');
 assert.ok(out.selected.some(x=>x.id==='wake-action'));
});
test('background bubbles omit dormant lab; explicit encounter can include it',()=>{
 assert.equal(compileModules(modules,{},'timeBubble').modules.find(x=>x.id==='tool-injection-lab').included,false);
 assert.equal(compileModules(modules,{},'message').modules.find(x=>x.id==='tool-injection-lab').included,true);
});
test('policy validation rejects duplicate order, invalid IDs and malformed toggles',()=>{
 assert.throws(()=>normalizePolicy({order:['a','a']}));
 assert.throws(()=>normalizePolicy({disabled:['../state']}));
 assert.throws(()=>normalizePolicy({disabled:'x'}));
});
test('identical same-layer modules are injected once while a protected owner is retained',()=>{
 const out=compileModules([{id:'optional',text:'同一条规则'},{id:'delivery-rules',text:'同一条规则',protected:true}],{},'message');
 assert.deepEqual(out.selected.map(x=>x.id),['delivery-rules']);assert.match(out.modules.find(row=>row.id==='optional').reason,/重复/);
});
test('signed packet is session-bound, tamper evident, readable and private in preview',()=>{
 const packet={sessionId:'s1',key:'private:1',scene:'message',modules,nonce:'n1',issuedAt:Date.now()};
 const encoded=encodePacket(packet,'secret');
 assert.equal(decodePacket(encoded,'secret','s1').key,'private:1');
 assert.equal(decodePacket(encoded,'secret','s2'),null);
 assert.equal(decodePacket(encoded.replace('心情当前值','伪造内容'),'secret','s1'),null);
 assert.equal(decodePacket('用户说：'+encoded,'secret','s1'),null);
 assert.equal(decodePacket(encoded,'wrong','s1'),null);
 assert.ok(!redact('【会话令牌】token-secret\n{"token":"token-secret"}').includes('token-secret'));
});
