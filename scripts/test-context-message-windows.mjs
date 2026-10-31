import test from'node:test';import assert from'node:assert/strict';
import{processingEntries}from'../console/layers/O/context-processing.js';import{requestEntries,inspectorHtml}from'../console/layers/O/context-inspector.js';import{dialogueParts,capturedToolResults,waitResultParts}from'../console/layers/O/context-records.js';
const call=(id,name)=>({role:'assistant',toolCalls:[{id,name}],text:JSON.stringify({type:'tool-call',id,name,arguments:{key:'group:12'}})}),result=(id,data)=>({role:'tool',toolResults:[{toolCallId:id}],text:JSON.stringify(data)}),project=messages=>{const r={key:'group:12',messages};return processingEntries(r,requestEntries(r));};
test('historical QQ header restores human messages in the same timeline as the new header',()=>{
 const old={role:'user',source:'qq-context-dialogue',text:'【历史 QQ 消息数据】\n'+JSON.stringify([{seq:505,text:'用户历史',receiptState:'complete'},{isSelf:true,text:'bot历史',dialogueSeq:7}])},fresh={role:'user',source:'qq-context-dialogue',text:'【新增 QQ 消息数据】\n'+JSON.stringify([{seq:506,text:'新来信',receiptState:'seen'}])},v=project([old,fresh]);
 assert.equal(v.bySeq.get(505)?.region,'history');assert.equal(v.bySeq.get(506)?.region,'arrivals');assert.equal(v.entries.filter(x=>x.kind==='qq'&&!x.record.isSelf).length,2);assert(!v.entries.some(x=>x.kind==='incoming'));
});
test('multiple bridge QQ containers preserve quoted marker text and the surrounding task',()=>{
 const first=[{seq:505,text:'原话里有【新增 QQ 消息数据】和 ]',receiptState:'complete'}],second=[{seq:506,text:'未读',receiptState:'unseen'}],m={role:'user',source:'qq-context-dialogue',text:'本次任务\n【历史 QQ 消息数据】\n'+JSON.stringify(first)+'\n【新增 QQ 消息数据】\n'+JSON.stringify(second)+'\n任务尾注'},p=dialogueParts(m);assert.equal(p.history[0].text,first[0].text);assert.equal(p.unread[0].seq,506);assert.match(p.task,/本次任务[\s\S]*任务尾注/);
 assert.equal(dialogueParts({...m,source:'user'}),null);
});
test('direct-array unread tool results leave the tool bubble and appear in pending without guessing read stamps',()=>{
 const v=project([call('u','qq_get_unread_messages'),result('u',[{seq:507,text:'工具读到的未处理原话',sender:'群友'}])]);assert.equal(v.bySeq.get(507)?.region,'arrivals');assert.equal(v.bySeq.get(507)?.receiptState,'pending');assert(!v.bySeq.get(507)?.record.seenAt);assert(!v.bySeq.get(507)?.record.repliedAt);
});
test('nested MCP wait messages use one parser and enter pending with their real receipt seq',()=>{
 const m=result('w',{content:[{type:'text',text:JSON.stringify({ok:true,key:'group:12',arrived:true,newMessages:[{seq:508,text:'等待时收到的新来信'}]})}]}),r={key:'group:12',messages:[call('w','qq_wait_for_messages'),m]},rows=requestEntries(r),v=processingEntries(r,rows);assert.equal(waitResultParts(rows[1])[0]?.data.newMessages[0].seq,508);assert.equal(v.bySeq.get(508)?.region,'arrivals');
});
test('current-session detail messages join pending/history rather than being forced into forwarded history',()=>{
 const v=project([call('d','qq_get_message_detail'),result('d',{ok:true,key:'group:12',info:{seq:509,text:'单条读取的未回复消息',receiptState:'seen',messageId:'m9'}})]);assert.equal(v.bySeq.get(509)?.region,'arrivals');assert(!v.entries.some(x=>x.kind==='forwarded'));
});
test('unknown recent status and failed/cross-session unread tools do not fabricate a pending queue',()=>{
 const v=project([call('r','qq_get_recent_messages'),result('r',[{seq:510,text:'状态未采集的历史'}]),call('e','qq_get_unread_messages'),result('e',{ok:false,messages:[{seq:511,text:'失败结果'}]}),call('x','qq_get_unread_messages'),result('x',{ok:true,key:'private:34',messages:[{seq:512,text:'其他会话'}]})]);assert.equal(v.bySeq.get(510)?.region,'unknown');assert(!v.bySeq.has(511));assert(!v.bySeq.has(512));
});
test('only genuine QQ receipt seq appears as the main number; dialogue and native event numbers are not substitutes',()=>{
 const m={role:'user',source:'qq-context-dialogue',provenance:{eventSeq:9001},text:'【新增 QQ 消息数据】\n'+JSON.stringify([{seq:535,dialogueSeq:3,text:'来信',receiptState:'complete'},{isSelf:true,dialogueSeq:4,text:'旧bot消息'}])},r={key:'group:12',messages:[m]},v=project([m]);assert(!v.records.find(x=>x.record.isSelf).numberLabel.includes('对话序号'));const html=inspectorHtml(r,[],{view:'messages',layout:'business',selected:'qq:535'},{renderText:t=>t,renderComponent:()=>''});assert.match(html,/class="context-sequence-number"[^>]*>535</);assert(!html.includes('class="context-sequence-number">4<'));assert(!html.includes('class="context-sequence-number">9001<'));
});
