import test from 'node:test';import assert from 'node:assert/strict';
import {failureHistoryPlan,compactFailedToolHistory} from '../plugins/qq-components/obs-context-assembly/failure-history.mjs';
import {replaceSurface} from '../plugins/qq-components/obs-context-assembly/history.mjs';
const pair=(n,error=true,name='qq_reply')=>[{seq:n*2+1,message:{id:'a'+n,role:'assistant',source:{kind:'model'},content:[{type:'tool-call',id:'c'+n,name,arguments:JSON.stringify({message:'尝试'+n})}]}},{seq:n*2+2,message:{id:'r'+n,role:'tool',source:{kind:'tool',callId:'c'+n},toolCallId:'c'+n,isError:error,content:[{type:'text',text:error?'Error: 失败'+n:'{"ok":true,"sent":1}'}]}}];
test('only three or more consecutive failures collapse to the latest real pair',()=>{
 assert.equal(failureHistoryPlan([...pair(0),...pair(1)]).groups.length,0);
 const rows=[...pair(0),...pair(1),...pair(2)],before=JSON.stringify(rows),plan=failureHistoryPlan(rows);
 assert.equal(plan.groups.length,1);assert.equal(plan.groups[0].count,3);assert.deepEqual(plan.removeSeqs,[1,2,3,4]);assert.equal(plan.groups[0].last.callId,'c2');assert.equal(JSON.stringify(rows),before);
});
test('successes, other tools, different failures, real inputs and concurrent calls split runs',()=>{
 for(const middle of [pair(2,false),pair(2,true,'other_tool'),[{seq:50,message:{role:'user',source:{kind:'user'},content:[{type:'text',text:'新需求'}]}}]])assert.equal(failureHistoryPlan([...pair(0),...pair(1),...middle,...pair(3),...pair(4)]).groups.length,0);
 const different=pair(2);different[1].message.content[0].text='{"ok":false,"code":"OTHER_ERROR"}';assert.equal(failureHistoryPlan([...pair(0),...pair(1),...different,...pair(3)]).groups.length,0);
 const concurrent=[pair(0)[0],pair(1)[0],pair(0)[1],pair(1)[1],...pair(2)];assert.equal(failureHistoryPlan(concurrent).groups.length,0);
});
test('three failures followed by success preserve both final failed and successful pairs',()=>{
 const rows=[...pair(0),...pair(1),...pair(2),...pair(3,false)],plan=failureHistoryPlan(rows);assert.deepEqual(plan.removeSeqs,[1,2,3,4]);assert(!plan.removeSeqs.includes(5));assert(!plan.removeSeqs.includes(7));
 const partial=pair(4);partial[1].message.content[0].text='{"ok":false,"sent":1,"error":"partial"}';assert.equal(failureHistoryPlan([...pair(0),...pair(1),...partial]).groups.length,0);
});
test('native reduction keeps roles and call IDs, records attempts, stays idempotent and counts new failures',()=>{
 let next=100;const rows=[...pair(0),...pair(1),...pair(2)],events=new Map(rows.map(row=>[row.seq,{seq:row.seq,type:row.message.role==='assistant'?'assistant/message':'tool/result',data:{message:row.message}}])),nodes=rows.map(row=>row.seq),original=JSON.stringify([...events.values()]);
 const boundary={type:'step/start',data:{turn:1,step:1}},session={surface:{nodes},eventAt:seq=>events.get(seq),snapshotEvents:()=>[...events.values(),boundary],append(type,data,intent){const e={seq:++next,type,data,...intent};events.set(e.seq,e);nodes.splice(nodes.indexOf(intent.surfaceOp.startSeq),1,e.seq);return e;}};
 compactFailedToolHistory(session,{turn:1,step:1},replaceSurface);
 const visible=()=>nodes.map(seq=>events.get(seq)).filter(e=>(e.data.message||e.data).content.length);
 assert.deepEqual(visible().map(e=>(e.data.message||e.data).role),['assistant','tool']);assert.equal(visible()[1].data.message.toolCallId,'c2');assert.equal(visible()[1].data.message.source.failureRun.count,3);assert.equal(visible()[1].data.message.content[0].text,'Error: 失败2');assert.equal(JSON.stringify([...events.values()].slice(0,rows.length)),original);
 const after=events.size;compactFailedToolHistory(session,{turn:1,step:1},replaceSurface);assert.equal(events.size,after);
 for(const row of pair(40)){events.set(row.seq,{seq:row.seq,type:row.message.role==='assistant'?'assistant/message':'tool/result',data:{message:row.message}});nodes.push(row.seq);}compactFailedToolHistory(session,{turn:1,step:1},replaceSurface);
 assert.equal(visible().length,2);assert.equal(visible()[1].data.message.source.failureRun.count,4);assert.equal(visible()[1].data.message.toolCallId,'c40');assert(!visible().some(e=>(e.data.message||e.data).source?.kind==='qq-context-tool-history'));
});
