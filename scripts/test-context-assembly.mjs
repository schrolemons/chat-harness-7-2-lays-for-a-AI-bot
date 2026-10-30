import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolicy, compileModules } from '../plugins/qq-components/obs-context-assembly/policy.mjs';
import { encodePacket, decodePacket, redact } from '../plugins/qq-components/obs-context-assembly/packet.mjs';
import { slimLegacyText, planHistoryReplacements } from '../plugins/qq-components/obs-context-assembly/history.mjs';

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
 assert.deepEqual(out.selected.map(x=>x.id),['delivery-rules']);assert.match(out.modules[0].reason,/重复/);
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
test('legacy bridge wrappers retain user snapshots, not repeated rules; plain user text stays',()=>{
 const original='角色\n【会话令牌】secret\n【唤醒】private:1\n规则\n【本次消息快照】\n'+JSON.stringify({messages:[{seq:1,text:'你好',sender:'甲'}],recent:[]})+'\n【逐条看完，别只回最后一条】重复规则';
 const slim=slimLegacyText(original);
 assert.ok(slim.includes('你好')); assert.ok(!slim.includes('重复规则')); assert.ok(!slim.includes('secret'));
 assert.equal(slimLegacyText('用户引用【本次消息快照】问我意思'),null);
});
test('surface replacement preserves raw events, every user quote and tool pairs',()=>{
 const events=[{seq:1,type:'user/message',data:{id:'u',content:[{type:'text',text:'【会话令牌】x\n【唤醒】group:1\n【本次消息快照】\n{"messages":[{"text":"真实用户文字"}]}\n【逐条看完，别只回最后一条】规则'}]}},
 {seq:2,type:'assistant/message',data:{id:'a',toolCalls:[{id:'t'}]}},{seq:3,type:'tool/result',data:{toolCallId:'t'}}];
 const before=JSON.stringify(events), ops=planHistoryReplacements(events,[1,2,3]);
 assert.equal(JSON.stringify(events),before); assert.equal(ops.length,1);
 assert.equal(ops[0].message.id,'u'); assert.deepEqual(ops[0].sourceEventSeqs,[1]);
 assert.ok(ops[0].message.content[0].text.includes('真实用户文字'));
});
