import test from 'node:test';
import assert from 'node:assert/strict';
import {attributeText,attributeMessage,unmatchedLabel,partLabel,messageLabel} from '../console/layers/O/context-attribution.js';

test('exact source frames cover the original text once, including repeated occurrences and unmatched wrappers',()=>{
 const text='前缀\n事实原文\n\n状态原文\n事实原文\n尾部 <script>';
 const modules=[{id:'facts',name:'重要事实',text:'事实原文'},{id:'state',name:'心情',text:'状态原文'}];
 const before=JSON.stringify(modules),segments=attributeText(text,modules,modules);
 assert.equal(segments.map(s=>s.text).join(''),text);
 assert.deepEqual(segments.filter(s=>s.owners.length).map(s=>s.owners[0].number),[1,2,1]);
 assert.equal(JSON.stringify(modules),before);
});
test('split snapshot parts retain one component identity and never attribute by a loose similarity',()=>{
 const modules=[{id:'message-snapshot',name:'消息与收件',text:'旧合并快照',parts:[{name:'收件状态',text:'收件数据'},{name:'新增聊天原文',text:'新增原话'}]}];
 const catalog=Array.from({length:36},(_,i)=>({id:i===35?'message-snapshot':'slot-'+i,name:'组件'+i}));
 const rows=attributeText('收件数据\n新增原话\n旧合并快照\n收件信息',modules,catalog);
 assert.deepEqual(rows.filter(s=>s.owners.length).map(s=>[s.owners[0].number,s.owners[0].part]),[[36,'收件状态'],[36,'新增聊天原文']]);
 assert(rows.at(-1).text.includes('收件信息'));assert.equal(rows.at(-1).owners.length,0);
});
test('longer exact ranges win over nested matches; identical owners stay visible rather than arbitrarily assigned',()=>{
 const modules=[{id:'short',text:'短句'},{id:'long',text:'完整短句正文'},{id:'same',text:'完整短句正文'}];
 const segments=attributeText('完整短句正文',modules,modules);
 assert.equal(segments.length,1);assert.deepEqual(segments[0].owners.map(x=>x.id),['long','same']);
 assert.equal(attributeText('无依据',modules,modules)[0].owners.length,0);
});
test('message labels distinguish bot generation, tool actions, QQ input, runtime and summary',()=>{
 assert.match(messageLabel({role:'assistant'}),/bot 生成/);
 assert.match(messageLabel({role:'assistant',toolCalls:[{name:'qq_send_message'}]}),/工具调用/);
 assert.match(messageLabel({role:'tool'}),/工具返回/);
 assert.match(messageLabel({role:'user',source:'qq-context-dialogue'}),/QQ 来信/);
 assert.match(messageLabel({role:'user',source:'compact-checkpoint'}),/压缩摘要/);
 assert.match(messageLabel({role:'user',source:'runtime-context'}),/运行环境/);
});
test('component destination labels describe the content and where it is placed',()=>{
 assert.equal(partLabel({id:'receipt-state',name:'收件状态',destination:'background'}),'收件处理进度（放入背景资料）');
 assert.equal(partLabel({id:'new-messages',name:'新增聊天原文',destination:'task'}),'新增聊天原文（随本轮任务提供）');
 assert.equal(partLabel({name:'额外说明',destination:'background'}),'额外说明（放入背景资料）');
});
test('mood style placed in the system prompt retains its component 05 source identity',()=>{
 const catalog=Array.from({length:5},(_,i)=>({id:i===0?'role-card':i===4?'ctx-context-dynamics':'slot-'+i,name:i===4?'心情与表情策略':'人设'}));
 const modules=[{id:'role-card',name:'角色与风格',parts:[{id:'role-card:original',text:'原始人设'},{id:'ctx-context-dynamics:expression',name:'选中风格',text:'当前心情60，普通形态'}]}];
 const segments=attributeText('原始人设\n当前心情60，普通形态',modules,catalog).filter(row=>row.owners.length);
 assert.deepEqual(segments.map(row=>row.owners[0].number),[1,5]);assert.equal(segments[1].owners[0].id,'ctx-context-dynamics');
});
test('historical QQ JSON is annotated as C36 without absorbing task wrappers or using the current snapshot',()=>{
 const catalog=Array.from({length:36},(_,i)=>({id:i===35?'message-snapshot':'slot-'+i,name:'组件'+i}));
 const raw='【新增 QQ 消息数据】\n'+JSON.stringify([{seq:18,text:'原话里有 ] 和 \\" 引号',userId:'123'}]);
 const message={role:'user',source:'qq-context-dialogue',text:'【QQ 回合 message】\n请处理来信\n'+raw+'\n后续说明'};
 const before=JSON.stringify(message),rows=attributeMessage(message,[],catalog);
 assert.equal(rows.map(row=>row.text).join(''),message.text);
 const owned=rows.filter(row=>row.owners.length);assert.equal(owned.length,1);assert.equal(owned[0].text,raw);
 assert.equal(owned[0].owners[0].number,36);assert.equal(owned[0].owners[0].id,'message-snapshot');
 assert.match(owned[0].owners[0].evidence,/来源标记/);assert.equal(JSON.stringify(message),before);
 for(const source of ['user','compact-checkpoint','runtime-context'])assert.equal(attributeMessage({...message,source},[],catalog).filter(row=>row.owners.length).length,0);
 assert.equal(attributeMessage({...message,role:'tool'},[],catalog).filter(row=>row.owners.length).length,0);
 assert.equal(attributeMessage({...message,text:'【新增 QQ 消息数据】\n[{"text":"无消息身份"}]'},[],catalog).filter(row=>row.owners.length).length,0);
 assert.equal(attributeMessage({...message,text:'【新增 QQ 消息数据】\n[broken'},[],catalog).filter(row=>row.owners.length).length,0);
});
test('legacy chat and receipt headers require a matching producer and preserve their text',()=>{
 const raw='【历史 QQ 消息数据】\n[{"seq":1,"text":"旧话"}]';
 assert.equal(attributeMessage({role:'user',source:'qq-context-dialogue',text:raw})[0].owners[0].id,'message-snapshot');
 const receipt='【QQ 收件状态】\n{"unreadCount":2,"receipts":[{"seq":1}]}';
 assert.equal(attributeMessage({role:'user',source:'qq-context-current',text:receipt})[0].owners[0].part,'收件状态');
 assert.equal(attributeMessage({role:'user',source:'qq-context-dialogue',text:receipt})[0].owners.length,0);
 const older='【新增 QQ 消息数据】\n[{"sender":"甲","at":123456,"text":"旧版近期聊天","isSelf":false}]';
 assert.equal(attributeMessage({role:'user',source:'qq-context-dialogue',text:older})[0].owners[0].id,'message-snapshot','legacy recent chat does not require a fabricated QQ ID or seq');
 const clock='【新增 QQ 消息数据】\n[{"sender":"甲","at":"10-29 23:58","text":"compactModelMessage 的日期格式"}]';
 assert.equal(attributeMessage({role:'user',source:'qq-context-dialogue',text:clock})[0].owners[0].id,'message-snapshot');
 assert.equal(attributeMessage({role:'user',source:'qq-context-dialogue',text:clock.replace('10-29 23:58','不是时间')})[0].owners.length,0);
});
test('known records get their actual type instead of being called unassigned components',()=>{
 assert.match(unmatchedLabel({role:'system',source:'system-prompt'}).title,/DSH 系统/);
 assert.match(unmatchedLabel({role:'user',source:'compact-checkpoint'}).title,/压缩摘要/);
 assert.match(unmatchedLabel({role:'tool'}).title,/工具返回/);
 assert.match(unmatchedLabel({role:'assistant',toolCalls:[{}]}).title,/工具调用/);
 assert.match(unmatchedLabel({role:'user',source:'qq-context-dialogue'}).title,/回合/);
 assert.match(unmatchedLabel({role:'user',source:'foreign'}).title,/未记录/);
});
