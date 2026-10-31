import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{resolveInspectorTarget}from'../console/layers/O/context-navigation.js';
const request={messages:[{role:'system',text:'系统规则'},{role:'user',source:'qq-context-dialogue',text:'【新增 QQ 消息数据】\n'+JSON.stringify([{seq:505,text:'用户的历史',receiptState:'complete'},{seq:506,text:'待处理原话',receiptState:'seen'}])},{role:'assistant',toolCalls:[{id:'r',name:'qq_mood'}]},{role:'tool',toolResults:[{toolCallId:'r'}],text:'{"ok":true}'}]};
test('source navigation resolves consumed wrappers to real QQ cards and preserves exact preferred seq',()=>{
 assert.equal(resolveInspectorTarget(request,'message:1'),'qq:505');assert.equal(resolveInspectorTarget(request,'message:1','qq:506'),'qq:506');assert.equal(resolveInspectorTarget(request,'message:3'),'message:3');assert.equal(resolveInspectorTarget(request,'qq:506'),'qq:506');assert.equal(resolveInspectorTarget(request,'message:99'),null);
});
test('retired visual entry points and implicit raw-mode navigation are absent',()=>{
 const source=fs.readFileSync(new URL('../console/layers/O/context-visual.js',import.meta.url),'utf8');assert(!source.includes("inspectorState.layout='raw'"));assert(!source.includes('actual-'));assert(!source.includes('requestIndex'));assert(!fs.existsSync(new URL('../console/layers/O/context-request.js',import.meta.url)));
 const processing=fs.readFileSync(new URL('../console/layers/O/context-processing.js',import.meta.url),'utf8');assert(!processing.includes('focusedTraceEdges'));assert(!processing.includes('context-track-anchor'));
});
