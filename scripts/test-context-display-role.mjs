import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectorHtml} from '../console/layers/O/context-inspector.js';
const render={renderText:text=>text,renderComponent:()=>''};
const cases=[
 ['assistant',{role:'assistant',source:'model',text:'模型输出'}],
 ['assistant',{role:'assistant',source:'model',toolCalls:[{id:'call',name:'fixture_read'}]}],
 ['user',{role:'user',source:'user',text:'用户输入'}],
 ['tool',{role:'tool',source:'tool',isError:true,text:'Error: 调用失败'}],
 ['system',{role:'system',source:'system-prompt',text:'系统规则'}],
 ['system',{role:'user',source:'qq-context-task',text:'桥接任务'}],
 ['system',{role:'user',source:'qq-context-tool-history',text:'错误归档'}],
 ['system',{role:'user',source:'repeat-tool-reminder',text:'重复调用提醒'}],
 ['system',{role:'developer',source:'tool-registry',text:'工具变化'}],
 ['developer',{role:'user',source:'qq-context-stable',text:'用户上下文'}],
 ['developer',{role:'user',source:'qq-context-latest',text:'当前动态资料'}],
 ['system',{role:'user',source:'runtime-context',text:'环境资料'}],
 ['developer',{role:'user',source:'compact-checkpoint',text:'压缩后的资料'}],
 ['developer',{role:'user',source:'agent-instructions',text:'应用指令'}],
 ['developer',{role:'developer',source:'custom-context',text:'应用补充'}],
 ['system',{role:'user',source:'qq-context-task',toolCalls:[{id:'program-call',name:'fixture_tool'}]}],
];
test('one English display role follows the producer category without altering native messages',()=>{
 for(const [expected,message]of cases){
  const request={messages:[message]},before=JSON.stringify(request),html=inspectorHtml(request,[],{view:'messages',layout:'raw',selected:'message:0'},render);
  assert.match(html,new RegExp('data-display-role="'+expected+'"'),message.source);
  assert.match(html,new RegExp('<dt>role</dt><dd>'+expected+'</dd>'));
  assert(!html.includes('<dt>消息角色</dt>'));assert(!html.includes('<dt>来源</dt>'));assert(!html.includes('context-protocol-role'));
  assert.equal(JSON.stringify(request),before);
 }
});
test('projected QQ users and bot deliveries receive user and assistant rather than the wrapper role',()=>{
 const request={messages:[{role:'user',source:'qq-context-dialogue',text:'【历史 QQ 消息数据】\n'+JSON.stringify([{seq:10,dialogueSeq:20,sender:'用户',text:'用户来信',receiptState:'complete'},{dialogueSeq:21,isSelf:true,text:'bot已发出'}])}]};
 const html=inspectorHtml(request,[],{view:'messages',layout:'business',selected:'qq:10'},render);
 assert.match(html,/data-inspector-select="qq:10"[^>]*data-display-role="user"/);
 assert.match(html,/data-inspector-select="qq:dialogue:21"[^>]*data-display-role="assistant"/);
 assert.match(html,/<dt>role<\/dt><dd>user<\/dd>/);
 assert.match(html,/data-dialogue-seq="20"/);assert.match(html,/data-dialogue-seq="21"/);
});
test('role filter exposes five categories and separates assistant tool calls from tool results',()=>{
 const request={messages:[{role:'assistant',source:'model',toolCalls:[{id:'c',name:'read'}]},{role:'tool',source:'tool',toolResults:[{toolCallId:'c'}],text:'返回'}]};
 const html=inspectorHtml(request,[],{view:'messages',layout:'raw',kind:'tool'},render);
 assert(!html.includes('data-inspector-select="message:0"'));assert(html.includes('data-inspector-select="message:1"'));
 for(const value of ['assistant','user','tool','system','developer'])assert(html.includes('<option value="'+value+'"'));
 assert(!html.includes('<option value="result"'));
});
