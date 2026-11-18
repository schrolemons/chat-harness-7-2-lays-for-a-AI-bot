import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness,fixtureReplyTurn} from './audit-bridge-harness.mjs';
import {createReplyContentCarrier} from '../src/mcp-content-carrier.mjs';
import {splitMessageSnapshot} from '../plugins/qq-components/obs-context-assembly/message-snapshot.mjs';

async function fixture(t){
 const h=await bridgeHarness({config:{consoleToken:'console-test-token',socialV2:{wait:{minMs:100,maxMs:2000,minQuietAfterNewMs:0}}}});
 h.setMode('reserved2');const key='group:456',sid=await fixtureReplyTurn(h,key),st=h.getSocialV2State(key);
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 t.after(async()=>{server.closeAllConnections?.();await new Promise(r=>server.close(r));await h.close();});
 const request=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+route,{method:body?'POST':'GET',headers:{'x-console-token':'console-test-token','x-agent-token':st.agentToken,'content-type':'application/json'},...(body?{body:JSON.stringify({key,...body})}:{})});return {status:r.status,body:await r.json()};};
 const append=(text,id)=>h.appendSocialV2Message(key,'群友',text,text,false,false,id,[],'789',[],undefined,true,{bodyComplete:true});
 return {h,key,sid,st,request,append};
}

test('message arriving before wait and becoming admitted during wait returns immediately, not after 180 seconds',async t=>{
 const {request,append}=await fixture(t),m=append('怎么疼爱你呀','before-wait');m.replyRequirement='required';m.quotaAdmission='pending';
 const pending=request('/api/socialV2/wait',{purpose:'messages',timeoutMs:1500});
 setTimeout(()=>{m.quotaAdmission='admitted';},60);
 const r=await pending;assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.arrived,true);assert(r.body.waitedMs<500,JSON.stringify(r.body));assert.equal(r.body.newMessages.at(-1).messageId,'before-wait');
});

test('already arrived unread content is returned by wait instead of an extra error/read model round',async t=>{
 const {request,append}=await fixture(t);append('已经在这里的完整提问','already-arrived').replyRequirement='required';
 const r=await request('/api/socialV2/wait',{purpose:'messages',timeoutMs:1500});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.arrived,true);assert(r.body.waitedMs<300);assert.equal(r.body.newMessages[0].messageId,'already-arrived');
});

test('fresh ordinary group input reaches a running waiter promptly while remaining optional',async t=>{
 const {h,key,st,request,append}=await fixture(t);
 const waiting=request('/api/socialV2/wait',{purpose:'messages',timeoutMs:1500});
 const deadline=Date.now()+3000;while(!h.activeWaits.has(key)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert(h.activeWaits.has(key));
 const incoming=append('校门口有人在遛很大的橘猫','ordinary-fresh');
 h.pluginHost.callService('historyContext','classifyIncoming',{key,state:st,message:incoming,wakeAccepted:true,requiresResponse:false});
 const start=Date.now(),r=await waiting;assert.equal(r.status,200,JSON.stringify(r.body));assert(Date.now()-start<300,'optional input must not wait for another @ or timeout');
 assert.equal(r.body.arrived,true);assert.equal(r.body.newMessages[0].messageId,'ordinary-fresh');assert.equal(r.body.newMessages[0].replyRequirement,'optional');assert(incoming.seenAt>0);assert.equal(incoming.repliedAt,undefined);
 const choice=await request('/api/socialV2/receipt-report',{receipts:[{seq:incoming.seq,status:'context',note:'已理解群友之间的新话题，本轮不参与'}]});assert.equal(choice.status,200,JSON.stringify(choice.body));assert.equal(incoming.replyDisposition,'history');assert.equal(incoming.repliedAt,undefined);assert.equal(h.calls.sent.length,0,'visibility is not mandatory QQ speech');
});

test('wait does not pour retired history back into a fresh incoming batch when the old cursor is behind',async t=>{
 const {st,request,append}=await fixture(t);
 for(let i=0;i<32;i++){const m=append('历史聊天正文'.repeat(20),'history-'+i);m.replyDisposition='history';m.seenAt=Date.now()-3600000;}
 st.lastReadThroughSeq=0;
 const fresh=append('现在才发来的@提问','latest-question');fresh.replyRequirement='required';fresh.quotaAdmission='pending';
 const pending=request('/api/socialV2/wait',{purpose:'messages',timeoutMs:1500});setTimeout(()=>{fresh.quotaAdmission='admitted';},60);
 const r=await pending;assert.equal(r.status,200,JSON.stringify(r.body));assert(r.body.waitedMs<500);assert.deepEqual(r.body.newMessages.map(m=>m.messageId),['latest-question']);assert.equal(r.body.readThroughSeq,fresh.seq);assert.equal(st.recentMessages[0].text,'历史聊天正文'.repeat(20));
});

test('waiting for a new message is refused after reading a pending question, while quiet counts time already elapsed',async t=>{
 const {st,key,request,append}=await fixture(t);append('先接住这条提问','read-question').replyRequirement='required';
 await request('/api/socialV2/unread?key='+encodeURIComponent(key));
 const waiting=await request('/api/socialV2/wait',{purpose:'messages',timeoutMs:1500});assert.equal(waiting.status,409);assert.match(waiting.body.nextAction,/reply/);
 st.lastIncomingAt=Date.now()-3000;
 const quiet=await request('/api/socialV2/wait',{purpose:'reply',timeoutMs:1000,quietMs:200});assert.equal(quiet.status,200,JSON.stringify(quiet.body));assert.equal(quiet.body.quiet,true);assert(quiet.body.waitedMs<100,'model reading time must count towards silence');
});

test('a hole from retired receipts does not pin the displayed cursor before newer seen messages',async t=>{
 const {st,key,request}=await fixture(t);const old={seq:1,messageId:'old',text:'历史',isSelf:false,seenAt:10,replyDisposition:'history'};
 st.unread=[old];st.recentMessages=[old,{seq:3,messageId:'latest',text:'新提问',isSelf:false,bodyComplete:true,time:Date.now()}];st.lastUnreadSeq=3;st.lastReadThroughSeq=1;
 const r=await request('/api/socialV2/recent?key='+encodeURIComponent(key));assert.equal(r.status,200);assert.equal(r.body.readThroughSeq,3,'missing seq2 has no retained body to read; seq3 was actually handed over');
 const mark=await request('/api/socialV2/mark-read',{throughSeq:r.body.readThroughSeq});assert.equal(mark.status,200,JSON.stringify(mark.body));
 const unseen={seq:4,messageId:'not-shown',text:'不能越过',isSelf:false};st.unread.push(unseen);st.lastUnreadSeq=5;
 const forged=await request('/api/socialV2/mark-read',{throughSeq:5});assert.equal(forged.status,400,'a still-buffered unseen message must remain protected');assert.equal(unseen.seenAt,undefined);
});

test('quoted group reply can perform the same verified source declaration without a second model step',async()=>{
 let calls=0,received;
 const carrier=createReplyContentCarrier({declareContents:async input=>{calls++;return {ok:true,contents:[{key:input.key,id:'content:actual',kind:'chat',seqs:[1286],taskPending:false}]};}});
 const decorated=carrier.decorate('qq_reply',['reply',{},async input=>{received={id:input.contentId,header:carrier.headers({}).get('x-reply-content-id')};}]);
 assert(decorated[1].sourceSeqs);await decorated[2]({groupId:'456',messageId:'-1989277917',token:'fixture',sourceSeqs:[1286]});assert.equal(calls,1);assert.deepEqual(received,{id:'content:actual',header:'content:actual'});
});

test('receipt index avoids repeating sender and text metadata while raw dialogue remains lossless',()=>{
 const original={messages:Array.from({length:40},(_,i)=>({seq:i+1,messageId:String(i),time:1000+i,userId:'789',sender:'群友',text:'完整原话'+i,seenAt:1001,replyDisposition:'history',replyDispositionReason:'old-cache',replyDispositionAt:1001,replyRequirement:'optional',isSelf:false})),recent:[]};
 const result=splitMessageSnapshot(original),body=JSON.parse(result.backgroundText.split('\n').slice(1).join('\n'));
 assert.equal(result.records.length,40);assert.equal(result.records[1].text,'完整原话1');assert.equal(body.receipts[0].seenAt,1001);assert.equal(body.receipts[0].seq,1);assert.equal(body.receipts[0].replyDisposition,'history');assert.equal(body.receipts[0].sender,undefined);assert(result.backgroundText.length<JSON.stringify(original).length*.65);
});
