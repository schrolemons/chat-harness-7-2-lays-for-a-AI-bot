import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeContextLimits,validateContextLimits,contextMessageExcerpt} from '../src/bridge-core/context-limits.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
test('message-count and length settings validate one shared set of bounds',()=>{
 const limits=normalizeContextLimits({recentLimit:100,unreadLimit:40,wakeRecentLimit:4,wakeMessageLimit:16,wakeMaxChars:8000});
 assert.equal(limits.unreadLimit,40);assert.equal(limits.wakeMessageLimit,16);assert.equal(limits.wakeHistoryMessageMaxChars,0);
 assert.equal(validateContextLimits({wakeRecentLimit:101}).ok,false);assert.equal(validateContextLimits({wakePendingMessageMaxChars:-1}).ok,false);assert.equal(validateContextLimits({recentLimit:1.5}).ok,false);
 assert.equal(validateContextLimits({wakeHistoryMessageMaxChars:0,weakWakeMaxChars:1800}).ok,true);
});
test('the real snapshot limits pending/history separately, includes bot history and preserves stored originals',async()=>{
 const h=await bridgeHarness({config:{socialV2:{doubleStamp:{enabled:false},context:{recentLimit:100,unreadLimit:40,wakeMessageLimit:2,wakeRecentLimit:1,wakePendingMessageMaxChars:9,wakeHistoryMessageMaxChars:6,wakeMaxChars:8000}}}});try{
  h.setMode('reserved2');const key='private:123',st=h.getSocialV2State(key);
  h.appendSocialV2Message(key,'人','用户原文'.repeat(30),'用户原文'.repeat(30),false,false,'one');
  const bot={seq:++st.lastUnreadSeq,isSelf:true,sender:'bot',text:'小鲸鱼回复'.repeat(20),time:Date.now()};st.recentMessages.push(bot);
  const snapshot=h.buildWakeSnapshotV2(key);assert.equal(snapshot.messages.length,1);assert.equal(snapshot.messages[0].truncated,true);assert.equal(snapshot.messages[0].suppliedChars,9);assert.equal(snapshot.recent.length,1);assert.equal(snapshot.recent[0].isSelf,true);assert.equal(snapshot.recent[0].suppliedChars,6);
  assert.equal(bot.text,'小鲸鱼回复'.repeat(20));assert.equal(st.unread[0].text,'用户原文'.repeat(30));assert(!st.unread[0].seenAt);assert(!st.unread[0].repliedAt);assert(JSON.stringify(snapshot).length<=8000);
 }finally{await h.close();}
});
test('weak budget keeps private/group-at/group-ordinary windows separately without forging receipt stamps',async()=>{
 const h=await bridgeHarness({config:{socialV2:{context:{recentLimit:100,unreadLimit:40}}}});try{
  h.setMode('reserved2');h.pluginHost.setConfig('life-token-budget',{recoveryWindows:{privateMessages:2,groupMessages:1,groupAtMessages:2}});await h.pluginHost.reload('life-token-budget');
  const call=h.pluginHost.callService.bind(h.pluginHost);h.pluginHost.callService=(service,method,input)=>service==='tokenBudget'&&method==='assess'?{stage:'weak',exempt:false,periodStart:1}:call(service,method,input);
  const key='group:456',st=h.getSocialV2State(key),append=(text,atSelf)=>h.appendSocialV2Message(key,'人',text,text,false,false,text,[],'123',[],undefined,atSelf);
  const old=append('旧@',true);old.seenAt=1000;append('新@',true);for(let i=0;i<12;i++)append('普通'+i,false);
  assert.deepEqual(Array.from(st.unread,m=>m.text),['旧@','新@','普通11']);assert.equal(old.seenAt,1000);assert(!old.repliedAt);assert(st.unread.every(m=>!m.repliedAt));
  const p='private:123';for(let i=0;i<4;i++)h.appendSocialV2Message(p,'人','私聊'+i,'私聊'+i,false,false,'p'+i);assert.equal(h.getSocialV2State(p).unread.length,2);
 }finally{await h.close();}
});
test('real Console API validates window bounds and round-trips per-message character settings',async()=>{
 const h=await bridgeHarness({config:{consoleToken:'fixture-context-admin'}});let server;try{
  server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/api/socialV2/config',headers={'content-type':'application/json','x-console-token':'fixture-context-admin'};
  const invalid=await fetch(url,{method:'POST',headers,body:JSON.stringify({context:{wakeRecentLimit:101}})});assert.equal(invalid.status,400);
  const valid=await fetch(url,{method:'POST',headers,body:JSON.stringify({context:{wakeHistoryMessageMaxChars:14,wakePendingMessageMaxChars:19,weakWakeMaxChars:1500}})});assert.equal(valid.status,200);const data=await fetch(url,{headers}).then(r=>r.json());assert.equal(data.config.context.wakeHistoryMessageMaxChars,14);assert.equal(data.config.context.wakePendingMessageMaxChars,19);assert.equal(data.config.context.weakWakeMaxChars,1500);
 }finally{server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));await h.close();}
});
test('automatic excerpts keep Unicode intact, mark omissions, preserve metadata and never mutate originals',()=>{
 const original={seq:4,messageId:'fixture-id',isSelf:true,text:'甲乙😀丁戊己庚辛壬癸',plain:'引用原文：一二三四五',tail:'尾部问题',receiptState:'complete'},before=JSON.stringify(original);
 const excerpt=contextMessageExcerpt(original,8);assert.equal(JSON.stringify(original),before);assert.equal(excerpt.seq,4);assert.equal(excerpt.isSelf,true);assert.equal(excerpt.receiptState,'complete');assert.equal(excerpt.truncated,true);assert.equal(Array.from(excerpt.plain||excerpt.text).length,8);
 assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(excerpt.plain||excerpt.text));assert.deepEqual(contextMessageExcerpt(original,0),original);
});
