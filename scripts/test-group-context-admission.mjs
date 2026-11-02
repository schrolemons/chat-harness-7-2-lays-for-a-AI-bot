import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {createPlugin as factsPlugin} from '../plugins/qq-components/ctx-memory-profile-facts/index.js';
import {createPlugin as replyPlugin} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
import {createOutboundTransport} from '../src/outbound-context.js';

const quoted='[引用 小甲：有人最近在跟我说你的坏话。]谁👀';
test('memory candidate cannot reveal new text before full admission; admitted evidence preserves quotes',()=>{
 let state={};const p=factsPlugin({config:{},state:{get:()=>state,set:v=>state={...state,...v}},addPromptBlock(){}});
 const msg={key:'group:456',userId:'789',sender:'乙',text:'谁👀',messageId:'101',at:Date.now()};
 p.hooks.onIncoming(msg);
 assert.equal(p.hooks.beforePrompt({key:msg.key,reason:'replyCheck',st:{unread:[msg]}}),'');
 const full={...msg,seq:1,text:quoted,plain:'谁👀'};
 const text=p.hooks.beforePrompt({key:msg.key,reason:'replyCheck',admittedMessages:[full]});
 assert.match(text,/有人最近在跟我说你的坏话/);assert.match(text,/谁👀/);
});
async function fixture(t,reason='replyCheck',key='group:456'){
 const h=await bridgeHarness({config:{sendDelayMs:0},files:{
  'state/plugins/config/life-wake-reasons.json':{curfewEnabled:false},
  'state/plugins/config/ctx-chat-reply-shape.json':{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0}
 }});h.setMode('reserved2');const st=h.getSocialV2State(key);st.bootstrapSent=true;
 const sid=await h.ensureSession(key);await h.deliverPrompt(key,'synthetic turn',{wakeReason:reason});
 h.bot.getMessage=async id=>({message_id:id,group_id:456,user_id:789,sender:{nickname:'乙',user_id:789},message:[{type:'text',data:{text:'谁👀'}}]});
 await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/start',data:{turn:1}}}});
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await h.close();});
 const request=async(route,body,agent=true)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+route,{method:body?'POST':'GET',headers:{'x-console-token':'fixture-console-token',...(body?{'content-type':'application/json'}:{}),...(agent?{'x-agent-token':st.agentToken,'x-agent-call':'1'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 const append=()=>h.appendSocialV2Message(key,'乙',quoted,'谁👀',false,false,'101',[],'789');
 return {h,key,sid,st,request,append};
}
test('running group cannot reply through either send entrance until complete incoming body is read',async t=>{
 const {h,key,sid,st,request,append}=await fixture(t);append();
 h.pluginHost.emitIncoming({key,userId:'789',sender:'乙',text:'谁👀',messageId:'101'});
 const fresh=h.taskCaps.refreshContextModules({key,sessionId:sid,scene:'replyCheck',moduleIds:['ctx-memory-profile-facts','ctx-memory-context','ctx-context-dynamics']});
 assert.ok(!JSON.stringify(fresh.modules).includes('谁👀'),'unadmitted raw text must not leak through dynamic components');
 for(const [route,body]of [['/api/socialV2/send-message',{key,messages:'premature generic'}],['/api/send/reply',{groupId:'456',replyToMessageId:'101',message:'premature quote',token:st.agentToken}]]){
  const r=await request(route,body);assert.equal(r.body.ok,false);assert.match(r.body.error,/message_context_pending/);
 }
 assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).successful,0);
 const read=await request('/api/socialV2/unread?key='+encodeURIComponent(key));
 assert.equal(read.body.ok,true);assert.ok(JSON.stringify(read.body).includes('有人最近在跟我说你的坏话'));
 const admitted=h.taskCaps.refreshContextModules({key,sessionId:sid,scene:'replyCheck',moduleIds:['ctx-memory-profile-facts']});
 assert.ok(JSON.stringify(admitted.modules).includes('有人最近在跟我说你的坏话'));
 const sent=await request('/api/send/reply',{groupId:'456',replyToMessageId:'101',message:'接住引用中的问题',token:st.agentToken});
 assert.equal(sent.body.ok,true,JSON.stringify(sent.body));
});

test('memoryWrite on a private session refuses its own legacy private send entrance',async t=>{
 const {st,request}=await fixture(t,'memoryWrite','private:123');
 const r=await request('/api/send/private',{userId:'123',message:'memory cannot speak',token:st.agentToken});
 assert.equal(r.body.ok,false);assert.match(r.body.error,/maintenance_send_forbidden/);
});

test('a newly arrived body during send delay cancels the reserved send without consuming quota',async()=>{
 let state={},incomplete=false,sends=0;
 const svc=replyPlugin({config:{},state:{get:()=>state,set:s=>state={...state,...s}},isPluginEnabled:()=>false}).services.replyPlan;
 const transport=createOutboundTransport({callService:(s,m,p)=>s==='replyPlan'?svc[m]?.(p):null,contextFacts:()=>({pending:[{seq:2,required:true,complete:!incomplete}]}),sleep:async()=>{incomplete=true;}});
 const key='group:456',plan=svc.resolve({key,turnId:'delay',incomingText:'',autonomousSource:{id:'actual-delay-admission',kind:'directMessage'}});
 const context=transport.capture({key,envelope:{key,actionId:'delay',reason:'replyCheck',replyPlan:plan},agent:true,origin:'conversation'});
 await transport.perform({key,context,text:'first',send:async()=>({message_id:1})});
 await assert.rejects(transport.perform({key,context,text:'delayed',requestedDelay:5000,send:async()=>{sends++;return {message_id:1};}}),/message_context_pending/);
 assert.equal(sends,0);assert.equal(svc.preview({key}).inflight,0);assert.equal(svc.preview({key}).successful,1);
});

test('an unresolved quote cannot authorize reply; detail recovery must return its antecedent first',async t=>{
 const {h,key,st,request}=await fixture(t);h.socialV2.paused=true;
 h.bot.getMessage=async()=>null;
 await h.handleIncoming('group',456,{message_id:202,user_id:789,self_id:9,sender:{nickname:'乙'},message:[{type:'reply',data:{id:'303'}},{type:'text',data:{text:'谁👀'}}]},h.cfg);
 h.socialV2.paused=false;
 await request('/api/socialV2/unread?key='+encodeURIComponent(key));
 let r=await request('/api/socialV2/send-message',{key,messages:'must not guess the missing quote'});
 assert.equal(r.body.ok,false);assert.match(r.body.error,/message_context_pending/);
 h.bot.getMessage=async id=>({message_id:id,group_id:456,user_id:789,sender:{nickname:'甲',user_id:789},message:id===202?[{type:'reply',data:{id:'303'}},{type:'text',data:{text:'谁👀'}}]:[{type:'text',data:{text:'有人最近在跟我说你的坏话'}}]});
 const detail=await request('/api/socialV2/message-detail?key='+encodeURIComponent(key)+'&messageId=202');
 assert.match(detail.body.info.text,/有人最近在跟我说你的坏话/);assert.equal(detail.body.info.textTruncated,false);
 assert.match(detail.body.info.text,/QQ 789/,'quote identity must retain the actual QQ, not only its potentially shared nickname');
 assert.ok(st.unread.find(m=>m.messageId==='202').text.includes('有人最近'));
});
test('a queued later wake cannot grant its new input to an older still-running turn',async t=>{
 const {h,key,request,append}=await fixture(t);append();
 await h.deliverPrompt(key,'new input queued behind current turn',{wakeReason:'message'});
 const r=await request('/api/socialV2/send-message',{key,messages:'old turn must not use later packet'});
 assert.equal(r.body.ok,false);assert.match(r.body.error,/message_context_pending/);
});
test('memoryWrite refuses generic and legacy/private sends, but operator send remains available',async t=>{
 const {h,key,request,st}=await fixture(t,'memoryWrite');
 for(const [route,body]of [['/api/socialV2/send-message',{key,messages:'leak'}],['/api/send/group',{groupId:'456',message:'leak',token:st.agentToken}],['/api/send/private',{userId:'123',message:'cross session leak',token:st.agentToken}]]){
  const r=await request(route,body);assert.equal(r.body.ok,false);assert.match(r.body.error,/maintenance_send_forbidden|agent token 无效/);
 }
 assert.equal(h.pluginHost.callService('replyPlan','preview',{key}).successful,0);
 const operator=await h.sendToQQ(key,'explicit console operation',{origin:'operator',wakeOrigin:null,conversationReply:false});
 assert.equal(operator,true);
});
test('memory-only policy is enforced before quota reservations for every physical media kind',async()=>{
 let state={};const svc=replyPlugin({config:{},state:{get:()=>state,set:s=>state={...state,...s}},isPluginEnabled:()=>false}).services.replyPlan;
 const transport=createOutboundTransport({callService:(s,m,p)=>s==='replyPlan'?svc[m]?.(p):null});
 const key='private:123',plan=svc.resolve({key,turnId:'memory',incomingText:''});
 const context=transport.capture({key,envelope:{key,actionId:'memory',reason:'memoryWrite',replyPlan:plan},agent:true,origin:'conversation'});
 let sends=0;for(const kind of ['text','image','sticker','voice','poke','file'])await assert.rejects(transport.perform({key,context,kind,text:'not allowed',send:async()=>{sends++;return {message_id:1};}}),/maintenance_send_forbidden/);
 assert.equal(sends,0);assert.equal(svc.preview({key}).inflight,0);
});
test('a clipped wake excerpt never authorizes replying until a full body including quote is read',async t=>{
 const {h,key,sid,st,request}=await fixture(t);
 const body='[引用 小甲：'+ '完整引用依据'.repeat(65)+'。]'+ '正文'.repeat(120);
 h.appendSocialV2Message(key,'乙',body,'正文'.repeat(120),false,false,'102',[],'789');
 assert.equal(st.unread.at(-1).text,body,'bridge must retain the original rather than an unmarked 200-char preview');
 await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}}});
 h.cfg.socialV2.context.wakePendingMessageMaxChars=40;
 await h.deliverPrompt(key,'clipped synthetic window',{wakeReason:'message'});
 await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/start',data:{turn:2}}}});
 let r=await request('/api/socialV2/send-message',{key,messages:'incomplete reply'});
 assert.equal(r.body.ok,false);assert.match(r.body.error,/message_context_pending/);
 const detail=await request('/api/socialV2/message-detail?key='+encodeURIComponent(key)+'&messageId=102');
 assert.equal(detail.body.info.text,body);assert.equal(detail.body.info.textTruncated,false);
 r=await request('/api/socialV2/send-message',{key,messages:'full context is now available'});assert.equal(r.body.ok,true,JSON.stringify(r.body));
});

test('a wake with no inline message window must read pending input before replying',async t=>{
 const {h,key,sid,request,append}=await fixture(t);append();
 await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}}});
 h.cfg.socialV2.context.inlineWakeMessages=false;
 await h.deliverPrompt(key,'no body inline',{wakeReason:'message'});
 await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/start',data:{turn:2}}}});
 const r=await request('/api/socialV2/send-message',{key,messages:'no hidden backlog bypass'});
 assert.equal(r.body.ok,false);assert.match(r.body.error,/message_context_pending/);
});

test('a complete initial snapshot permits an ordinary reply without a redundant tool read',async t=>{
 const {h,key,sid,request,append}=await fixture(t);append();
 await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}}});
 await h.deliverPrompt(key,'full body inline',{wakeReason:'message'});
 await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/start',data:{turn:2}}}});
 const r=await request('/api/socialV2/send-message',{key,messages:'ordinary complete reply'});
 assert.equal(r.body.ok,true,JSON.stringify(r.body));
});

test('legacy 200-character previews require gateway recovery and do not become complete on a failed lookup',async t=>{
 const {h,key,st,request}=await fixture(t);
 const msg=h.appendSocialV2Message(key,'乙','旧'.repeat(200),'旧'.repeat(200),false,false,'204',[],'789');
 delete msg.bodyComplete;delete msg.unresolvedReplyIds;
 await request('/api/socialV2/unread?key='+encodeURIComponent(key));
 h.bot.getMessage=async()=>null;
 let detail=await request('/api/socialV2/message-detail?key='+encodeURIComponent(key)+'&messageId=204');
 assert.equal(detail.body.info.textTruncated,true);
 let r=await request('/api/socialV2/send-message',{key,messages:'legacy body still incomplete'});
 assert.equal(r.body.ok,false);assert.match(r.body.error,/message_context_pending/);
 h.bot.getMessage=async id=>({message_id:id,group_id:456,user_id:789,message:[{type:'text',data:{text:'旧'.repeat(240)+'完整结尾'}}]});
 detail=await request('/api/socialV2/message-detail?key='+encodeURIComponent(key)+'&messageId=204');
 assert.equal(detail.body.info.textTruncated,false);assert.match(detail.body.info.text,/完整结尾/);
 assert.match(st.unread.at(-1).text,/完整结尾/);
 r=await request('/api/socialV2/send-message',{key,messages:'recovered original available'});assert.equal(r.body.ok,true,JSON.stringify(r.body));
});

test('a gateway reply with a different message ID never supplies a quote or admits a pending body',async t=>{
 const {h,key,request}=await fixture(t);h.socialV2.paused=true;
 h.bot.getMessage=async()=>({message_id:999,group_id:456,user_id:789,message:[{type:'text',data:{text:'wrong original'}}]});
 await h.handleIncoming('group',456,{message_id:205,user_id:789,self_id:9,sender:{nickname:'乙'},message:[{type:'reply',data:{id:'304'}},{type:'text',data:{text:'谁'}}]},h.cfg);
 h.socialV2.paused=false;
 const read=await request('/api/socialV2/unread?key='+encodeURIComponent(key));
 assert.ok(!JSON.stringify(read.body).includes('wrong original'));
 const r=await request('/api/socialV2/send-message',{key,messages:'must not answer from an unrelated quote'});
 assert.equal(r.body.ok,false);assert.match(r.body.error,/message_context_pending/);
});
