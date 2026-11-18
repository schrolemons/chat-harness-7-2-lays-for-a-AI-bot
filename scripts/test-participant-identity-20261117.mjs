import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-context-session/index.js';
const key='group:456',id='10008',selfId='99999';
const row=(userId,sender,seq)=>({userId,sender,seq,messageId:String(seq),isSelf:false,text:'看看报错'});
const raw=(userId,nickname,card,messageId,extra={})=>({group_id:'456',self_id:selfId,message_type:'group',user_id:userId,message_id:String(messageId),sender:{nickname,card},...extra});
function render({rows=[],aliases=[],history=[],disabled=false,keyOverride=key}={}){
 const blocks=[];let reads=0;
 createPlugin({config:{disabledBlocks:disabled?['identity']:[]},addPromptBlock:t=>blocks.push(t),capabilities:{readLocalConversationHistory:()=>{reads++;return {ok:true,messages:history};}},callService:(service,method)=>service==='aliases'&&method==='injectionPreview'?{selected:aliases}:null}).hooks.beforePrompt({key:keyOverride,selfId,st:{recentMessages:rows,unread:[]}});
 const line=blocks.find(x=>x.startsWith('【本会话人物身份'));
 return {facts:line?JSON.parse(line.split('\n')[1]):[],text:blocks.join('\n'),reads};
}
test('one QQ unifies its current card, platform nickname, previous display and confirmed alias',()=>{
 const out=render({rows:[row(id,'示例成员乙',1),row(id,'示例成员乙（气气！）',2)],history:[raw(id,'示例昵称','示例成员乙（气气！）',2)],aliases:[{alias:'示例昵称',qq:id,status:'confirmed',appliesHere:true}]});
 assert.equal(out.facts.length,1);assert.equal(out.facts[0].userId,id);assert.deepEqual(new Set(out.facts[0].names),new Set(['示例成员乙','示例成员乙（气气！）','示例昵称']));assert.match(out.text,/同一人/);assert.match(out.text,/不能.*和.*两个人/);
});
test('matching display names never merge distinct QQ identities or infer prefix aliases',()=>{
 const out=render({rows:[row(id,'同名猫',1),row('12345','同名猫',2),row('67890','同名猫的朋友',3)]});
 assert.equal(out.facts.length,3);assert(out.facts.find(x=>x.userId===id).ambiguousNames.includes('同名猫'));assert.equal(out.facts.find(x=>x.userId==='67890').names.length,1);
});
test('candidate, out-of-scope, wrong-account, wrong-group and mismatched-message evidence is excluded',()=>{
 const out=render({rows:[row(id,'示例成员乙',1)],aliases:[{alias:'猜测称呼',qq:id,status:'candidate',appliesHere:true},{alias:'外群私称',qq:id,status:'confirmed',appliesHere:false}],history:[raw(id,'错误账号','',1,{self_id:'88888'}),raw(id,'错误群','',1,{group_id:'789'}),raw('12345','错误发话人','',1),raw(id,'未展示消息','',2)]});
 assert.deepEqual(out.facts[0].names,['示例成员乙']);assert.doesNotMatch(JSON.stringify(out.facts),/错误|私称|猜测|未展示/);
});
test('self-generated statements and body text cannot manufacture a person or identity alias',()=>{
 const out=render({rows:[row(id,'真昵称',1),{...row('12345','我',2),isSelf:true,text:'假昵称和真昵称是两个人'},{...row('67890','另一个人',3),text:'我就是示例昵称（10008）'}]});
 assert.equal(out.facts.length,2);assert.deepEqual(out.facts.find(x=>x.userId==='67890').names,['另一个人']);
});
test('identity disabled and private scope do not expand group identity data',()=>{
 assert.equal(render({rows:[row(id,'猫',1)],disabled:true}).facts.length,0);
 assert.equal(render({rows:[row(id,'猫',1)],keyOverride:'private:'+id}).facts.length,0);
});
test('proactive summaries retain scoped confirmed identities even after the person leaves the recent window',()=>{
 const out=render({rows:[row('12345','另一个群友',7)],aliases:[{alias:'示例成员乙',qq:id,status:'confirmed',appliesHere:true},{alias:'示例昵称',qq:id,status:'confirmed',appliesHere:true}]});
 const person=out.facts.filter(x=>x.userId===id);assert.equal(person.length,1);assert.deepEqual(person[0].names,['示例成员乙','示例昵称']);assert.equal(person[0].recentSpeaker,false);
});
