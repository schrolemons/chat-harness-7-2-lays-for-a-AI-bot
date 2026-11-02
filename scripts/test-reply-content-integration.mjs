import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
async function open(t,{texts=['这幅画很好看','今天天气不错','这首歌很有趣'],rate=0}={}){
 const h=await bridgeHarness({config:{sendDelayMs:0},files:{'state/plugins/config/life-wake-reasons.json':{curfewEnabled:false},'state/plugins/config/ctx-chat-reply-shape.json':{maxMessagesNormal:3,maxMessagesCasual:3,maxMessagesSerious:3,maxSendPerMinute:rate,maxSendPerHour:rate,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0}}});
 h.setMode('reserved2');const key='private:123',st=h.getSocialV2State(key);st.bootstrapSent=true;
 const messages=texts.map((text,i)=>h.appendSocialV2Message(key,'甲',text,text,false,true,String(101+i),[],'123',[],undefined,false,{bodyComplete:true}));
 const sid=await h.ensureSession(key);await h.deliverPrompt(key,'',{wakeReason:'private'});await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/start',data:{turn:1}}}});
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 t.after(async()=>{server.closeAllConnections?.();await new Promise(r=>server.close(r));await h.close();});
 const request=async(path,body,contentId)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{'x-console-token':'fixture-console-token','x-agent-token':st.agentToken,'x-agent-call':'1','content-type':'application/json',...(contentId?{'x-reply-content-id':contentId}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 return {h,key,st,sid,messages,request};
}
test('authenticated semantic declaration supports 3+3+3 sends in one actual bridge wake',async t=>{
 const {h,key,messages,request}=await open(t);
 const declared=await request('/api/socialV2/reply-contents',{key,groups:messages.map(m=>({seqs:[m.seq],kind:'chat'}))});
 assert.equal(declared.status,200,JSON.stringify(declared.body));assert.equal(declared.body.contents.length,3);
 for(const [i,content]of declared.body.contents.entries()){
  const r=await request('/api/socialV2/send-message',{key,messages:[0,1,2].map(n=>'第'+i+'份的第'+n+'段')},content.id);
  assert.equal(r.body.sent,3,JSON.stringify(r.body));
 }
 const physicalSends=()=>h.calls.http.filter(c=>/send_(?:private|group)_msg$/.test(c.url)).length;
 assert.equal(physicalSends(),9);
 const denied=await request('/api/socialV2/send-message',{key,messages:'第一份的第四段'},declared.body.contents[0].id);
 assert.equal(denied.body.ok,false);assert.equal(physicalSends(),9);
});
test('declaration cannot grant foreign, unread, or forged task content',async t=>{
 const {key,messages,request}=await open(t);
 for(const body of [{key:'private:124',groups:[{seqs:[messages[0].seq],kind:'chat'}]},{key,groups:[{seqs:[99999],kind:'chat'}]},{key,groups:[{seqs:[messages[0].seq],kind:'task'}]}]){
  const r=await request('/api/socialV2/reply-contents',body);assert.equal(r.body.ok,false);
 }
});
test('mixed task operations require a selected paid group and cannot consume a second credit for its report',async t=>{
 const {h,key,messages,request}=await open(t,{texts:['帮我查看任务报告','帮我整理工作记录','今天很开心'],rate:1});
 const denied=await request('/api/socialV2/schedules',{key,action:'list'});assert.equal(denied.body.ok,false);
 const undeclaredReceipt=await request('/api/socialV2/receipt-report',{key,receipts:[{seq:messages[1].seq,status:'replied'}]});assert.equal(undeclaredReceipt.status,409);assert.equal(undeclaredReceipt.body.error,'task_group_pending');
 const declared=await request('/api/socialV2/reply-contents',{key,groups:messages.map((m,i)=>({seqs:[m.seq],kind:i<2?'task':'chat'}))});
 assert.equal(declared.body.ok,true,JSON.stringify(declared.body));assert.equal(declared.body.deferred.length,1);
 const [paid,waiting,chat]=declared.body.contents;assert.equal(paid.taskExempt,true);assert.equal(waiting.taskPending,true);
 const repeated=await request('/api/socialV2/reply-contents',{key,groups:messages.map((m,i)=>({seqs:[m.seq],kind:i<2?'task':'chat'}))});assert.equal(repeated.body.ok,true);
 assert.equal((await request('/api/socialV2/schedules',{key,action:'list'},paid.id)).body.ok,true);
 for(const id of [waiting.id,chat.id,'content:forged'])assert.equal((await request('/api/socialV2/schedules',{key,action:'list'},id)).body.ok,false);
 const sent=await request('/api/socialV2/send-message',{key,messages:['任务进度','任务结果','完成汇报','结果附件说明']},paid.id);assert.equal(sent.body.sent,4,JSON.stringify(sent.body));
 const rejectedReceipt=await request('/api/socialV2/receipt-report',{key,receipts:[{seq:messages[1].seq,status:'replied'}]});assert.equal(rejectedReceipt.status,409);assert.equal(rejectedReceipt.body.error,'task_group_pending');
 const preview=h.pluginHost.callService('replyPlan','preview',{key});assert.equal(preview.minute,1);assert.equal(preview.hour,1);
 assert.equal((await request('/api/socialV2/send-message',{key,messages:'普通聊天仍无额度'},chat.id)).body.ok,false);
});
test('complete task fragments share one paid semantic group',async t=>{
 const {h,key,messages,request}=await open(t,{texts:['帮我创建一个','明天八点的日程提醒','晚安'],rate:1});
 const declared=await request('/api/socialV2/reply-contents',{key,groups:[{seqs:messages.slice(0,2).map(m=>m.seq),kind:'task'},{seqs:[messages[2].seq],kind:'chat'}]});
 assert.equal(declared.body.ok,true,JSON.stringify(declared.body));assert.equal(declared.body.contents[0].taskExempt,true);assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).minute,1);
});
test('a real memory maintenance turn may read and update its diary without taking a user task credit',async t=>{
 const h=await bridgeHarness();h.setMode('reserved2');const key='private:123',sid=await h.ensureSession(key);
 await h.deliverPrompt(key,'',{wakeReason:'memoryWrite'});await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/start',data:{turn:1}}}});
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections?.();await new Promise(r=>server.close(r));await h.close();});
 const headers={'x-console-token':'fixture-console-token','x-agent-token':h.getSocialV2State(key).agentToken,'x-agent-call':'1','content-type':'application/json'},base='http://127.0.0.1:'+server.address().port+'/api/socialV2/diary';
 const read=await fetch(base+'?key='+key,{headers});assert.equal(read.status,200);const diary=await read.json();
 const update=await fetch(base,{method:'POST',headers,body:JSON.stringify({key,day:diary.day,text:'maintenance diary'})});assert.equal(update.status,200);
 assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).minute,0);assert.equal(h.calls.sent.length,0);
});
