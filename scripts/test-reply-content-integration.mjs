import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {createGamesRuntime} from '../plugins/qq-components/tool-games/games-runtime.mjs';
async function open(t,{texts=['这幅画很好看','今天天气不错','这首歌很有趣'],rate=0,extraFiles={},extraConfig={},globals,groupMembers}={}){
 const h=await bridgeHarness({config:{sendDelayMs:0,...extraConfig},globals,groupMembers,files:{'state/plugins/config/life-wake-reasons.json':{curfewEnabled:false},'state/plugins/config/ctx-chat-reply-shape.json':{maxMessagesNormal:3,maxMessagesCasual:3,maxMessagesSerious:3,maxSendPerMinute:rate,maxSendPerHour:rate,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},...extraFiles}});
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
test('quoted multipart reply sends both bubbles for one credit, and a new group defers intact',async t=>{
 const {h,key,messages,request}=await open(t,{rate:1});
 const declared=await request('/api/socialV2/reply-contents',{key,groups:messages.map(m=>({seqs:[m.seq],kind:'chat'}))});
 assert.equal(declared.status,200,JSON.stringify(declared.body));
 const sent=await request('/api/socialV2/send-message',{key,replyToMessageId:'101',messages:['这幅画的色彩很舒服','构图也很好看']});
 assert.equal(sent.body.sent,2,JSON.stringify(sent.body));
 const next=await request('/api/socialV2/send-message',{key,messages:['另一个回答','这一条也应暂缓']},declared.body.contents[1].id);
 assert.equal(next.status,429,JSON.stringify(next.body));
 assert.equal(typeof next.body.nextAt,'number');
 assert.match(next.body.error,/minute_limit|hour_limit/);
 assert.equal(h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,2);
 const preview=h.pluginHost.callService('replyPlan','preview',{key});
 assert.equal(preview.successful,2);
 assert.equal(preview.minute,1);
 assert.equal(preview.hour,1);
});
test('concurrent multipart requests sharing content never send a truncated second group',async t=>{
 let startSend, finishSend;
 const started=new Promise(resolve=>{startSend=resolve;});
 const held=new Promise(resolve=>{finishSend=resolve;});
 let sends=0;
 const {key,messages,request}=await open(t,{globals:{fetch:async url=>{
  if(/send_private_msg$/.test(String(url))&&++sends===1){startSend();await held;}
  return {ok:true,status:200,json:async()=>({status:'ok',retcode:0,data:{}})};
 }}});
 const declaration=await request('/api/socialV2/reply-contents',{key,groups:[{seqs:[messages[0].seq],kind:'chat'}]});
 const id=declaration.body.contents[0].id;
 const send=messages=>request('/api/socialV2/send-message',{key,messages},id);
 const first=send(['第一组甲','第一组乙']);
 await started;
 const second=send(['第二组甲','第二组乙']);
 try{await new Promise(resolve=>setTimeout(resolve,100));}finally{finishSend();}
 assert.equal((await first).body.sent,2);
 const rejected=await second;
 assert.equal(rejected.status,429,JSON.stringify(rejected.body));
 assert.equal(sends,2);
});
test('bridge lets the admitted reply group finish across its local hard cap while new groups stay silent',async t=>{
 const key='private:123';
 const {h,sid,messages,request}=await open(t,{extraFiles:{'state/plugins/config/life-token-budget.json':{sessions:{[key]:{hardLimitYuan:0.1}}}}});
 const declared=await request('/api/socialV2/reply-contents',{key,groups:messages.map(m=>({seqs:[m.seq],kind:'chat'}))});
 assert.equal(declared.status,200,JSON.stringify(declared.body));
 const send=(i,message)=>request('/api/socialV2/send-message',{key,messages:message},declared.body.contents[i].id);
 assert.equal((await send(0,'第一条内容')).body.sent,1);
 h.tokenLedger.ingestEvent({sessionId:sid,at:Date.now(),model:'deepseek-flash',event:{type:'assistant/message',seq:1,data:{turn:1,step:1,usage:{inputTokens:1000000,outputTokens:100}}}});
 assert.equal(h.tokenBudgetOf(key).stage,'silent');
 const continuation=await send(0,'同组第二条内容');
 assert.equal(continuation.body.sent,1,JSON.stringify(continuation.body));
 assert.equal((await send(1,'这个新组应拦截')).status,403);
 assert.equal(h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,2);
});
test('an uncertain first bubble is retained and stops automatic delivery of later bubbles',async t=>{
 let attempts=0;
 const {h,key,messages,request}=await open(t,{globals:{fetch:async url=>{
  if(/send_private_msg$/.test(String(url))){attempts++;throw Error('fixture transport timeout');}
  return {ok:true,status:200,json:async()=>({status:'ok',retcode:0,data:{}})};
 }}});
 const declared=await request('/api/socialV2/reply-contents',{key,groups:messages.map(m=>({seqs:[m.seq],kind:'chat'}))});
 const contentId=declared.body.contents[0].id;
 const send=payload=>request('/api/socialV2/send-message',{key,messages:payload},contentId);
 assert.match((await send(['first bubble','later bubble'])).body.error,/fixture transport timeout/);
 assert.match((await send('first bubble')).body.error,/duplicate_delivery/);
 assert.equal(attempts,1);
 const preview=h.pluginHost.callService('replyPlan','preview',{key});
 assert.equal(preview.successful,0);
 assert.equal(preview.inflight,1);
 assert.equal(preview.minute,1);
});
test('mixed task operations require a selected paid group and cannot consume a second credit for its report',async t=>{
 const {h,key,messages,request}=await open(t,{texts:['帮我查看任务报告','帮我整理工作记录','今天很开心'],rate:1});
 const read=await request('/api/socialV2/schedules',{key,action:'list'});assert.equal(read.body.ok,true);
 const write={key,action:'add',title:'隔离测试日程',dueAt:Date.now()+3600000};
 const denied=await request('/api/socialV2/schedules',write);assert.equal(denied.status,409);assert.match(denied.body.error,/task_group_not_admitted/);
 const undeclaredReceipt=await request('/api/socialV2/receipt-report',{key,receipts:[{seq:messages[1].seq,status:'replied'}]});assert.equal(undeclaredReceipt.status,409);assert.equal(undeclaredReceipt.body.error,'task_group_pending');
 const declared=await request('/api/socialV2/reply-contents',{key,groups:messages.map((m,i)=>({seqs:[m.seq],kind:i<2?'task':'chat'}))});
 assert.equal(declared.body.ok,true,JSON.stringify(declared.body));assert.equal(declared.body.deferred.length,1);assert.match(declared.body.deferredDetail[0].reason,/minute_limit|hour_limit/);assert.ok(declared.body.deferredDetail[0].nextAt>Date.now());
 const [paid,waiting,chat]=declared.body.contents;assert.equal(paid.taskExempt,true);assert.equal(waiting.taskPending,true);
 const repeated=await request('/api/socialV2/reply-contents',{key,groups:messages.map((m,i)=>({seqs:[m.seq],kind:i<2?'task':'chat'}))});assert.equal(repeated.body.ok,true);
 for(const id of [waiting.id,chat.id,'content:forged'])assert.equal((await request('/api/socialV2/schedules',write,id)).status,409);
 const allowed=await request('/api/socialV2/schedules',write,paid.id);assert.equal(allowed.body.ok,true,JSON.stringify(allowed.body));
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

test('an admitted private relay carries the source task to its one named destination',async t=>{
 const {h,key,st,messages,request}=await open(t,{texts:['去私聊测试朋友说声晚安'],extraConfig:{allow:{private:['123','12001','12002'],groups:['456']},socialV2:{relayAliases:{测试:'private:12002',测试朋友:'private:12001'}}}});
 const declared=await request('/api/socialV2/reply-contents',{key,groups:[{seqs:[messages[0].seq],kind:'task'}]});
 const content=declared.body.contents?.[0];assert.equal(content?.taskExempt,true,JSON.stringify(declared.body));
 const send=(userId,contentId)=>request('/api/send/private',{userId,token:st.agentToken,message:'晚安'},contentId);
 const missing=await send('12001');assert.equal(missing.body.code,'CROSS_SESSION_TASK_REQUIRED',JSON.stringify(missing));
 const other=await send('12002',content.id);assert.equal(other.body.code,'CROSS_SESSION_TARGET_MISMATCH',JSON.stringify(other));
 const sent=await send('12001',content.id);assert.equal(sent.body.sent,1,JSON.stringify(sent.body));
 assert.match((await send('12001',content.id)).body.error,/duplicate_delivery/);
 assert.equal(h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,1);
});

test('a scheduled QQ task persists its original authority and sends only to its named target',async t=>{
 const now=new Date(), dueAt=Math.floor(now.getTime()/60000)*60000+120000;
 const due=new Date(dueAt);
 const instruction='请'+(now.getDate()===due.getDate()?'今天':'明天')+String(due.getHours()).padStart(2,'0')+':'+String(due.getMinutes()).padStart(2,'0')+'去私聊测试朋友说声晚安';
 const {h,key,messages,request}=await open(t,{texts:[instruction],extraConfig:{allow:{private:['123','12001','12002']},socialV2:{relayAliases:{测试朋友:'private:12001'}}}});
 const declared=await request('/api/socialV2/reply-contents',{key,groups:[{seqs:[messages[0].seq],kind:'task'}]});
 const content=declared.body.contents?.[0];
 assert.equal(content?.taskExempt,true,JSON.stringify(declared.body));
 const add=(targetKey,when=dueAt)=>request('/api/socialV2/schedules',{action:'add',key,targetKey,message:'晚安，早点休息',title:'验收一次性联系',dueAt:when},content.id);
 const legacy=await request('/api/socialV2/schedules',{action:'add',key,title:'缺目标的旧调用',dueAt},content.id);
 assert.equal(legacy.status,409,JSON.stringify(legacy.body));
 assert.equal(legacy.body.code,'SCHEDULE_DESTINATION_REQUIRED');
 const denied=await add('private:12002');
 assert.equal(denied.status,409,JSON.stringify(denied.body));
 assert.equal((await add('private:12001',dueAt+60000)).status,409);
 const added=await add('private:12001');
 assert.equal(added.body.ok,true,JSON.stringify(added.body));
 assert.equal(added.body.item.targetKey,'private:12001');
 assert.equal((await add('private:12001')).body.item.id,added.body.item.id,'retry preserves one scheduled item');
 assert.doesNotMatch(JSON.stringify(added.body),new RegExp(instruction));
 const filename=path.join(h.temp,'state','plugins','life-schedule-reminder.json');
 const saved=JSON.parse(await fs.readFile(filename,'utf8')).items.find(item=>item.id===added.body.item.id);
 assert.deepEqual(saved.authorization,{taskId:content.id,sourceKey:key,targetKey:'private:12001',instructions:[{text:instruction,receivedAt:messages[0].time}]});
 const sent=()=>h.calls.sent.filter(x=>x.text.includes('晚安，早点休息'));
 assert.equal(sent().length,0);
 await h.pluginHost.reload('life-schedule-reminder');
 await h.pluginHost.tick(dueAt-1);
 assert.equal(sent().length,0);
 h.cfg.allow.private=['123','12002'];
 await h.pluginHost.tick(dueAt);
 assert.equal(sent().length,0,'revoked whitelist blocks the due send');
 h.cfg.allow.private=['123','12001','12002'];
 await h.pluginHost.tick(dueAt+1);
 await h.pluginHost.tick(dueAt+2);
 assert.equal(sent().length,1);
 assert.equal(sent()[0].id,12001);
 const listed=await request('/api/socialV2/schedules',{action:'list',key,includePast:true});
 assert.equal(listed.body.items.find(item=>item.id===added.body.item.id)?.deliveryStatus,'sent');
});

test('a colloquial scheduled contact can be admitted without authorizing a guessed destination or time',async t=>{
 const text='测试朋友今天开会，心情不好，十点半后，你去说两句，哄他一下';
 const {h,key,messages,request}=await open(t,{texts:[text],extraConfig:{allow:{private:['123','12001']},socialV2:{relayAliases:{测试朋友:'private:12001'}}}});
 const declared=await request('/api/socialV2/reply-contents',{key,groups:[{seqs:[messages[0].seq],kind:'task'}]});
 const content=declared.body.contents?.[0];
 assert.equal(content?.taskExempt,true,JSON.stringify(declared.body));
 const body={action:'add',key,title:'测试联系',dueAt:Date.now()+120000};
 assert.equal((await request('/api/socialV2/schedules',body,content.id)).body.code,'SCHEDULE_DESTINATION_REQUIRED');
 const guessed=await request('/api/socialV2/schedules',{...body,targetKey:'private:12001',message:'先歇一会儿'},content.id);
 assert.equal(guessed.status,409);
 assert.equal(guessed.body.code,'SCHEDULE_TARGET_NOT_AUTHORIZED');
 assert.match(guessed.body.error,/先澄清/);
 assert.equal(h.calls.sent.length,0);
});

test('a newer unread message does not block a bound reply to an earlier complete source',async t=>{
 const {h,key,messages,request}=await open(t,{texts:['先前的完整问题']});
 const declared=await request('/api/socialV2/reply-contents',{key,groups:[{seqs:[messages[0].seq],kind:'chat'}]});
 const content=declared.body.contents?.[0];assert.ok(content);
 h.appendSocialV2Message(key,'甲','之后的未读消息','之后的未读消息',false,true,'999',[],'123',[],undefined,false,{bodyComplete:true});
 const sent=await request('/api/socialV2/send-message',{key,messages:'回答上一条'},content.id);
 assert.equal(sent.body.sent,1,JSON.stringify(sent.body));
});

test('a Spark performance carries the originating task ID through the cross-session send',async t=>{
 const {h,key,st,messages,request}=await open(t,{texts:['去私聊电一电测试朋友'],extraConfig:{allow:{private:['123','12001','12002']},socialV2:{relayAliases:{测试朋友:'private:12001'}}}});
 const declared=await request('/api/socialV2/reply-contents',{key,groups:[{seqs:[messages[0].seq],kind:'task'}]});
 const content=declared.body.contents?.[0];
 assert.equal(content?.taskExempt,true,JSON.stringify(declared.body));
 assert.equal(h.getSocialV2State('private:12001').unread.length,0);
 const game=createGamesRuntime({registryFile:path.join(h.temp,'state','spark-fixture.json')});
 const session=game.start({gameId:'spark'});
 assert.equal(session.ok,true);
 const performance=game.action({sessionId:session.sessionId,action:'spark',payload:{bodyPart:'手腕',durationSec:3,waveform:'pulse'}});
 assert.equal(performance.ok,true,JSON.stringify(performance));
 const send=(target,contentId)=>request('/api/send/private',{userId:target,token:st.agentToken,message:performance.message},contentId);
 const omitted=await send('12001');
 assert.equal(omitted.body.code,'CROSS_SESSION_TASK_REQUIRED',JSON.stringify(omitted.body));
 assert.match(omitted.body.error,/发起私聊.*contentId.*收件人无需先来信/);
 assert.equal((await send('12002',content.id)).body.code,'CROSS_SESSION_TARGET_MISMATCH');
 assert.equal(h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,0);
 assert.equal((await send('12001',content.id)).body.sent,1);
 assert.equal(h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,1);
});

test('an explicit game invitation is a task scoped to its named recipient',async t=>{
 const {h,key,st,messages,request}=await open(t,{texts:['请邀请测试朋友一起玩猜谜'],extraConfig:{allow:{private:['123','12001','12002']},socialV2:{relayAliases:{测试朋友:'private:12001',另一个人:'private:12002'}}}});
 const declared=await request('/api/socialV2/reply-contents',{key,groups:[{seqs:[messages[0].seq],kind:'task'}]});
 const content=declared.body.contents?.[0];
 assert.equal(content?.taskExempt,true,JSON.stringify(declared.body));
 const send=target=>request('/api/send/private',{userId:target,token:st.agentToken,message:'要一起玩猜谜吗？'},content.id);
 const wrong=await send('12002');
 assert.equal(wrong.body.code,'CROSS_SESSION_TARGET_MISMATCH',JSON.stringify(wrong));
 assert.equal((await send('12001')).body.sent,1);
 assert.equal(h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,1);
});

test('separate paid source tasks may send text and a private poke in one turn',async t=>{
 const {h,key,st,messages,request}=await open(t,{texts:['去私聊测试朋友说声晚安','去私聊戳一下另一朋友'],extraConfig:{allow:{private:['123','12001','12002'],groups:['456']},socialV2:{relayAliases:{测试朋友:'private:12001',另一朋友:'private:12002'}}}});
 const declared=await request('/api/socialV2/reply-contents',{key,groups:messages.map(m=>({seqs:[m.seq],kind:'task'}))});
 assert.ok(declared.body.contents?.every(c=>c.taskExempt),JSON.stringify(declared.body));
 const [relay,poke]=declared.body.contents;
 assert.equal((await request('/api/send/private',{userId:'12001',token:st.agentToken,message:'晚安'},relay.id)).body.sent,1);
 const sendPoke=(target,id)=>request('/api/socialV2/send-poke',{key:'private:'+target},id);
 assert.equal((await sendPoke('12002',relay.id)).body.ok,false);
 assert.equal((await sendPoke('12001',poke.id)).body.ok,false);
 const result=await sendPoke('12002',poke.id);assert.equal(result.body.ok,true,JSON.stringify(result.body));
 assert.equal((await sendPoke('12002',poke.id)).body.ok,false);
 assert.equal(h.calls.http.filter(c=>/send_poke$/.test(c.url)).length,1);
});

test('cross-session group poke requires one confirmed group and the named member',async t=>{
 const {h,key,messages,request}=await open(t,{texts:['去群聊电一电测试群友'],groupMembers:[{user_id:12001,nickname:'测试群友'}],extraConfig:{allow:{private:['123'],groups:['456','457']}}});
 await h.pluginHost.callTool('alias_add',{alias:'测试群友',qq:'12001',sourceKeys:['group:456']});
 const r=await request('/api/socialV2/reply-contents',{key,groups:[{seqs:[messages[0].seq],kind:'task'}]});
 const task=r.body.contents?.[0];assert.equal(task?.taskExempt,true,JSON.stringify(r.body));
 const poke=(group,user)=>request('/api/socialV2/send-poke',{key:'group:'+group,targetUserId:user},task.id);
 assert.equal((await poke('457','12001')).body.ok,false);
 assert.equal((await poke('456','12002')).body.ok,false);
 const ok=await poke('456','12001');assert.equal(ok.body.ok,true,JSON.stringify(ok.body));
 assert.equal((await poke('456','12001')).body.ok,false);
 await h.pluginHost.callTool('alias_add',{alias:'测试群友',qq:'12001',sourceKeys:['group:456','group:457']});
 assert.equal((await poke('456','12001')).body.code,'CROSS_SESSION_TARGET_MISMATCH');
 assert.equal(h.calls.http.filter(c=>/group_poke$/.test(c.url)).length,1);
});
