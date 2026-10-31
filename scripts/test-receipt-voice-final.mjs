import test from 'node:test';
import assert from 'node:assert/strict';
import * as receipts from '../src/bridge-core/receipt-state.js';
import {createSendLedger} from '../plugins/qq-components/ctx-chat-reply-shape/send-ledger.mjs';
import {planReplyShape} from '../src/reply-shape.js';
import {createPlugin as dynamics} from '../plugins/qq-components/ctx-context-dynamics/index.js';
import {classifyReceipt} from '../console/layers/O/context-records.js';
import {createOutboundTransport} from '../src/outbound-context.js';
import {currentDialogueExamples} from '../plugins/qq-components/ctx-context-dynamics/expression-policy.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {createPlugin as replyShape} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
import {REFRESH_MODULE_IDS} from '../plugins/qq-components/obs-context-assembly/refill.mjs';

function ledger(state={}){return {state,service:createSendLedger({state:{get:()=>state,set:p=>Object.assign(state,p)}},()=>({}))};}
const plan=()=>planReplyShape({key:'private:1',turnId:'t1',config:{maxMessagesNormal:10,maxMessagesCasual:10,maxSendPerMinute:100,maxSendPerHour:100}});

test('the current reply context refreshes real delivery progress without renewing the send allowance',()=>{
 const state={},plugin=replyShape({config:{},state:{get:()=>state,set:p=>Object.assign(state,p)}}),service=plugin.services.replyPlan;
 const p=service.resolve({key:'private:1',turnId:'progress-1',incomingText:'小猫真可爱'});
 assert.ok(REFRESH_MODULE_IDS.includes('ctx-chat-reply-shape'));
 assert.match(plugin.hooks.beforePrompt({key:p.key,replyPlan:p}),/已成功发送 0 条/);
 service.reserve({key:p.key,plan:p,operationId:'first',kind:'text',text:'呜，好可爱。'});
 assert.match(plugin.hooks.beforePrompt({key:p.key,replyPlan:p}),/发送中或结果待确认 1 条/);
 service.commit({key:p.key,operationId:'first',deliveryId:'actual-success'});
 const text=plugin.hooks.beforePrompt({key:p.key,replyPlan:p});assert.match(text,/已成功发送 1 条/);assert.match(text,/不要换说法再次发送/);
 assert.equal(service.remaining({key:p.key,plan:p}),p.maxMessages-1);
 assert.match(plugin.hooks.beforePrompt({key:p.key,replyPlan:{...p,turnId:'next'}}),/已成功发送 0 条/);
});

test('same delivered text and incoming generation cannot send twice, including after reload',()=>{
 const {state,service}=ledger(),p=plan(),a={key:p.key,plan:p,inputSeq:5,text:'我在呀。',kind:'text',now:100};
 assert.equal(service.reserve({...a,operationId:'one'}).ok,true);service.commit({key:p.key,operationId:'one',deliveryId:'sent:one',sentAt:101});
 assert.equal(ledger(state).service.reserve({...a,operationId:'two'}).reason,'duplicate_delivery');
 assert.equal(service.reserve({...a,inputSeq:6,operationId:'new-input'}).ok,true);
});
test('parallel and uncertain copies remain blocked; known failed attempts can retry',()=>{
 const {service}=ledger(),p=plan(),a={key:p.key,plan:p,inputSeq:5,text:'我在呀。',kind:'text',now:100};
 service.reserve({...a,operationId:'one'});
 assert.equal(service.reserve({...a,operationId:'parallel'}).reason,'duplicate_delivery');
 service.release({key:p.key,operationId:'one',knownFailed:false});assert.equal(service.reserve({...a,operationId:'uncertain'}).reason,'duplicate_delivery');
 service.release({key:p.key,operationId:'one',knownFailed:true});assert.equal(service.reserve({...a,operationId:'retry'}).ok,true);
});
test('administrative closure retains raw history without inventing physical reply timestamps',()=>{
 const old={seq:1,seenAt:10,text:'旧请求'},fresh={seq:2,text:'新来信'},st={unread:[old,fresh],recentMessages:[old,fresh],lastReadThroughSeq:0};
 assert.equal(typeof receipts.resolveReceiptsV2,'function');
 const denied=receipts.resolveReceiptsV2(st,{seqs:[1,2],reason:'旧记录经人工核对归档',at:100});assert.equal(denied.ok,false);assert.equal(old.resolvedAt,undefined);
 assert.equal(receipts.resolveReceiptsV2(st,{seqs:[1],reason:'旧记录经人工核对归档',at:100}).ok,true);
 assert.equal(old.repliedAt,undefined);assert.equal(old.seenAt,10);assert.equal(receipts.receiptStateV2(old),'resolved');assert.equal(classifyReceipt({...old,receiptState:'resolved'}),'resolved');
 assert.deepEqual(st.unread.map(m=>m.seq),[2]);assert.equal(st.lastReadThroughSeq,1);assert.equal(receipts.awaitingReplyCountV2(st),0);
});
test('text style protection and recent tail evidence stay active when sticker media is disabled',()=>{
 const blocks=[],own=[{isSelf:true,text:'我在 (￣▽￣)'},{isSelf:true,text:'好呀 (￣▽￣)'}];
 const p=dynamics({config:{disabledBlocks:['sticker']},addPromptBlock:t=>blocks.push(t)});
 p.hooks.beforePrompt({key:'group:1',reason:'budgetWeak',st:{recentMessages:[]},recentOwnMessages:own,stickerConfig:{enabled:false},moodState:{enabled:true,score:60,mode:'normal',modeName:'普通',styleInstruction:'完整示范'}});
 assert.match(blocks.join('\n'),/近期表达去重/);assert.match(blocks.join('\n'),/本轮表达校准/);
  assert.match(blocks.join('\n'),/【交流目标】.*当前需求/);
 assert.equal(p.services.chatExpression.validate({key:'group:1',kind:'text',text:'你又输了吧 (￣▽￣)'}).ok,false);
 assert.equal(p.services.chatExpression.validate({key:'group:1',kind:'text',text:'诶，这么大的枪呀，我都要抱不动了。'}).ok,true);
});

test('actual outbound transport rejects repeated style and duplicate text before physical delivery',async()=>{
 const {service}=ledger(),p=plan();let sends=0;
 const voice=dynamics({config:{},addPromptBlock(){}});
 voice.hooks.beforePrompt({key:p.key,reason:'budgetWeak',recentOwnMessages:[{isSelf:true,text:'好 (￣▽￣)'},{isSelf:true,text:'嗯 (￣▽￣)'}]});
 const transport=createOutboundTransport({sleep:async()=>{},callService:(s,m,a)=>s==='replyPlan'&&typeof service[m]==='function'?service[m](a):s==='chatExpression'&&m==='validate'?voice.services.chatExpression.validate(a):null});
 const envelope={key:p.key,replyPlan:p,actionId:'wave1',replyGrantThroughSeq:5,reason:'private'},context=transport.capture({key:p.key,envelope,agent:true,origin:'conversation',conversationIntent:'reply'});
 const send=async()=>({message_id:++sends});
 await assert.rejects(transport.perform({key:p.key,context,text:'我来啦 (￣▽￣)',send}),/repeated_expression_tail/);assert.equal(sends,0);
 await transport.perform({key:p.key,context,text:'诶，我来啦。',send});
 await assert.rejects(transport.perform({key:p.key,context,text:'诶，我来啦。',send}),/duplicate_delivery/);assert.equal(sends,1);
 envelope.replyGrantThroughSeq=6;await transport.perform({key:p.key,context,text:'诶，我来啦。',send});assert.equal(sends,2);
});

test('mechanical and scheduled notices retain independent delivery semantics',()=>{
 const {service}=ledger(),p={...plan(),agent:false};
 const a={key:p.key,plan:p,inputSeq:5,text:'日程提醒',kind:'text',now:100};
 assert.equal(service.reserve({...a,operationId:'one'}).ok,true);service.commit({key:p.key,operationId:'one',sentAt:100,deliveryId:'one'});
 assert.equal(service.reserve({...a,operationId:'two'}).ok,true);
});

test('a fresh context excludes pre-cutover chat replay while retaining pending input and original logs',()=>{
 const oldSelf={isSelf:true,time:50,text:'旧语气'},oldDone={seq:1,time:50,seenAt:51,repliedAt:52,text:'已答'},pending={seq:2,time:60,text:'待答'},fresh={seq:3,time:150,text:'新消息'};
 const st={modelContextSince:100,recentMessages:[oldSelf,oldDone,pending,fresh],unread:[pending,fresh]},view=receipts.modelStateViewV2(st);
 assert.deepEqual(view.recentMessages,[pending,fresh]);assert.deepEqual(view.unread,[pending,fresh]);assert.equal(st.recentMessages.length,4);
});

test('tail reinforcement repeats selected administrator examples verbatim and separates both forms',()=>{
 const normal='私聊：原句 A\n群聊接梗：调侃 B\n被夸：原句 C\n关心：原句 D';
 const n=currentDialogueExamples(normal,'normal');assert.match(n,/原句 A/);assert.match(n,/原句 C/);assert.match(n,/原句 D/);assert.doesNotMatch(n,/调侃 B/);
 assert.match(n,/有意重复/);assert.match(n,/请勿.*去重/);assert.match(n,/管理员原有示范优先/);
 const critical='【普通回应示例】安静 E\n【身份思考示例】内省 F';
 assert.doesNotMatch(currentDialogueExamples(critical,'critical'),/原句 A|调侃 B/);assert.match(currentDialogueExamples(critical,'critical'),/安静 E/);
});

test('public system voice repeats selected administrator examples without a second persona',()=>{
 const blocks=[],p=dynamics({config:{},addPromptBlock:t=>blocks.push(t)});
 const style='私聊：示例 A\n被夸：示例 B\n关心：示例 C';
 p.hooks.beforePrompt({key:'group:1',moodState:{enabled:true,score:60,mode:'normal',modeName:'日常交流',styleInstruction:style}});
 const system=p.services.chatExpression.current({key:'group:1'}).text;
 assert.equal(system.split('示例 A').length-1,2);
 assert.match(system,/管理员原有示范优先/);
 assert.doesNotMatch(system,/短接话示范/);
 const critical=dynamics({config:{},addPromptBlock(){}});
 critical.hooks.beforePrompt({key:'private:2',moodState:{enabled:true,score:20,mode:'critical',modeName:'简洁交流',styleInstruction:'临界示例'}});
 const selected=critical.services.chatExpression.current({key:'private:2'}).text;
 assert.match(selected,/临界示例/);assert.doesNotMatch(selected,/示例 A|短接话示范/);
});

test('the console reports budget-skipped model tests as not executed, rather than successful delivery',async()=>{
 const h=await bridgeHarness();let server;
 try{
  h.setMode('reserved2');await h.ensureSession('private:123');
  const original=h.pluginHost.callService.bind(h.pluginHost);h.pluginHost.callService=(s,m,p)=>s==='tokenBudget'&&m==='canDispatch'?false:original(s,m,p);
  server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/console/notify-ai',{method:'POST',headers:{'x-console-token':'fixture-console-token','content-type':'application/json',origin:base,connection:'close'},body:JSON.stringify({key:'private:123',message:'isolated blocked test'}),signal:AbortSignal.timeout(5000)});
  const data=await response.json();assert.equal(response.status,409,JSON.stringify(data));assert.equal(data.skipped,true);assert.equal(data.ok,false);
 }finally{if(server)await new Promise(r=>server.close(r));await h.close();}
});

test('every reserved2 delivery frames a fresh task even without a wake reason',async()=>{
 const h=await bridgeHarness();
 try{
  h.setMode('reserved2');const frames=[];
  const original=h.pluginHost.callService.bind(h.pluginHost);
  h.pluginHost.callService=(s,m,p)=>{if(s==='contextAssembly'&&m==='frame'){frames.push(p);return 'fresh signed frame';}return original(s,m,p);};
  await h.deliverPrompt('private:123','CURRENT-CHAT-ONLY',{silent:true,modelReason:'maintenance'});
  assert.equal(frames.length,1,'a raw console delivery must replace an earlier maintenance packet');
  assert.equal(frames[0].scene,'maintenance');assert.ok(Array.isArray(frames[0].modules));
  assert.match(frames[0].prompt,/CURRENT-CHAT-ONLY/);assert.equal(typeof frames[0].roleText,'string');
 }finally{await h.close();}
});
