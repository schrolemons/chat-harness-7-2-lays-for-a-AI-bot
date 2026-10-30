import test from'node:test';import assert from'node:assert/strict';import{timelineEntries,timelinePreview}from'../console/layers/O/context-timeline.js';
test('single history feed interleaves QQ records and all tools by captured position',()=>{
 const rows=[{key:'second-chat',kind:'qq',region:'history',position:6,displaySeq:2},{key:'memory-return',kind:'result',region:'history',position:5},{key:'first-chat',kind:'qq',region:'history',position:2,displaySeq:1},{key:'memory-call',kind:'call',region:'history',position:4},{key:'internal',kind:'assistant',region:'history',position:3}];const before=JSON.stringify(rows);assert.deepEqual(timelineEntries(rows).map(row=>row.key),['first-chat','internal','memory-call','memory-return','second-chat']);assert.equal(JSON.stringify(rows),before);
});
test('pending QQ remains separate with bridge task first and original seq ordering',()=>{
 const rows=[{key:'pending-506',kind:'qq',region:'arrivals',position:2,displaySeq:2},{key:'task',kind:'task',region:'arrivals',position:8},{key:'pending-505',kind:'qq',region:'arrivals',position:6,displaySeq:1},{key:'history-tool',kind:'call',region:'history',position:5}];assert.deepEqual(timelineEntries(rows).map(row=>row.key),['history-tool','task','pending-505','pending-506']);
});
test('tool summaries explain the action without treating it as QQ chat or claiming success',()=>{
 assert.equal(timelinePreview({kind:'call',toolCalls:[{name:'mcp__whale__qq_memory_append'}]}),'更新会话记忆');assert.equal(timelinePreview({kind:'qq',text:'第一行\n第二行'}),'第一行\n第二行');assert.match(timelinePreview({kind:'result',isError:true,text:'Error: 保存失败'}),/工具返回失败/);assert.match(timelinePreview({kind:'result',text:'{"ok":true}'}),/工具已返回/);
});
