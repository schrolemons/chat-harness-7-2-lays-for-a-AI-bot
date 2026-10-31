import test from'node:test';import assert from'node:assert/strict';import{extractToolDeliveries,extractForwardMessages}from'../console/layers/O/context-deliveries.js';
const call=(id,name,args)=>({key:'c:'+id,position:1,toolCalls:[{id,name}],text:JSON.stringify({type:'tool-call',id,name,arguments:args})});
const result=(id,data,isError=false)=>({key:'r:'+id,position:2,role:'tool',toolResults:[{toolCallId:id}],isError,text:JSON.stringify(data)});
test('confirmed reply exposes bot text, quotation and actual destination without inventing seq',()=>{
 const rows=[call('a','qq_reply',{key:'group:12',messageId:'m1',text:'给你的回复'}),result('a',{ok:true,key:'group:12',sent:1,failed:0,quoted:{sender:'成员',text:'原话'}})],items=extractToolDeliveries({key:'group:12'},rows);assert.equal(items.length,1);assert.equal(items[0].text,'给你的回复');assert.equal(items[0].targetKey,'group:12');assert.equal(items[0].quoted.text,'原话');assert.equal(items[0].seq,undefined);assert.equal(items[0].verified,true);
});
test('forwarded conversation bodies are extracted with provenance and never become current-session receipt seqs',()=>{
 const rows=[call('a','qq_get_forward_msg',{key:'group:12',id:'forward-1'}),result('a',{ok:true,key:'group:12',fromKey:'private:34',messages:[{seq:7,sender:{nickname:'来自私聊的成员'},text:'转发原话',messageId:'m7'}]})],items=extractForwardMessages({key:'group:12'},rows);assert.equal(items.length,1);assert.equal(items[0].originalSeq,7);assert.equal(items[0].seq,undefined);assert.equal(items[0].sourceKey,'private:34');assert.equal(items[0].text,'转发原话');
});
test('cross-session send labels source and destination; failed and ambiguous partial sends stay tool evidence',()=>{
 const request={key:'group:12'},rows=[call('a','qq_send_message',{key:'private:34',messages:['转达给你']}),result('a',{ok:true,key:'private:34',sent:1,failed:0}),call('b','qq_send_message',{key:'group:12',messages:['一','二']}),result('b',{ok:true,sent:1,failed:1}),call('c','qq_send_message',{key:'group:12',messages:'失败'}),result('c',{ok:false,error:'turn_limit'},true)];const items=extractToolDeliveries(request,rows);assert.equal(items.length,1);assert.equal(items[0].sourceKey,'group:12');assert.equal(items[0].targetKey,'private:34');assert.equal(items[0].crossSession,true);
});
test('scheduled followup queued is not delivered; actual successful followup is extracted',()=>{
 const request={key:'group:12'},rows=[call('a','private_followup_send',{groupKey:'group:12',userId:'34',text:'私聊跟进'}),result('a',{ok:true,queued:true,sent:false}),call('b','private_followup_send',{groupKey:'group:12',userId:'34',text:'实际跟进'}),result('b',{ok:true,sent:true})];assert.deepEqual(extractToolDeliveries(request,rows).map(row=>row.text),['实际跟进']);
});

test('native legacy reply and private tools use their real message and replyToMessageId fields',()=>{
 const rows=[call('r','mcp__snowluma__qq_reply',{groupId:'12',replyToMessageId:'-41',message:'引用后的回答'}),result('r',{ok:true,key:'group:12',sent:1,failed:0,quoted:{sender:{nickname:'群友'},text:'你是谁'}}),call('p','qq_send_private_message',{userId:'34',message:'【传话】来自群友：你好'}),result('p',{ok:true,key:'private:34',sent:1,failed:0})];
 const items=extractToolDeliveries({key:'group:12'},rows);assert.equal(items.length,2);assert.equal(items[0].quoteMessageId,'-41');assert.equal(items[1].targetKey,'private:34');assert.equal(items[1].text,'【传话】来自群友：你好');
});

test('real message-detail info and foreign-session read results are extracted without taking their receipt seq',()=>{
 const rows=[call('d','qq_get_message_detail',{key:'private:34',messageId:'m8'}),result('d',{ok:true,key:'private:34',info:{seq:508,sender:'好友',text:'原消息',messageId:'m8',textTruncated:true}}),call('x','qq_get_recent_messages',{key:'group:56'}),result('x',{ok:true,key:'group:56',messages:[{seq:91,sender:'群成员',text:'白名单群聊原话'}]})];
 const items=extractForwardMessages({key:'group:12'},rows);assert.equal(items.length,2);assert.equal(items[0].text,'原消息');assert.equal(items[0].originalSeq,508);assert.equal(items[0].sourceKey,'private:34');assert.equal(items[0].seq,undefined);assert.equal(items[0].textTruncated,true);assert.equal(items[1].sourceKey,'group:56');
});

test('nested forward previews retain container origin and are not presented as current-session new input',()=>{
 const rows=[call('f','qq_get_forward_msg',{key:'group:12',id:'f1'}),result('f',{ok:true,key:'group:12',id:'f1',messages:[{sender:'甲',text:'第一层'}],nestedPreviews:[{id:'f2',messages:[{sender:'乙',text:'嵌套消息',messageSeq:'65'}]},{id:'f3',error:'cannot read'}]})];
 const items=extractForwardMessages({key:'group:12'},rows);assert.equal(items.length,2);assert.equal(items[1].forwardId,'f2');assert.equal(items[1].originalMessageSeq,'65');assert(items.every(row=>row.region==='history'&&row.seq===undefined));
});

test('unmatched, queued, zero-sent and malformed tool outcomes never become bot speech',()=>{
 const rows=[call('a','qq_send_message',{messages:'未执行'}),call('b','qq_send_message',{messages:'未发送'}),result('b',{ok:true,sent:0,failed:1}),call('c','qq_send_message',{messages:'只返回ok'}),result('c',{ok:true})];assert.equal(extractToolDeliveries({key:'group:12'},rows).length,0);
});

test('display normalization follows the sending tool, preserving literal legacy JSON and followup text',()=>{
 const rows=[call('a','qq_send_message',{key:'group:12',messages:'"你好"'}),result('a',{ok:true,sent:1}),call('b','qq_reply',{groupId:'12',message:'["这是原话"]'}),result('b',{ok:true,sent:1}),call('c','private_followup_send',{userId:'34',text:'"保留引号"'}),result('c',{ok:true,sent:true})];
 assert.deepEqual(extractToolDeliveries({key:'group:12'},rows).map(row=>row.text),['你好','["这是原话"]','"保留引号"']);
});
