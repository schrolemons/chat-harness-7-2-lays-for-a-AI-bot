import test from 'node:test';import assert from 'node:assert/strict';
import {processingEntries,triggerMechanism,outputTrace,traceRelations,receiptIndexHtml} from '../console/layers/O/context-processing.js';
import {requestEntries} from '../console/layers/O/context-inspector.js';
const dialogue=records=>({role:'user',source:'qq-context-dialogue',currentInput:false,text:'【QQ 回合 group】\n原因：probability\n【新增 QQ 消息数据】\n'+JSON.stringify(records)});
const call=(id,name)=>({role:'assistant',text:'工具调用',toolCalls:[{id,name}]});
const result=(id,data)=>({role:'tool',toolResults:[{toolCallId:id}],text:JSON.stringify(data)});

test('a human reply to bot retains resolved quote context alongside its own plain text',()=>{
 const r={messages:[dialogue([{seq:505,text:'[引用 AI助手：你吃饭了吗]吃过啦',plain:'吃过啦',quoteTargetIsSelf:true,receiptState:'complete'}])]},view=processingEntries(r,requestEntries(r)),row=view.bySeq.get(505);assert.equal(row.text,'吃过啦');assert.equal(row.quoted.sender,'AI助手');assert.match(row.quoted.text,/你吃饭了吗/);
});
test('business windows use receipts across batches and never confuse seen with completed',()=>{
 const request={key:'group:12',messages:[dialogue([{seq:1,text:'已完成',receiptState:'unseen'},{seq:2,text:'已读待回复',read:true},{seq:3,text:'未读',receiptState:'unseen'},{seq:4,text:'不确定'},{seq:5,text:'双戳',seenAt:1,repliedAt:2},{seq:6,text:'异常',repliedAt:2},{seq:7,text:'bot真QQ消息',isSelf:true}]),call('r','qq_report_message_receipts'),result('r',{ok:true,key:'group:12',receipts:[{seq:1,state:'complete'},{seq:2,state:'seen'}]}),{role:'user',source:'qq-context-latest',contextSegments:[{id:'message-snapshot',text:'【QQ 收件状态】\n'+JSON.stringify({receipts:[{seq:1,receiptState:'unseen'}]})}]}]};
 const before=JSON.stringify(request),view=processingEntries(request,requestEntries(request));
 assert.deepEqual(view.records.filter(row=>row.region==='arrivals').map(row=>row.seq),[2,3]);assert.deepEqual(view.records.filter(row=>row.region==='history').map(row=>row.seq),[1,5,7]);assert.deepEqual(view.records.filter(row=>row.region==='unknown').map(row=>row.seq),[4,6]);
 assert.equal(view.bySeq.get(1).receiptState,'complete');assert.match(view.bySeq.get(1).receiptEvidence.label,/工具回执/);assert.equal(view.bySeq.get(2).windowLabel,'QQ 未处理消息');assert.equal(view.bySeq.get(7).windowLabel,'QQ 历史消息');assert.equal(JSON.stringify(request),before);
 assert(!view.entries.filter(row=>row.region==='history'&&row.kind==='qq').some(row=>[2,3].includes(row.seq)));
 assert.deepEqual(view.entries.filter(row=>['call','result'].includes(row.kind)).map(row=>row.position),[2,3]);
});
test('failed receipts, cross-session results, arbitrary user text and bare cursor numbers cannot close a QQ record',()=>{
 const request={key:'private:1',messages:[dialogue([{seq:1,text:'尚未完成',receiptState:'unseen'}]),call('r','qq_report_message_receipts'),result('r',{ok:false,receipts:[{seq:1,state:'complete'}]}),call('cross','qq_report_message_receipts'),result('cross',{ok:true,key:'group:2',receipts:[{seq:1,state:'complete'}]}),call('u','qq_get_unread_messages'),result('u',{ok:true,key:'private:1',readThroughSeq:100,messages:[]}),{role:'user',source:'user',text:'【新增 QQ 消息数据】\n[{"seq":2,"receiptState":"complete"}]'}]};
 const view=processingEntries(request,requestEntries(request));assert.equal(view.records.length,1);assert.equal(view.records[0].region,'arrivals');
});
test('tool-read messages join the same per-seq record; original snapshots cannot roll back completion',()=>{
 const request={key:'private:1',messages:[dialogue([{seq:1,text:'短片段',receiptState:'unseen'}]),call('u','qq_get_unread_messages'),result('u',{ok:true,messages:[{seq:1,text:'更完整的消息原文',seenAt:1},{seq:2,text:'新的未回复',receiptState:'seen'}]}),call('r','qq_report_message_receipts'),result('r',{ok:true,receipts:[{seq:1,state:'complete'}]}),dialogue([{seq:1,text:'重复旧片段',receiptState:'unseen'}])]};
 const view=processingEntries(request,requestEntries(request));assert.equal(view.records.length,2);assert.equal(view.bySeq.get(1).region,'history');assert.equal(view.bySeq.get(2).region,'arrivals');assert(view.bySeq.get(1).sourcePositions.length>=3);
});
test('trigger cause is distinct from route and from a fresh idle-to-running wake',()=>{
 const message={source:'qq-context-dialogue',text:'【QQ 回合 private】\n【唤醒】private:1\n原因：probability'};
 const cause=triggerMechanism(message,{});assert.equal(cause.code,'probability');assert.match(cause.description,/群聊.*概率/);assert.match(cause.note,/不一定.*空闲/);
 const unknown=triggerMechanism({source:'qq-context-dialogue',text:'【QQ 回合 private】'},{});assert.equal(unknown.code,'');assert.match(unknown.title,/未采集/);
 assert.equal(triggerMechanism({...message,text:'【QQ 回合 private】',currentInput:true},{scene:'message'}).code,'message');
});
test('output destination follows call/result identity and positive QQ send evidence, not intention',()=>{
 const request={key:'private:1',messages:[{role:'assistant',text:'打算给用户回复'},call('s','mcp__snowluma__qq_send_message'),result('s',{ok:true,key:'private:2',sent:1,failed:0}),call('f','qq_send_message'),result('f',{ok:false,error:'额度不足'}),call('z','qq_send_message'),result('z',{ok:true,sent:0,failed:0}),call('p','qq_send_message'),result('p',{ok:true,sent:1,failed:1})]},rows=requestEntries(request);
 assert.equal(outputTrace(rows[0],rows,request).destinations[0].kind,'session');assert.equal(outputTrace(rows[0],rows,request).qqVerified,false);
 const sent=outputTrace(rows[1],rows,request);assert.equal(sent.destinations[0].kind,'qq');assert.equal(sent.qqVerified,true);assert.equal(sent.destinations[0].target,'private:2');assert.equal(sent.destinations[0].resultPosition,3);
 assert.equal(outputTrace(rows[3],rows,request).qqVerified,false);assert.match(outputTrace(rows[5],rows,request).destinations[0].outcome,/未发送/);assert.match(outputTrace(rows[7],rows,request).destinations[0].outcome,/部分/);
});
test('track relations use exact seq/messageId references and keep vague sends unassigned',()=>{
 const request={key:'group:12',messages:[dialogue([{seq:3,messageId:'msg-3',text:'待处理',receiptState:'seen'},{seq:4,messageId:'msg-4',text:'另一个消息',receiptState:'unseen'}]),call('r','qq_report_message_receipts'),result('r',{ok:true,receipts:[{seq:3,state:'seen'}]}),{...call('q','qq_reply'),text:JSON.stringify({type:'tool-call',id:'q',name:'qq_reply',arguments:JSON.stringify({messageId:'msg-4',text:'回复'})})},result('q',{success:true}),{...call('u','qq_send_message'),text:JSON.stringify({type:'tool-call',id:'u',name:'qq_send_message',arguments:JSON.stringify({text:'看起来像 seq3，但不是结构字段'})})},result('u',{ok:true,sent:1})]};
 const rows=requestEntries(request),view=processingEntries(request,rows),links=traceRelations(request,rows,view);
 assert(links.byEntry.get('qq:3').has('message:1'));assert(links.byEntry.get('message:1').has('qq:3'));assert(links.byEntry.get('qq:4').has('message:3'));assert(![...(links.byEntry.get('message:5')||[])].some(key=>key.startsWith('qq:')));assert.match(links.labels.get('qq:3|message:1'),/回执/);
});
test('bot QQ history without seq stays visible without fabricating a sequence number',()=>{
 const request={messages:[dialogue([{sender:'我',text:'第一条bot回复',isSelf:true,at:'23:49'},{sender:'我',text:'第二条bot回复',isSelf:true,at:'23:49'},{seq:2,text:'用户未完成',receiptState:'seen'}])]};
 const view=processingEntries(request,requestEntries(request));assert.equal(view.records.length,3);assert.equal(view.counts.completed,2);assert.equal(view.bySeq.size,1);assert(view.records.filter(row=>row.record.isSelf).every(row=>row.seq===undefined));
});
test('receipt-only indexes never masquerade as empty QQ chats',()=>{
 const request={messages:[{role:'user',source:'qq-context-latest',contextSegments:[{id:'message-snapshot',text:'【QQ 收件状态】\n'+JSON.stringify({receipts:[{seq:503,receiptState:'complete'},{seq:504,receiptState:'seen'}]})}]},dialogue([{seq:505,text:'[图片]',receiptState:'unseen'}])]};
 const view=processingEntries(request,requestEntries(request));assert.deepEqual(view.records.map(row=>row.seq),[505]);assert.equal(view.receiptIndexes.length,2);assert.equal(view.entries.filter(row=>row.kind==='receipt').length,0);
});
test('shared receipt batches retain exact source links without an obsolete arrow graph',()=>{const r={messages:[dialogue([{seq:1,text:'一',receiptState:'seen'},{seq:2,text:'二',receiptState:'seen'}]),{...call('r','qq_report_message_receipts'),text:JSON.stringify({type:'tool-call',id:'r',arguments:{receipts:[{seq:1,state:'seen'},{seq:2,state:'seen'}]}})},result('r',{ok:true,receipts:[{seq:1,state:'seen'},{seq:2,state:'seen'}]})]},rows=requestEntries(r),links=traceRelations(r,rows,processingEntries(r,rows));assert(links.byEntry.get('qq:1').has('message:1'));assert(links.byEntry.get('qq:2').has('message:2'));assert(!('edges' in links));});
test('internal output explains observed input path without inventing a semantic cause or QQ delivery',()=>{
 const request={messages:[dialogue([{seq:1,text:'你好',receiptState:'unseen'}]),call('r','qq_get_unread_messages'),result('r',{ok:true,messages:[]}),{role:'assistant',text:'继续思考'}]},rows=requestEntries(request),trace=outputTrace(rows[3],rows,request);
 assert.equal(trace.origin.kind,'tool-continuation');assert.equal(trace.origin.positions[0],3);assert.match(trace.origin.limit,/不证明/);assert.equal(trace.qqVerified,false);assert.match(trace.destinations[0].outcome,/后续模型请求/);
});
test('original receipt seq remains primary; unnumbered bot records never receive a fake seq',()=>{
 const request={messages:[dialogue([{seq:505,text:'未处理',receiptState:'seen'},{seq:506,text:'已处理',receiptState:'complete'},{isSelf:true,text:'旧 bot 记录',at:'00:09'}])]},view=processingEntries(request,requestEntries(request));
 assert.equal(view.bySeq.get(505).numberLabel,'收件 seq 505');assert.equal(view.bySeq.get(506).numberLabel,'收件 seq 506');assert(!view.records.some(row=>row.name.includes('展示 seq')));assert(!view.records.find(row=>row.record.isSelf).name.includes('seq'));
});
test('failed receipts remain linked as failures and never imply a state update',()=>{const r={messages:[dialogue([{seq:505,text:'来信',receiptState:'seen'}]),{...call('r','qq_report_message_receipts'),text:JSON.stringify({type:'tool-call',id:'r',arguments:{receipts:[{seq:505,state:'complete'}]}})},result('r',{ok:false,error:'未交给模型'})]},rows=requestEntries(r),view=processingEntries(r,rows),links=traceRelations(r,rows,view);assert.match(links.labels.get('qq:505|message:2'),/失败/);assert.equal(view.bySeq.get(505).region,'arrivals');});
test('grouped calls link each QQ reference only to its own result',()=>{const r={messages:[dialogue([{seq:1,text:'一',receiptState:'seen'},{seq:2,text:'二',receiptState:'seen'}]),{role:'assistant',toolCalls:[{id:'a',name:'qq_report_message_receipts'},{id:'b',name:'qq_report_message_receipts'}],text:[{type:'tool-call',id:'a',arguments:{receipts:[{seq:1,state:'seen'}]}},{type:'tool-call',id:'b',arguments:{receipts:[{seq:2,state:'seen'}]}}].map(JSON.stringify).join('\n')},result('a',{ok:true}),result('b',{ok:true})]},rows=requestEntries(r),links=traceRelations(r,rows,processingEntries(r,rows));assert(links.byEntry.get('qq:2').has('message:3'));assert(!links.byEntry.get('qq:2').has('message:2'));});
test('quoted human text remains visible as tool evidence without inventing seq or receipt state',()=>{
 const request={key:'group:12',messages:[{...call('q','qq_reply'),text:JSON.stringify({type:'tool-call',id:'q',arguments:{messageId:'m-500'}})},result('q',{ok:true,key:'group:12',sent:1,quoted:{sender:'群成员',text:'被引用的用户原文'}})]},view=processingEntries(request,requestEntries(request)),quote=view.entries.find(row=>row.kind==='quote');assert.equal(quote.text,'被引用的用户原文');assert.equal(quote.messageId,'m-500');assert.equal(quote.seq,undefined);assert.equal(quote.region,'history');assert.equal(view.records.length,0);
});
test('trusted stable wrapper does not hide human messages or duplicate stable rules as a task',()=>{
 const request={messages:[{...dialogue([{seq:501,text:'用户历史',receiptState:'complete'}]),source:'qq-context-stable',wrappedSource:'qq-context-dialogue',text:'稳定资料\n'+dialogue([{seq:501,text:'用户历史',receiptState:'complete'}]).text}]},view=processingEntries(request,requestEntries(request));assert.equal(view.bySeq.get(501).text,'用户历史');assert.equal(view.entries.find(row=>row.source==='qq-context-stable').text,'稳定资料');assert(!view.entries.find(row=>row.kind==='task').text.includes('稳定资料'));assert.equal(view.entries.find(row=>row.kind==='task').region,'arrivals');
});
test('C36 owns the folded receipt table; receipt metadata never adds another timeline card',()=>{
 const text='【QQ 收件状态】\n'+JSON.stringify({receipts:[{seq:505,receiptState:'seen'},{seq:503,receiptState:'complete'}]});const html=receiptIndexHtml(text);assert.match(html,/收件状态明细 · 2 条/);assert(html.indexOf('<td>503</td>')<html.indexOf('<td>505</td>'));assert.match(html,/已读待处理/);assert.equal(receiptIndexHtml('普通文字'), '');
});
