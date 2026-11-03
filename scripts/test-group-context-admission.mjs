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

test('a complete incoming body omits an unavailable quote without blocking its own reply',async t=>{
 const {h,key,st,request}=await fixture(t);h.socialV2.paused=true;
 h.bot.getMessage=async()=>null;
 await h.handleIncoming('group',456,{message_id:202,user_id:789,self_id:9,sender:{nickname:'乙'},message:[{type:'reply',data:{id:'303'}},{type:'text',data:{text:'谁👀'}}]},h.cfg);
 h.socialV2.paused=false;
 const read=await request('/api/socialV2/unread?key='+encodeURIComponent(key));
 const stored=st.unread.find(m=>m.messageId==='202');
 assert.equal(stored.text,'谁👀');assert.deepEqual(Array.from(stored.omittedReplyIds),['303']);assert.equal(stored.unresolvedReplyIds.length,0);
 assert.deepEqual(read.body.messages[0].omittedReplyIds,['303']);
 assert.deepEqual(Array.from(h.buildWakeSnapshotV2(key).messages[0].omittedReplyIds),['303']);
 const detail=await request('/api/socialV2/message-detail?key='+encodeURIComponent(key)+'&messageId=202');
 assert.deepEqual(detail.body.info.omittedReplyIds,['303']);
 assert.equal(st.unread.some(m=>m.messageId==='303'),false,'omission does not create or read the unknown historical message');
 const r=await request('/api/socialV2/send-message',{key,messages:'只回应已收到的正文'});assert.equal(r.body.ok,true,JSON.stringify(r.body));
});
test('a reliably resolved incoming quote keeps its antecedent and actual identity',async t=>{
 const {h,key,st,request}=await fixture(t);h.socialV2.paused=true;
 const fetched=[];
 h.bot.getMessage=async id=>{fetched.push(id);return {message_id:id,group_id:456,user_id:789,sender:{nickname:'甲',user_id:789},message:[{type:'reply',data:{id:'999'}},{type:'text',data:{text:'已知的引用原文'}}]};};
 await h.handleIncoming('group',456,{message_id:202,user_id:789,self_id:9,sender:{nickname:'乙'},message:[{type:'reply',data:{id:'303'}},{type:'text',data:{text:'谁👀'}}]},h.cfg);
 h.socialV2.paused=false;
 const detail=await request('/api/socialV2/message-detail?key='+encodeURIComponent(key)+'&messageId=202');
 assert.match(detail.body.info.text,/已知的引用原文/);assert.equal(detail.body.info.textTruncated,false);
 assert.match(detail.body.info.text,/QQ 789/,'quote identity must retain the actual QQ, not only its potentially shared nickname');
 assert.ok(st.unread.find(m=>m.messageId==='202').text.includes('已知的引用原文'));
 assert.equal(fetched.includes(999),false,'a known quoted body does not become pending because of its own nested reference');
});
test('detail recovery omits unavailable quote only after retrieving the full current body',async t=>{
 const {h,key,st,request}=await fixture(t);
 h.appendSocialV2Message(key,'乙','[引用消息]完整正文','完整正文',false,false,'202',[],'789',[],undefined,false,{bodyComplete:true,unresolvedReplyIds:['303']});
 h.bot.getMessage=async id=>id===202?{message_id:id,group_id:456,user_id:789,message:[{type:'reply',data:{id:'303'}},{type:'text',data:{text:'完整正文'}}]}:null;
 const detail=await request('/api/socialV2/message-detail?key='+encodeURIComponent(key)+'&messageId=202');
 assert.equal(detail.body.info.text,'完整正文');assert.equal(detail.body.info.textTruncated,false);assert.deepEqual(detail.body.info.omittedReplyIds,['303']);
 assert.equal(st.unread.at(-1).unresolvedReplyIds.length,0);
 assert.equal((await request('/api/socialV2/send-message',{key,messages:'已读取完整当前正文'})).body.ok,true);
});
test('an explicitly incomplete current body is not repaired by omitting its unknown quote',async t=>{
 const {h,key,st,request}=await fixture(t);h.socialV2.paused=true;h.bot.getMessage=async()=>null;
 await h.handleIncoming('group',456,{message_id:202,user_id:789,self_id:9,bodyComplete:false,sender:{nickname:'乙'},message:[{type:'reply',data:{id:'303'}},{type:'text',data:{text:'残缺正文'}}]},h.cfg);
 h.socialV2.paused=false;await request('/api/socialV2/unread?key='+encodeURIComponent(key));
 assert.equal(st.unread.at(-1).bodyComplete,false);
 const r=await request('/api/socialV2/send-message',{key,messages:'不能猜剩余正文'});assert.equal(r.body.ok,false);assert.match(r.body.error,/message_context_pending/);
});
test('an empty gateway detail never promotes a missing current body into complete input',async t=>{
 const {h,key,request}=await fixture(t);
 h.appendSocialV2Message(key,'乙','正文尚未取全','正文尚未取全',false,false,'202',[],'789',[],undefined,false,{bodyComplete:false});
 h.bot.getMessage=async id=>({message_id:id,group_id:456,user_id:789,message:[]});
 const detail=await request('/api/socialV2/message-detail?key='+encodeURIComponent(key)+'&messageId=202');
 assert.equal(detail.body.info.textTruncated,true);
 const r=await request('/api/socialV2/send-message',{key,messages:'不能凭空补出当前正文'});assert.equal(r.body.ok,false);assert.match(r.body.error,/message_context_pending/);
});
test('a resolvable quote alone never repairs the missing current body through detail readback',async t=>{
 const {h,key,st,request}=await fixture(t);
 h.appendSocialV2Message(key,'乙','[引用消息]','',false,false,'202',[],'789',[],undefined,false,{bodyComplete:false,unresolvedReplyIds:['303']});
 h.bot.getMessage=async id=>({message_id:id,group_id:456,user_id:789,message:id===202?[{type:'reply',data:{id:'303'}}]:[{type:'text',data:{text:'只有被引用者的正文'}}]});
 const detail=await request('/api/socialV2/message-detail?key='+encodeURIComponent(key)+'&messageId=202');
 assert.equal(detail.body.info.bodyComplete,false);assert.equal(detail.body.info.textTruncated,true);
 assert.equal(st.unread.find(m=>m.messageId==='202').bodyComplete,false);assert.equal(st.recentMessages.find(m=>m.messageId==='202').bodyComplete,false);
 const r=await request('/api/socialV2/send-message',{key,messages:'不能把被引用者正文当作本条正文'});assert.equal(r.body.ok,false);assert.match(r.body.error,/message_context_pending/);
});
test('a quote-only arrival directed at the bot retains its missing own-body status',async t=>{
 const {h,key,st,request}=await fixture(t);h.socialV2.paused=true;
 st.lastUnreadSeq=1;st.recentMessages.push({seq:1,messageId:'303',sender:'我',userId:'9',text:'已知机器人原文',plain:'已知机器人原文',bodyComplete:true,time:Date.now()});h.bot.getMessage=async()=>null;
 await h.handleIncoming('group',456,{message_id:202,user_id:789,self_id:9,sender:{nickname:'乙'},message:[{type:'reply',data:{id:'303'}}]},h.cfg);
 h.socialV2.paused=false;const current=st.unread.find(m=>m.messageId==='202');
 assert.equal(current.bodyComplete,false);assert.equal(current.plain,'');assert.match(current.text,/已知机器人原文/);
 await request('/api/socialV2/unread?key='+encodeURIComponent(key));
 const r=await request('/api/socialV2/send-message',{key,messages:'引用不是本条自有正文'});assert.equal(r.body.ok,false);assert.match(r.body.error,/message_context_pending/);
});
test('a known visible complete quote is reused locally with only its own plain body',async t=>{
 const {h,key,st,request}=await fixture(t);h.socialV2.paused=true;
 st.lastUnreadSeq=1;st.recentMessages.push({seq:1,messageId:'303',sender:'甲',userId:'789',text:'[引用 更旧内容]本地自有正文',plain:'本地自有正文',bodyComplete:true,unresolvedReplyIds:[],time:Date.now()});
 const fetched=[];h.bot.getMessage=async id=>{fetched.push(id);return null;};
 await h.handleIncoming('group',456,{message_id:202,user_id:789,self_id:9,sender:{nickname:'乙'},message:[{type:'reply',data:{id:'303'}},{type:'text',data:{text:'当前自有正文'}}]},h.cfg);
 h.socialV2.paused=false;const read=await request('/api/socialV2/unread?key='+encodeURIComponent(key));
 assert.match(read.body.messages[0].text,/本地自有正文/);assert.doesNotMatch(read.body.messages[0].text,/更旧内容/);
 assert.deepEqual(read.body.messages[0].omittedReplyIds,[]);assert.equal(fetched.length,0);assert.equal(st.recentMessages[0].seenAt,undefined);
});
test('foreign, partial, hidden and sequence-only local records cannot impersonate a known quote',async t=>{
 for(const mode of ['foreign','partial','hidden','seq-only']){
  const {h,key,st,request}=await fixture(t);h.socialV2.paused=true;
  const source={seq:303,messageId:mode==='seq-only'?'999':'303',sender:'甲',userId:'789',text:'不可复用正文',plain:'不可复用正文',bodyComplete:mode!=='partial',quotaAdmission:mode==='hidden'?'rejected':undefined,time:Date.now()};
  (mode==='foreign'?h.getSocialV2State('group:457'):st).recentMessages.push(source);
  h.bot.getMessage=async()=>null;
  await h.handleIncoming('group',456,{message_id:202,user_id:789,self_id:9,sender:{nickname:'乙'},message:[{type:'reply',data:{id:'303'}},{type:'text',data:{text:'当前自有正文'}}]},h.cfg);
  h.socialV2.paused=false;const read=await request('/api/socialV2/unread?key='+encodeURIComponent(key));
  assert.equal(read.body.messages[0].text,'当前自有正文');assert.deepEqual(read.body.messages[0].omittedReplyIds,['303']);
 }
});
test('omitting unknown references preserves known quotes and media and accepts a complete 200-character body',async t=>{
 const {h,key,st,request}=await fixture(t);h.socialV2.paused=true;
 h.bot.getMessage=async id=>id===303?{message_id:id,group_id:456,user_id:789,sender:{nickname:'甲',user_id:789},message:[{type:'text',data:{text:'可靠引用'}}]}:null;
 await h.handleIncoming('group',456,{message_id:202,user_id:789,self_id:9,sender:{nickname:'乙'},message:[{type:'reply',data:{id:'303'}},{type:'reply',data:{id:'404'}},{type:'text',data:{text:'全'.repeat(200)}},{type:'face',data:{id:'14'}}]},h.cfg);
 h.socialV2.paused=false;const read=await request('/api/socialV2/unread?key='+encodeURIComponent(key));
 const stored=st.unread.at(-1);assert.match(stored.text,/可靠引用/);assert.match(stored.text,/全{200}\[表情14\]/);
 assert.deepEqual(read.body.messages[0].omittedReplyIds,['404']);assert.equal(stored.hasMedia,true);assert.equal(stored.media[0].faceId,'14');
 assert.equal((await request('/api/socialV2/send-message',{key,messages:'当前正文和媒体已完整收到'})).body.ok,true);
 for(const [type,data,expected]of [['image',{},'[图片]'],['record',{},'[语音]'],['file',{name:'a.txt'},'[文件a.txt]']]){
  assert.equal(await h.segmentsToText([{type:'reply',data:{id:'404'}},{type,data}],{resolveReply:async()=>null,omitUnknownReplies:true}),expected);
 }
});
test('an unknown quote alone never manufactures an incoming body or an old receipt',async t=>{
 const {h,st}=await fixture(t);h.socialV2.paused=true;h.bot.getMessage=async()=>null;
 await h.handleIncoming('group',456,{message_id:202,user_id:789,self_id:9,sender:{nickname:'乙'},message:[{type:'reply',data:{id:'404'}}]},h.cfg);
 assert.equal(st.unread.length,0);assert.equal(st.lastUnreadSeq||0,0);assert.equal(h.calls.sent.length,0);
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

test('a gateway reply with a different message ID is omitted while the complete own body remains admissible',async t=>{
 const {h,key,request}=await fixture(t);h.socialV2.paused=true;
 h.bot.getMessage=async()=>({message_id:999,group_id:456,user_id:789,message:[{type:'text',data:{text:'wrong original'}}]});
 await h.handleIncoming('group',456,{message_id:205,user_id:789,self_id:9,sender:{nickname:'乙'},message:[{type:'reply',data:{id:'304'}},{type:'text',data:{text:'谁'}}]},h.cfg);
 h.socialV2.paused=false;
 const read=await request('/api/socialV2/unread?key='+encodeURIComponent(key));
 assert.ok(!JSON.stringify(read.body).includes('wrong original'));
 assert.equal(read.body.messages[0].text,'谁');assert.deepEqual(read.body.messages[0].omittedReplyIds,['304']);
 const r=await request('/api/socialV2/send-message',{key,messages:'must not answer from an unrelated quote'});
 assert.equal(r.body.ok,true,JSON.stringify(r.body));
});
