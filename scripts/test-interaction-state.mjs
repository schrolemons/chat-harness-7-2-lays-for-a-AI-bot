import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-context-session/index.js';

const poke=(seq,time=1000)=>({seq,time,kind:'poke',poke:{targetIsSelf:true},text:'[拍一拍] 用户戳了戳你'});
function render(st,config={}){const out=[];createPlugin({config,addPromptBlock:t=>out.push(t)}).hooks.beforePrompt({key:'group:1',st});return out.join('\n');}
test('completed poke followed by @ stays one event; latest input is an ordinary message',()=>{
 const event={...poke(533),seenAt:1100,repliedAt:1200};
 const text=render({unread:[{seq:535,time:1400,plain:'@AI助手'}],recentMessages:[event,{seq:534,time:1300,text:'@AI助手 现在几点'},{seq:535,time:1400,text:'@AI助手'}]});
 assert.match(text,/最新入站seq=535，类型=消息/);assert.match(text,/未回应拍一拍seq=\[\]/);assert.match(text,/已回应拍一拍seq=\[533\]/);assert.match(text,/空@.*不是.*拍一拍/);
});
test('a fresh real poke is pending, and its receipt update changes the next prompt without another event',()=>{
 const p=poke(10);assert.match(render({recentMessages:[p],unread:[p]}),/未回应拍一拍seq=\[10\]/);
 const done={...p,seenAt:1100,repliedAt:1200};assert.match(render({recentMessages:[done],unread:[]}),/已回应拍一拍seq=\[10\]/);
});
test('same seq in two windows is deduplicated; distinct genuine pokes remain distinct',()=>{
 const a=poke(10),b=poke(11,1100),text=render({recentMessages:[a,b],unread:[a,b]});
 assert.match(text,/未回应拍一拍seq=\[10,11\]/);assert.doesNotMatch(text,/10,10/);
});
test('malformed receipts never become completed and self-generated events are excluded',()=>{
 const bad={...poke(10),seenAt:1200,repliedAt:1100},self={...poke(11,1300),isSelf:true};
 const text=render({recentMessages:[bad,self]});assert.match(text,/未回应拍一拍seq=\[10\]/);assert.doesNotMatch(text,/已回应拍一拍seq=\[10/);
});
test('status switch controls interaction facts together with existing session state',()=>{
 assert.doesNotMatch(render({recentMessages:[poke(1)]},{disabledBlocks:['status']}),/交互事件事实/);
});
