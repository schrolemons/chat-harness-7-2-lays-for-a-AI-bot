import test from'node:test';import assert from'node:assert/strict';
import{createPlugin}from'../plugins/qq-components/ctx-chat-reply-shape/index.js';
import{bridgeHarness}from'./audit-bridge-harness.mjs';
test('a multi-source turn exposes actual delivered source progress even when the outer plan is unbound',()=>{
 let data={};const state={get:()=>data,set:p=>data={...data,...p}},plugin=createPlugin({state,config:{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},callService:()=>null,capabilities:{}}),r=plugin.services.replyPlan,key='group:456';
 const messages=[{seq:1,messageId:'one',text:'问题一',bodyComplete:true},{seq:2,messageId:'two',text:'不同问题',bodyComplete:true}],plan=r.resolve({key,turnId:'t1',agent:true,messages,mood:{enabled:false}});assert.equal(plan.contentId,undefined);
 const declared=r.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'chat'},{seqs:[2],kind:'chat'}]});
 const bound=r.bindContent({key,plan,contentId:declared.contents[0].id,messages}).plan;
 assert.equal(r.reserve({key,plan:bound,operationId:'send1',kind:'text',text:'第一条答案'}).ok,true);r.commit({key,operationId:'send1',deliveryId:'actual-send'});
 const text=plugin.hooks.beforePrompt({replyPlan:plan,st:{receiptSendPendingSeqs:[1]}});assert.match(text,/本回合实际答复凭据/);assert.match(text,/sourceSeqs":\[1\]/);assert.doesNotMatch(text,/sourceSeqs":\[2\]/);assert.match(text,/仍待登记回复回执的seq：\[1\]/);
 const closed=plugin.hooks.beforePrompt({replyPlan:plan,st:{receiptSendPendingSeqs:[]}});assert.match(closed,/当前没有待补的回复回执/);assert.doesNotMatch(closed,/仍待登记回复回执的seq/);assert.match(closed,/直接qq_wait_for_messages/);
 assert.equal(messages[0].repliedAt,undefined,'projection does not forge a receipt');assert.equal(r.turnProgress({plan:{...plan,turnId:'different'}}).length,0);
 assert.match(text,/其余新入站和历史消息均可自由选答/);assert.match(text,/replyRequirement=required.*按收件seq升序/);assert.match(text,/所有消息都可分点答/);assert.match(text,/不能仅凭needsReply、未读数或入栈时间扩大必答范围/);
});
test('mark-read and wake configuration report real pending count rather than the retained history buffer',async t=>{
 const h=await bridgeHarness({config:{consoleToken:'console-test-token'}});h.setMode('reserved2');const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections?.();await new Promise(r=>server.close(r));await h.close();});
 const key='group:456',st=h.getSocialV2State(key);for(let i=0;i<38;i++){const m=h.appendSocialV2Message(key,'群友','旧消息','旧消息',false,false,'old-'+i,[],'789',[],undefined,true,{bodyComplete:true});m.replyDisposition='history';}
 for(const route of['mark-read','wake-config']){const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/'+route,{method:'POST',headers:{'x-console-token':'console-test-token','Content-Type':'application/json'},body:JSON.stringify({key,throughSeq:0,config:{}})});const d=await res.json();assert.equal(res.status,200,JSON.stringify(d));assert.equal(d.pendingReplyCount,0);assert.equal(d.unreadCount,st.unread.length);assert(d.unreadCount>0);assert.equal(d.awaitingReplyCount,0);}
});
