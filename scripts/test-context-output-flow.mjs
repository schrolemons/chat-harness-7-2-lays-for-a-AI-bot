import test from 'node:test';
import assert from 'node:assert/strict';
import {requestEntries,inspectorHtml} from '../console/layers/O/context-inspector.js';
import {outputTrace} from '../console/layers/O/context-processing.js';
import {messageIsOutgoing,messageActor,timelineEntries} from '../console/layers/O/context-timeline.js';
import {processingEntries,traceHtml} from '../console/layers/O/context-processing.js';
import {messageBodyParts} from '../console/layers/O/context-message-body.js';
const call=(id,name,args={})=>({role:'assistant',toolCalls:[{id,name}],text:JSON.stringify({type:'tool-call',id,name,arguments:args})});
const result=(id,data)=>({role:'tool',toolResults:[{toolCallId:id}],text:JSON.stringify(data)});
const trace=(messages,index=messages.length-1)=>{const request={key:'private:123',sessionId:'session-test',scene:'memoryWrite',messages},rows=requestEntries(request);return outputTrace(rows[index],rows,request);};

test('generation source names the recorded trigger and preserves unknown trigger codes',()=>{
 for(const [reason,title] of [['question','收到提问'],['replyCheck','回复后检查'],['memoryWrite','后台记忆整理'],['probability','群聊来信通过唤醒判定'],['custom-trigger','触发类型：custom-trigger']]){
  const t=trace([{role:'assistant',text:'模型原文',provenance:{generation:{reason,inputs:[]}}}]);assert.equal(t.origin.title,title);
 }
 const t=trace([call('m','qq_memory_append',{category:'memberImpression'}),result('m',{ok:true,category:'memberImpression'}),{role:'assistant',text:'后续原文'}]);
 assert(!traceHtml(t).includes('前一步工具处理'));assert(!traceHtml(t).includes('轻量记忆'));assert(!t.badges.includes('印象回执后'));
});

test('archived errors and adjacent inputs never become a tool-call cause',()=>{
 const t=trace([{role:'user',source:'qq-context-tool-history',text:'重复工具错误折叠归档'},call('u','qq_get_unread_messages')]);
 assert.equal(t.origin.kind,'unknown');assert.equal(t.origin.title,'调用原因未记录');assert.deepEqual(t.origin.positions,[]);
});
test('native generation inputs survive later task retirement and identify the original incoming batch',()=>{
 const input={id:'inbound',role:'user',source:'qq-context-dialogue',text:'【新增 QQ 消息数据】\n[{"seq":12,"text":"你好"}]'};
 const c={...call('u','qq_get_unread_messages'),provenance:{generation:{turn:98,step:3,reason:'message',inputs:[{id:'inbound',eventSeq:3405,kind:'qq-context-dialogue'}]}}};
 const t=trace([input,{role:'user',source:'qq-context-tool-history',text:'错误归档'},c]);
 assert.equal(t.origin.kind,'incoming');assert.equal(t.origin.title,'收到新消息');assert.deepEqual(t.origin.positions,[1]);assert(!t.origin.title.includes('归档'));
});
test('periodic causes use the original turn trigger, never the newest request scene',()=>{
 const c={...call('u','qq_get_unread_messages'),provenance:{generation:{reason:'proactiveCheck',inputs:[{id:'retired-task',eventSeq:70,kind:'qq-context-task'}]}}};
 const t=trace([{role:'user',source:'qq-context-task',triggerReason:'message',text:'原因：message'},c]);
 assert.equal(t.origin.title,'静默后主动检查');assert.equal(t.origin.kind,'periodic');assert.deepEqual(t.origin.positions,[]);assert.deepEqual(t.origin.eventSeqs,[70]);
});
test('a typed tool error explains the corrective read only through native result identity',()=>{
 const failure={id:'failed',...result('send',{ok:false,code:'message_context_pending'})};
 const c={...call('u','qq_get_unread_messages'),provenance:{generation:{reason:'message',inputs:[],toolInputs:[{id:'failed',eventSeq:50,code:'message_context_pending'}]}}};
 const t=trace([failure,{role:'user',source:'qq-context-tool-history',text:'无关归档'},c]);
 assert.equal(t.origin.kind,'tool-requirement');assert.match(t.origin.title,/补齐.*来信/);assert.deepEqual(t.origin.positions,[1]);
 const unrelated=trace([{...c,provenance:{generation:{reason:'message',inputs:[],toolInputs:[]}}},failure],0);
 assert.equal(unrelated.origin.title,'收到新消息');
});
test('a quoted reply links the precise referenced message instead of a nearby batch',()=>{
 const input={role:'user',source:'qq-context-dialogue',text:'【新增 QQ 消息数据】\n[{"seq":12,"messageId":"qq-12","text":"请看这一句"}]'};
 const t=trace([input,{role:'user',source:'qq-context-tool-history',text:'错误归档'},call('s','qq_reply',{messageId:'qq-12'})]);
 assert.equal(t.origin.kind,'message-reference');assert.match(t.origin.title,/回应.*来信/);assert.deepEqual(t.origin.positions,[1]);
});
test('a known native generation with no trigger cannot borrow a neighboring task or current scene',()=>{
 const c={...call('u','qq_get_unread_messages'),provenance:{generation:{turn:9,step:2,inputs:[]}}};
 const t=trace([{role:'user',source:'qq-context-task',triggerReason:'timeBubble',text:'原因：timeBubble'},c]);
 assert.equal(t.origin.kind,'unknown');assert.equal(t.origin.title,'调用原因未记录');
});
test('an explicit schedule question attributes the query to the matching dialogueSeq in its native batch',()=>{
 const input={id:'input',role:'user',source:'qq-context-dialogue',text:'【新增 QQ 消息数据】\n'+JSON.stringify([{seq:81,dialogueSeq:901,text:'今天的天气不错'},{seq:82,dialogueSeq:902,text:'帮我查询日程'},{seq:83,dialogueSeq:903,isSelf:true,text:'今天要做什么'}])};
 const c={...call('schedule','qq_schedule',{action:'list'}),provenance:{generation:{reason:'message',inputs:[{id:'input',eventSeq:1}]}}};
 const t=trace([input,c]);assert.equal(t.origin.kind,'user-request');assert.equal(t.origin.title,'对话序号 902');assert.deepEqual(t.origin.dialogueSeqs,[902]);
 const html=inspectorHtml({messages:[input,c]},[],{view:'messages',layout:'business',selected:'message:1'},{renderText:()=>'',renderComponent:()=>''});assert.match(html,/data-inspector-message="qq:82"/);
});
test('today-task questions are recognized but old requests and negated schedule requests are not',()=>{
 const input=(id,text,dialogueSeq)=>({id,role:'user',source:'qq-context-dialogue',text:'【新增 QQ 消息数据】\n'+JSON.stringify([{seq:dialogueSeq,dialogueSeq,text}])});
 const c={...call('schedule','qq_schedule',{action:'list'}),provenance:{generation:{reason:'message',inputs:[{id:'current'}]}}};
 assert.equal(trace([input('old','帮我查询日程',2),input('current','今天要做什么',3),c]).origin.title,'对话序号 3');
 assert.equal(trace([input('old','帮我查询日程',2),input('current','不要查询日程',3),c]).origin.title,'收到新消息');
 const periodic={...c,provenance:{generation:{reason:'proactiveCheck',inputs:[{id:'current'}]}}};
 assert.equal(trace([input('current','帮我查询日程',3),periodic]).origin.title,'静默后主动检查');
});

test('internal prose has a concrete event-log destination without claiming profile or MD writes',()=>{
 const t=trace([{role:'assistant',text:'我已经把你记入画像和日记了'}]);
 assert.equal(t.destinations[0].kind,'session');assert.equal(t.destinations[0].title,'会话历史');
 assert.match(t.destinations[0].storage,/session\.v4\.jsonl\.zstd/);assert(!t.destinations.some(x=>x.kind==='memory'));
 assert(t.badges.includes('生成原文'));assert.equal(t.qqVerified,false);
});
test('impression write receipt is a prior effect, not the destination of following prose',()=>{
 const t=trace([call('m','qq_memory_append',{category:'memberImpression',key:'private:123'}),result('m',{ok:true,key:'private:123',category:'memberImpression',content:'观察',memory:{}}),{role:'assistant',text:'记下了'}]);
 assert.equal(t.origin.kind,'unknown');assert(!t.badges.includes('印象回执后'));
 assert.equal(t.priorEffects[0].status,'confirmed');assert.match(t.priorEffects[0].storage,/state\/social-v2\.json/);
 assert.match(t.priorEffects[0].field,/memberImpressions/);assert.equal(t.destinations.length,1);assert.equal(t.destinations[0].kind,'session');
});
test('profile writes inspect the plugin result, not just the successful outer envelope',()=>{
 const c=call('p','mcp__snowluma__profile_update',{userId:'123',profile:{relationships:'有依据的关系'}});
 const good=trace([c,result('p',{ok:true,plugin:'ctx-memory-profile-store',result:{ok:true,changed:true,userId:'123'}})],0).destinations[0];
 assert.equal(good.status,'confirmed');assert.match(good.storage,/state\/person-profiles\.json/);assert.match(good.field,/relationships/);
 const bad=trace([c,result('p',{ok:true,plugin:'ctx-memory-profile-store',result:{ok:false,changed:false,error:'权限拒绝'}})],0).destinations[0];assert.equal(bad.status,'failed');assert.match(bad.outcome,/权限拒绝/);
 const none=trace([c,result('p',{ok:true,plugin:'ctx-memory-profile-store',result:{ok:false,changed:false}})],0).destinations[0];assert.equal(none.status,'unchanged');
 assert.equal(trace([c],0).destinations[0].status,'pending');
});
test('reads and failed affairs do not become confirmed writes',()=>{
 assert.equal(trace([call('r','profile_get',{userId:'123'}),result('r',{ok:true,plugin:'ctx-memory-profile-store',result:{ok:true,profile:{}}})],0).destinations[0].status,'read');
 assert.equal(trace([call('l','qq_task_note',{key:'private:123',action:'list'}),result('l',{ok:true,items:[]})],0).destinations[0].status,'read');
 const t=trace([call('a','qq_task_note',{key:'private:123',action:'upsert'}),result('a',{ok:false,error:'版本冲突'})],0).destinations[0];assert.equal(t.status,'failed');assert.match(t.storage,/affairs\/private_123\.json/);
 // Compatibility routing can redirect memory calls; lack of category receipt cannot prove a memory write.
 assert.equal(trace([call('m','qq_memory_append',{category:'memberImpression'}),result('m',{ok:true,plan:{}})],0).destinations[0].status,'unverified');
});
test('MCP error envelopes cannot be stripped into a successful save',()=>{
 const c=call('m','qq_memory_append',{category:'memberImpression'}),t=trace([c,result('m',{isError:true,content:[{type:'text',text:JSON.stringify({ok:true,category:'memberImpression'})}]})],0);
 assert.equal(t.destinations[0].status,'failed');
 const plain=trace([c,{role:'tool',toolResults:[{toolCallId:'m'}],text:'Error: connection failed'}],0);assert.equal(plain.destinations[0].status,'failed');
});
test('mood ledger and double-receipt updates expose their concrete fields and no-change results',()=>{
 const mood=trace([call('m','qq_mood',{key:'private:123',action:'add',value:5}),result('m',{ok:true,before:60,score:65})],0).destinations[0];assert.equal(mood.status,'confirmed');assert.match(mood.storage,/ctx-user-mood\.json/);assert.match(mood.field,/score \/ history/);
 const receipt=trace([call('r','qq_report_message_receipts'),result('r',{ok:true,updated:1,receipts:[{seq:505,state:'complete'}]})],0);assert.equal(receipt.qqVerified,false);assert.equal(receipt.destinations[0].status,'confirmed');assert.match(receipt.destinations[0].title,/收件双戳/);
 const unchanged=trace([call('r','qq_report_message_receipts'),result('r',{ok:true,updated:0,receipts:[]})],0);assert.equal(unchanged.destinations[0].status,'unchanged');
});
test('automatic memory route needs the historical task and wrapper; newest scene is insufficient',()=>{
 const generated={role:'assistant',text:'<MEMORY>事实</MEMORY>'};
 assert(!trace([generated]).destinations.some(x=>x.kind==='memory'));
 const task={role:'user',source:'qq-context-task',text:'原因：memoryWrite'};
 const t=trace([task,generated]);assert(t.badges.includes('记忆MD·待核验'));
 assert.equal(t.destinations[1].status,'unverified');assert.match(t.destinations[1].storage,/state\/memory\/private_123\.md/);
 assert(!trace([task,{role:'assistant',text:'普通收尾'}]).destinations.some(x=>x.kind==='memory'));
});
test('card abbreviations explain observed cause and retention without exposing a raw tool block',()=>{
 const request={messages:[call('m','qq_memory_append',{category:'memberImpression'}),result('m',{ok:true,category:'memberImpression'}),{role:'assistant',text:'这一轮先停在这里。'}]},html=inspectorHtml(request,[],{view:'messages',layout:'business',selected:'message:2'},{renderText:()=>'',renderComponent:()=>''});
 assert.match(html,/context-output-badges/);assert(!html.includes('印象回执后'));assert(!html.includes('前一步工具处理'));assert.match(html,/生成原文/);assert.match(html,/这一轮先停在这里/);
});
test('QQ actors and direction follow explicit self or verified delivery, never administrator or nickname',()=>{
 for(const row of [{kind:'qq',record:{sender:'管理员',isOwner:true}},{kind:'forwarded',record:{sender:'AI助手'}},{kind:'qq',record:{isSelf:'false'}}])assert.equal(messageIsOutgoing(row),false);
 assert.equal(messageActor({kind:'qq',record:{sender:{nickname:'群友'}}}),'群友');
 assert.equal(messageIsOutgoing({kind:'qq',record:{isSelf:true}}),true);assert.equal(messageIsOutgoing({kind:'delivery',verified:true}),true);
});
test('a captured conversation interleaves people and bot in its actual shared order; seq stays original',()=>{
 const request={messages:[{role:'user',source:'qq-context-dialogue',text:'【历史 QQ 消息数据】\n'+JSON.stringify([{seq:505,dialogueSeq:90,sender:'用户',isOwner:true,text:'相同文字',receiptState:'complete'},{dialogueSeq:91,isSelf:true,text:'回复'},{seq:506,dialogueSeq:92,sender:'用户乙',text:'相同文字',receiptState:'complete'},{dialogueSeq:93,isSelf:true,text:'回复'}])}]},v=processingEntries(request,requestEntries(request)),rows=timelineEntries(v.entries).filter(x=>x.kind==='qq');
 assert.deepEqual(rows.map(x=>messageIsOutgoing(x)),[false,true,false,true]);assert.deepEqual(rows.map(x=>x.seq),[505,undefined,506,undefined]);assert.equal(rows.length,4);
});
test('legacy chat without a shared ordering field preserves the captured order rather than sorting bot to the end',()=>{
 const request={messages:[{role:'user',source:'qq-context-dialogue',text:'【历史 QQ 消息数据】\n'+JSON.stringify([{seq:505,text:'来信甲',receiptState:'complete'},{isSelf:true,text:'回答甲'},{seq:506,text:'来信乙',receiptState:'complete'},{isSelf:true,text:'回答乙'}])}]};
 const rows=timelineEntries(processingEntries(request,requestEntries(request)).entries).filter(x=>x.kind==='qq');assert.deepEqual(rows.map(x=>x.text),['来信甲','回答甲','来信乙','回答乙']);
});
test('quoted previews separate sender and body without repeating the machine quote wrapper',()=>{
 const row={text:'[引用 AI助手：今天忙吗]刚忙完',plain:'刚忙完',quoteTargetIsSelf:true},before=JSON.stringify(row),parts=messageBodyParts(row);
 assert.equal(parts.text,'刚忙完');assert.equal(parts.quoted.sender,'AI助手');assert.equal(parts.quoted.text,'今天忙吗');assert.equal(JSON.stringify(row),before);
 assert.equal(messageBodyParts({text:'[引用 乙：含[图片]与]的原话]回答',plain:'回答'}).quoted.text,'含[图片]与]的原话');
});
