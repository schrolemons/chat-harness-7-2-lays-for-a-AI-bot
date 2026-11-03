import test from 'node:test';import assert from 'node:assert/strict';
import {processingEntries} from '../console/layers/O/context-processing.js';
import {requestEntries} from '../console/layers/O/context-inspector.js';
import {receiptStateView} from '../src/bridge-core/receipt-index.mjs';
import {pendingMessagesV2} from '../src/bridge-core/receipt-state.js';
import {bridgeHarness,fixtureReplyTurn} from './audit-bridge-harness.mjs';
import {validateContextSend} from '../plugins/qq-components/ctx-chat-reply-shape/context-send-policy.mjs';
const dialogue=rows=>({role:'user',source:'qq-context-dialogue',text:'【新增 QQ 消息数据】\n'+JSON.stringify(rows)});
const snapshot=value=>({role:'user',source:'qq-context-latest',contextSegments:[{id:'message-snapshot',text:'【QQ 收件状态】\n'+JSON.stringify(value)}]});
const project=messages=>{const request={key:'group:456',messages};return processingEntries(request,requestEntries(request));};

test('148 formerly pending records split into 109 retained historical rows and 39 current pending rows',()=>{
 const old=Array.from({length:109},(_,i)=>({seq:1001+i,dialogueSeq:600+i,text:'old '+i,receiptState:'seen'}));
 const recent=Array.from({length:39},(_,i)=>({seq:1111+i,dialogueSeq:800+i,text:'recent '+i,receiptState:'seen'}));
 const messages=[dialogue([...old,...recent]),snapshot({unreadCount:40,pendingFromSeq:1111,partial:true,receipts:[{seq:1111,seenAt:1}]})],before=JSON.stringify(messages),view=project(messages);
 assert.equal(view.counts.pending,39);assert.equal(view.counts.completed,109);
 assert.equal(view.bySeq.get(1001).region,'history');assert.equal(view.bySeq.get(1001).receiptState,'seen');assert.match(view.bySeq.get(1001).stateLabel,/当时已读未回复/);
 assert.equal(view.bySeq.get(1001).record.repliedAt,undefined);assert.equal(JSON.stringify(messages),before);
});

test('latest explicit queue membership supersedes historical snapshots without changing receipt facts',()=>{
 const view=project([dialogue([{seq:1,text:'context only',receiptState:'seen'},{seq:2,text:'current',receiptState:'seen'}]),snapshot({pendingSeqs:[1,2],queueObservedThroughSeq:2,receipts:[]}),snapshot({pendingSeqs:[2],queueObservedThroughSeq:2,unreadCount:1,receipts:[]})]);
 assert.equal(view.bySeq.get(1).region,'history');assert.equal(view.bySeq.get(2).region,'arrivals');assert.equal(view.bySeq.get(1).receiptState,'seen');
 const empty=project([dialogue([{seq:1,text:'retained',receiptState:'seen'}]),snapshot({pendingSeqs:[],queueObservedThroughSeq:1,unreadCount:0,receipts:[]})]);assert.equal(empty.counts.pending,0);
});

test('receipt metadata counts current reply eligibility separately from stored history',()=>{
 const state={lastUnreadSeq:2,unread:[{seq:1,replyDisposition:'history',seenAt:1},{seq:2}],recentMessages:[]},view=receiptStateView(state);
 assert.equal(view.unreadCount,1);assert.equal(view.bufferedUnreadCount,2);assert.deepEqual(view.pendingSeqs,[2]);assert.equal(view.queueObservedThroughSeq,2);
});

async function httpFixture(run){const h=await bridgeHarness();let server;try{
 h.setMode('reserved2');const key='group:456',st=h.getSocialV2State(key),old=await h.ensureSession(key);
 server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 const call=async(route,body,agent=true)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+route+'?key='+encodeURIComponent(key),{method:body===undefined?'GET':'POST',headers:{'x-console-token':'fixture-console-token',...(agent?{'x-agent-token':st.agentToken}:{}),...(body?.contentId?{'x-reply-content-id':body.contentId}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify({key,...body})})});return {status:r.status,data:await r.json()};};
 const append=text=>h.appendSocialV2Message(key,'peer',text,text,false,false,text,[],'124',[],undefined,false,{bodyComplete:true});
 await run({h,key,st,old,call,append});
}finally{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await h.close();}}

test('group context receipt closes reply eligibility while keeping a true read stamp and no reply stamp',()=>httpFixture(async({h,key,st,call,append})=>{
 append('unrelated group topic');await fixtureReplyTurn(h,key);assert.equal((await call('/api/socialV2/unread')).status,200);
 const result=await call('/api/socialV2/receipt-report',{receipts:[{seq:1,status:'context',note:'群友之间的话题，不参与'}]});
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(pendingMessagesV2(st).length,0);assert(st.unread[0].seenAt>0);assert.equal(st.unread[0].repliedAt,undefined);assert.equal(h.calls.sent.length,0);
}));

test('unawakened group input becomes optional context without either receipt stamp',async()=>{
 const h=await bridgeHarness();try{
 h.setMode('reserved2');const key='group:456',st=h.getSocialV2State(key),row=h.appendSocialV2Message(key,'peer','chat among others','chat among others',false,false,'x');
 h.pluginHost.callService('historyContext','classifyIncoming',{key,message:row,wakeAccepted:false});
 assert.equal(pendingMessagesV2(st).length,0);assert.equal(row.replyDisposition,'history');assert.equal(row.seenAt,undefined);assert.equal(row.repliedAt,undefined);
 const direct=h.appendSocialV2Message(key,'peer','new request','new request',false,false,'y');h.pluginHost.callService('historyContext','classifyIncoming',{key,message:direct,wakeAccepted:true,requiresResponse:true});assert.deepEqual(Array.from(pendingMessagesV2(st),m=>m.messageId),['y']);
 }finally{await h.close();}
});

test('only explicitly required group input in the receipt window enters the ordered reply queue',async()=>{
 const h=await bridgeHarness({config:{socialV2:{doubleStamp:{windowCount:1}}}});try{
 h.setMode('reserved2');const key='group:456',st=h.getSocialV2State(key),first=h.appendSocialV2Message(key,'peer','ask bot','ask bot',false,false,'a');
 h.pluginHost.callService('historyContext','classifyIncoming',{key,state:st,message:first,wakeAccepted:true,requiresResponse:true,windowSeqs:[1]});
 h.pluginHost.callService('historyContext','beginWake',{key,state:st,triggerSeq:first.seq});
 const ordinary=h.appendSocialV2Message(key,'peer','among others','among others',false,false,'b');h.pluginHost.callService('historyContext','classifyIncoming',{key,state:st,message:ordinary,wakeAccepted:true,requiresResponse:false,windowSeqs:[1,2]});
 assert.deepEqual(Array.from(pendingMessagesV2(st),m=>m.messageId),['a']);assert.equal(first.replyRequirement,'required');assert.equal(ordinary.replyRequirement,'optional');
 const third=h.appendSocialV2Message(key,'peer','new bot request','new bot request',false,false,'c');h.pluginHost.callService('historyContext','classifyIncoming',{key,state:st,message:third,wakeAccepted:true,requiresResponse:true,windowSeqs:[2,3]});assert.deepEqual(Array.from(pendingMessagesV2(st),m=>m.messageId),['c']);assert.equal(first.repliedAt,undefined);
 }finally{await h.close();}
});

test('ordered required replies cannot skip an older required item, while optional context remains free',()=>{
 const facts={agent:true,requiredSeqs:[5,7],pending:[]};
 assert.equal(validateContextSend({...facts,selectedSeqs:[7]}).ok,false);assert.equal(validateContextSend({...facts,requiredSeqs:[5,6,7],selectedSeqs:[5,7]}).ok,false);assert.equal(validateContextSend({...facts,selectedSeqs:[5]}).ok,true);assert.equal(validateContextSend({...facts,selectedSeqs:[2]}).ok,true);
});

test('first accepted trigger stays the input; optional arrivals never occupy or evict required window slots',async()=>{
 const h=await bridgeHarness({config:{socialV2:{doubleStamp:{windowCount:2},context:{unreadLimit:4}}}});try{
 h.setMode('reserved2');const key='group:456',st=h.getSocialV2State(key);
 const add=(id,required)=>{const m=h.appendSocialV2Message(key,'peer',id,id,required,false,id);h.pluginHost.callService('historyContext','classifyIncoming',{key,state:st,message:m,wakeAccepted:true,requiresResponse:required});return m;};
 const first=add('A',true);h.scheduleWakeV2(key,'atMention');const wake=h.pluginHost.callService('historyContext','beginWake',{key,state:st,triggerSeq:first.seq});assert.equal(wake.triggerMessage.messageId,'A');assert.deepEqual(Array.from(st.doubleStampCheck.windowSeqs),[]);
 for(let i=0;i<50;i++)add('free'+i,false);
 assert.equal(h.pluginHost.callService('historyContext','beginWake',{key,state:st,triggerSeq:st.lastUnreadSeq}).triggerMessage.messageId,'A');assert.deepEqual(Array.from(st.doubleStampCheck.windowSeqs),[first.seq]);assert(st.unread.some(m=>m.seq===first.seq));
 const second=add('C',true);assert.deepEqual(Array.from(st.doubleStampCheck.windowSeqs),[first.seq,second.seq]);add('free-again',false);assert.deepEqual(Array.from(st.doubleStampCheck.windowSeqs),[first.seq,second.seq]);
 const third=add('E',true);assert.deepEqual(Array.from(st.doubleStampCheck.windowSeqs),[second.seq,third.seq]);assert.equal(first.replyDisposition,'history');assert.equal(first.repliedAt,undefined);
 }finally{await h.close();}
});

test('all new private input remains required across a wake; probability-waking ordinary group input is optional',async()=>{
 const h=await bridgeHarness();try{
 h.setMode('reserved2');const key='private:123',st=h.getSocialV2State(key);for(let i=0;i<8;i++){const m=h.appendSocialV2Message(key,'peer','new'+i,'new'+i,false,false,String(i));h.pluginHost.callService('historyContext','classifyIncoming',{key,state:st,message:m,wakeAccepted:false});}
 h.pluginHost.callService('historyContext','beginWake',{key,state:st,triggerSeq:1});assert.equal(pendingMessagesV2(st).length,8);assert(st.unread.every(m=>m.replyRequirement==='required'));
 const group=h.getSocialV2State('group:456'),m=h.appendSocialV2Message('group:456','peer','ordinary','ordinary',false,false,'g');h.pluginHost.callService('historyContext','classifyIncoming',{key:'group:456',state:group,message:m,wakeAccepted:true,requiresResponse:false});h.pluginHost.callService('historyContext','beginWake',{key:'group:456',state:group,triggerSeq:m.seq});assert.equal(m.replyRequirement,'optional');assert.equal(pendingMessagesV2(group).length,0);
 }finally{await h.close();}
});

test('real send entrance rejects a newer required quote and refuses context-discard of a required message',()=>httpFixture(async({h,key,st,call,append})=>{
 append('1001');append('1002');for(const row of st.unread)row.replyRequirement='required';
 await fixtureReplyTurn(h,key);await call('/api/socialV2/unread');
 const declaration=await call('/api/socialV2/reply-contents',{groups:[{seqs:[1],kind:'chat'},{seqs:[2],kind:'chat'}]});assert.equal(declaration.status,200,JSON.stringify(declaration.data));
 const contents=declaration.data.contents;assert.equal(contents.length,2);
 const denied=await call('/api/send/reply',{groupId:'456',replyToMessageId:'1002',message:'jump to second',contentId:contents[1].id,token:st.agentToken});assert.equal(denied.data.ok,false);assert.match(denied.data.error,/required_reply_order/);assert.equal(h.calls.sent.length,0);
 const discard=await call('/api/socialV2/receipt-report',{receipts:[{seq:1,status:'context',note:'不想回应'}]});assert.equal(discard.status,409);assert.equal(st.unread[0].replyDisposition,undefined);
 const first=await call('/api/send/reply',{groupId:'456',replyToMessageId:'1001',message:'answer first',contentId:contents[0].id,token:st.agentToken});assert.equal(first.data.ok,true,JSON.stringify(first.data));assert.deepEqual(Array.from(st.receiptSendPendingSeqs),[1]);
 const second=await call('/api/send/reply',{groupId:'456',replyToMessageId:'1002',message:'answer second',contentId:contents[1].id,token:st.agentToken});assert.equal(second.data.ok,true,JSON.stringify(second.data));assert.deepEqual(Array.from(st.receiptSendPendingSeqs),[1,2]);
}));

test('one successful quoted send can answer required A and its optional subsequent supplement B without stamping unrelated C',()=>httpFixture(async({h,key,st,call,append})=>{
 const a=append('1001'),b=append('1002'),c=append('1003');a.replyRequirement='required';for(const m of [b,c]){m.replyRequirement='optional';m.replyDisposition='history';}
 st.unread=st.unread.filter(m=>m.seq!==b.seq); // B survives as uncompressed recent history.
 await fixtureReplyTurn(h,key);await call('/api/socialV2/recent');
 const declaration=await call('/api/socialV2/reply-contents',{groups:[{seqs:[1,2],kind:'chat'}]});assert.equal(declaration.status,200,JSON.stringify(declaration.data));
 const sent=await call('/api/send/reply',{groupId:'456',replyToMessageId:'1001',message:'combined answer to A and B',contentId:declaration.data.contents[0].id,token:st.agentToken});assert.equal(sent.data.ok,true,JSON.stringify(sent.data));assert.equal(h.calls.http.filter(r=>/send_group_msg|send_msg/.test(r.url)).length,1);assert.deepEqual(Array.from(st.receiptSendPendingSeqs),[1,2]);
 const report=await call('/api/socialV2/receipt-report',{receipts:[{seq:1,status:'replied'},{seq:2,status:'replied'}]});assert.equal(report.status,200,JSON.stringify(report.data));assert(a.repliedAt>0);assert(b.repliedAt>0);assert.equal(c.repliedAt,undefined);assert.equal(c.replyRequirement,'optional');
}));

test('a missing local historical message never falls back to a QQ detail API',async()=>{
 let attempted=0;const h=await bridgeHarness({globals:{SnowLumaWebSocketClient:class{async getMessage(){attempted++;throw Error('QQ lookup forbidden');}}}});try{
 h.setMode('reserved2');h.taskCaps.readLocalConversationHistory=()=>({ok:true,messages:[]});
 const info=await h.resolveReplyInfo('group',456,'7654321',999,{force:true});assert.equal(info,null);assert.equal(attempted,0);assert.equal(h.calls.http.length,0);
 }finally{await h.close();}
});

test('preserving session recreation archives only the old model session and protects concurrent fresh input',()=>httpFixture(async({h,key,st,old,call,append})=>{
 append('old group context');h.pluginHost.callService('historyContext','beginWake',{key,state:st,triggerSeq:1});st.mood=73;st.pendingReminder={id:'keep'};const stop=h.api.stopSessionWork;
 h.api.stopSessionWork=async sid=>{await stop(sid);append('fresh during reset');};
 const result=await call('/api/session/reset',{preserveState:true,recreate:true,reclassifyHistory:true,expectedSessionId:old},false);
 assert.equal(result.status,200,JSON.stringify(result.data));assert(result.data.sessionId);assert.notEqual(result.data.sessionId,old);assert.equal(h.state.sessions[key],result.data.sessionId);assert.equal(h.getSocialV2State(key),st);
 assert.equal(st.mood,73);assert.equal(st.replyWindowOpen,false);assert.equal(st.pendingReminder.id,'keep');assert.deepEqual(Array.from(pendingMessagesV2(st),m=>m.messageId),['fresh during reset']);assert.equal(st.recentMessages[0].repliedAt,undefined);assert.equal(h.calls.prompts.length,0);assert.equal(h.calls.sent.length,0);
}));

 test('cold input window is shown as optional incoming; separately read historical rows stay in history',()=>{
 const rows=[1,8,9].map(seq=>({seq,text:'body '+seq,replyDisposition:'history',replyRequirement:'optional',seenAt:1}));const view=project([dialogue(rows),snapshot({pendingSeqs:[],inputSeqs:[8,9],queueObservedThroughSeq:9,unreadCount:0,receipts:[]})]);assert.equal(view.bySeq.get(1).region,'history');for(const seq of [8,9]){assert.equal(view.bySeq.get(seq).region,'arrivals');assert.match(view.bySeq.get(seq).stateLabel,/自由回应/);assert.equal(view.bySeq.get(seq).record.repliedAt,undefined);}
 });
