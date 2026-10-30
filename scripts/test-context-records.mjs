import test from 'node:test';import assert from 'node:assert/strict';
import * as view from '../plugins/qq-components/obs-context-assembly/request-view.mjs';
import {dialogueParts,inputOrigin,recordDetails} from '../console/layers/O/context-records.js';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {zstdCompressSync} from 'node:zlib';
import {readMessageProvenance,enrichRequestProvenance} from '../plugins/qq-components/obs-context-assembly/provenance.mjs';
test('mixed QQ batches render bot messages without seq as readable cards',()=>{
 const message={role:'user',source:'qq-context-dialogue',text:'【新增 QQ 消息数据】\n'+JSON.stringify([{sender:'我',text:'bot回复',isSelf:true,at:'23:49'},{sender:'用户',text:'用户来信',seq:2,receiptState:'seen'}])};
 assert(dialogueParts(message));const html=recordDetails(message);assert.equal((html.match(/class="context-qq-message(?: is-self)?"/g)||[]).length,2);assert.match(html,/23:49/);assert.match(html,/bot回复/);
});
test('wait results separate recorded decisions, action advice and QQ messages without inventing outcomes',()=>{
 const result={ok:true,arrived:false,endRound:false,probabilityPercent:50,emptyWaits:1,action:'newTopic',guidance:'说一个<script>新话题',hint:'说一个<script>新话题',newMessages:[{seq:7,text:'hi <b>there</b>',receiptState:'seen'}]};
 const message={kind:'result',role:'tool',toolResults:[{name:'mcp__qq__qq_wait_for_messages',toolCallId:'w'}],text:JSON.stringify({type:'tool-result',toolCallId:'w',content:JSON.stringify(result)})},before=JSON.stringify(message);
 const html=recordDetails(message);
 for(const term of ['等待判定','继续本轮','50%','下一步行动建议','开启新话题','工具返回的 QQ 消息','7','&lt;script&gt;','&lt;b&gt;'])assert(html.includes(term),term);
 assert.equal(html.split('说一个&lt;script&gt;新话题').length-1,1,'identical hint and guidance shown once');
 assert.equal(JSON.stringify(message),before);
 assert(!recordDetails({...message,role:'user',kind:'incoming',toolResults:[]}).includes('等待判定'));
 assert(!recordDetails({...message,text:'malformed'}).includes('等待判定'));
 assert(!recordDetails({...message,toolResults:[{name:'another_tool',toolCallId:'w'}]}).includes('等待判定'));
 const ended=recordDetails({...message,text:JSON.stringify({...result,endRound:true,probabilityPercent:0})});assert.match(ended,/结束本轮/);assert.match(ended,/0%/);
 const arrived=recordDetails({...message,text:JSON.stringify({arrived:true,endRound:false,hint:'先看新来信'})});assert.match(arrived,/处理收到的来信/);assert(!arrived.includes('未记录行动分支'));
});
test('tool definition changes expose names and block meaning without leaking image or reasoning payloads',()=>{
 const message={content:[{type:'tool-addition',toolName:'qq_schedule'},{type:'tool-removal',toolName:'old_tool'},{type:'image',data:'private-image-body'},{type:'reasoning',text:'private-thought'}]};
 const before=JSON.stringify(message),text=view.previewRequestMessage(message);
 assert.match(text,/新增.*qq_schedule/s);assert.match(text,/移除.*old_tool/s);
 assert(!text.includes('private-image-body'));assert(!text.includes('private-thought'));assert.equal(JSON.stringify(message),before);
});
test('dialogue partitions preserve every row and distinguish captured unread facts from unknown status',()=>{
 const rows=[{seq:1,text:'历史',receiptStatus:'complete'},{seq:2,text:'未读',read:false},{seq:3,text:'未知'}],message={role:'user',source:'qq-context-dialogue',text:'【QQ 回合 probability】\n程序任务\n【新增 QQ 消息数据】\n'+JSON.stringify(rows)};
 const before=JSON.stringify(message),parts=dialogueParts(message);
 assert.deepEqual(parts.history,[rows[0]]);assert.deepEqual(parts.unread,[rows[1]]);assert.deepEqual(parts.unknown,[rows[2]]);assert.equal(JSON.stringify(message),before);
 assert.equal(dialogueParts({...message,source:'user'}),null);assert.equal(dialogueParts({...message,text:'【新增 QQ 消息数据】\nnot JSON'}),null);
 const html=recordDetails(message);assert.match(html,/C39/);assert.match(html,/QQ 未处理消息/);assert.match(html,/群聊普通消息通过概率判定/);
 const historical=recordDetails({...message,region:'history',currentInput:false});assert(!historical.includes('未读 QQ 消息（当时）'));assert.match(historical,/QQ 历史消息/);
});
test('old closing reminder is recognized with explicit evidence limits; ordinary user remains unassigned',()=>{
 const message={role:'user',source:'user',text:'【当前时间】2026/10/30\n【会话令牌】hidden\n【提醒】你还没有完成回合收尾'};
 assert.match(inputOrigin(message).title,/桥接收尾提醒/);assert.match(inputOrigin(message).evidence,/原记录没有/);
 assert.match(inputOrigin({role:'user',source:'user',text:'普通输入'}).description,/不能据此认定是 QQ/);
});
test('native provenance restores exact tool names and event references without reading prompt data into the UI',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-provenance-'));try{
  const home=path.join(root,'home'),id='session-11111111-1111-1111-1111-111111111111',dir=path.join(home,'sessions','fixture',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(root,'workspace.local.json'),JSON.stringify({dshHome:home}));
  const events=[{seq:4,type:'developer/message',time:123,data:{headerSeq:3,message:{id:'registry',source:{kind:'tool-registry'},content:[{type:'tool-addition',toolName:'fixture_read'},{type:'tool-removal',toolName:'old_read'}]}}},{seq:5,type:'agent/inbox/spliced',time:124,data:{inserted:[{id:'input',source:{kind:'user'},content:[{type:'text',text:'PRIVATE_TEXT_NOT_TO_RETURN'}]}]}}];
  events.push({seq:6,type:'tool/result',data:{message:{id:'native-tool',role:'tool',toolCallId:'call-native',source:{kind:'tool',callId:'call-native'},content:[{type:'text',text:'PRIVATE_TOOL_TEXT_NOT_TO_RETURN'}]}}});
  const file=path.join(dir,'session.v4.jsonl.zstd');fs.writeFileSync(file,zstdCompressSync(Buffer.from(events.map(e=>JSON.stringify(e)).join('\n')+'\n')));const bytes=fs.readFileSync(file),metadata=readMessageProvenance(root,id);
  assert.deepEqual(metadata.get('native-tool')?.toolResults,[{toolCallId:'call-native'}]);assert(!JSON.stringify([...metadata]).includes('PRIVATE_TOOL_TEXT_NOT_TO_RETURN'));
  const native=enrichRequestProvenance(root,{sessionId:id,messages:[{id:'native-tool',role:'tool',toolResults:[]}]});assert.deepEqual(native.messages[0].toolResults,[{toolCallId:'call-native'}]);
  assert.equal(metadata.get('registry').headerSeq,3);assert.deepEqual(metadata.get('registry').toolChanges.map(c=>c.toolName),['fixture_read','old_read']);assert.equal(metadata.get('input').eventSeq,5);
  assert(!JSON.stringify([...metadata]).includes('PRIVATE_TEXT_NOT_TO_RETURN'));
  const request={sessionId:id,messages:[{id:'registry',source:'tool-registry',text:'【tool-addition · 非文本载荷】'}]},before=JSON.stringify(request),enriched=enrichRequestProvenance(root,request);
  assert.equal(JSON.stringify(request),before);assert.match(recordDetails(enriched.messages[0]),/fixture_read/);assert.deepEqual(fs.readFileSync(file),bytes);
  assert.equal(readMessageProvenance(root,'../outside').size,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
