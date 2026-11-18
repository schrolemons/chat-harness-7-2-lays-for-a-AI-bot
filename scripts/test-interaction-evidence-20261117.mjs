import test from 'node:test';import assert from 'node:assert/strict';import {createPlugin} from '../plugins/qq-components/ctx-context-session/index.js';
import {bridgeHarness,fixtureReplyTurn} from './audit-bridge-harness.mjs';
const key='group:456',now=Date.now(),poke={seq:1388,messageId:'poke',userId:'10010',sender:'示例成员丙',kind:'poke',poke:{targetIsSelf:true},text:'[拍一拍] 示例成员丙 戳了戳 你',seenAt:now,time:now},stone={seq:1393,messageId:'word',userId:'10009',sender:'示例成员甲',text:'菜',seenAt:now,time:now+1};
function fixture(rows=[poke,stone]){const blocks=[],st={recentMessages:structuredClone(rows),unread:structuredClone(rows)},plugin=createPlugin({config:{},addPromptBlock:x=>blocks.push(x)});plugin.hooks.beforePrompt({key,st,selfId:'999'});return {st,blocks,validate:args=>plugin.services.interactionEvidence.validateReply({key,kind:'text',...args})};}
test('an ordinary text or punctuation cannot support an assertion that someone just poked the bot',()=>{
 const f=fixture();assert.equal(f.validate({sourceSeqs:[1393],text:'示例成员甲用户又戳AI助手啦，接住～'}).ok,false);assert.equal(f.validate({sourceSeqs:[],text:'示例成员甲用户这一拍，AI助手收到啦～'}).ok,false);
});
test('a genuine selected poke permits one acknowledgement with its actual actor',()=>{
 const f=fixture();assert.equal(f.validate({sourceSeqs:[1388],text:'示例成员丙用户这一戳，AI助手收到啦～',successful:0}).ok,true);assert.equal(f.validate({sourceSeqs:[1388],text:'示例成员甲用户这一拍，AI助手收到啦～'}).ok,false);assert.equal(f.validate({sourceSeqs:[1388],text:'示例成员丙用户又戳AI助手啦，接住～',successful:1}).ok,false);
});
test('receipt completion is observed through live state and forbids a later new-poke claim',()=>{
 const f=fixture();for(const list of [f.st.recentMessages,f.st.unread])list.find(m=>m.seq===1388).repliedAt=now+2;assert.equal(f.validate({sourceSeqs:[1388],text:'示例成员丙用户又戳AI助手啦～'}).ok,false);
});
test('ordinary affection, invitations and textual roleplay retain their natural meaning',()=>{
 const f=fixture([...[],{...stone,text:'摸摸AI助手'}]);for(const text of ['蹭蹭用户～','用户可以伸手戳戳AI助手的耳朵～','石子用户要不要来戳戳AI助手呀？'])assert.equal(f.validate({sourceSeqs:[1393],text}).ok,true);assert.equal(f.validate({sourceSeqs:[1393],text:'用户拍拍AI助手，AI助手靠过来啦～'}).ok,true);
});
test('the interaction snapshot identifies the actual sender instead of only listing anonymous seqs',()=>{
 const f=fixture(),text=f.blocks.join('\n');assert.match(text,/10010/);assert.match(text,/示例成员丙/);assert.match(text,/拍一拍来源/);
});
test('the actual bridge send route rejects the false poke before QQ and permits a relevant reply',async t=>{
 const h=await bridgeHarness({config:{sendDelayMs:0},files:{'state/plugins/config/ctx-chat-reply-shape.json':{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0}}});let server;t.after(async()=>{if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}await h.close();});
 h.setMode('reserved2');const k='private:123';h.appendSocialV2Message(k,'示例成员甲','菜','菜',false,false,'word',[],'123',[],undefined,false,{bodyComplete:true});await fixtureReplyTurn(h,k);const st=h.getSocialV2State(k);server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const send=async messages=>{const r=await fetch(base+'/api/socialV2/send-message',{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-token':st.agentToken},body:JSON.stringify({key:k,messages})});return r.json();};
 const read=await fetch(base+'/api/socialV2/unread?key='+k,{headers:{'x-console-token':'fixture-console-token','x-agent-token':st.agentToken}});assert.equal(read.status,200);
 const bad=await send('示例成员甲用户又戳AI助手啦，接住～');assert.match(JSON.stringify(bad),/poke_reply_without_new_event/);assert.equal(h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,0);const good=await send('唔，这次没接好呀。');assert.equal(good.sent,1,JSON.stringify(good));assert.equal(h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,1);
});
