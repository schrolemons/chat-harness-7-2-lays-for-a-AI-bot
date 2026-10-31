import test from'node:test';import assert from'node:assert/strict';import{failureHistoryPlan}from'../plugins/qq-components/obs-context-assembly/failure-history.mjs';
const pair=(n,error=true,name='mcp__snowluma__qq_send_message')=>[{seq:n*2+1,message:{id:'a'+n,role:'assistant',content:[{type:'tool-call',id:'c'+n,name,arguments:'{"messages":"未发送内容"}'}]}},{seq:n*2+2,message:{id:'r'+n,role:'tool',toolCallId:'c'+n,isError:error,content:[{type:'text',text:error?'Error: 本轮发送额度已用完':'{"ok":true,"sent":1}'}]}}];
test('hundreds of definite send-limit failures collapse while recent pairs and real successful sends remain',()=>{
 const rows=Array.from({length:259},(_,i)=>pair(i)).flat(),before=JSON.stringify(rows),plan=failureHistoryPlan(rows);assert.equal(plan.groups[0].count,257);assert.equal(plan.removeSeqs.length,514);assert.equal(plan.retainedFailures,2);assert.equal(JSON.stringify(rows),before);assert(!plan.removeSeqs.includes(518));assert.deepEqual(failureHistoryPlan(pair(0,false)).removeSeqs,[]);
});
test('single read failure, arbitrary user quotes, unpaired calls and partially delivered batches remain',()=>{
 const rows=[...pair(0,true,'qq_get_unread_messages'),{seq:9,message:{role:'user',content:[{type:'text',text:'Error: 本轮发送额度已用完'}]}},...pair(10,false)];assert.equal(failureHistoryPlan(rows).removeSeqs.length,0);const partial=pair(1);partial[1].message.content[0].text='{"ok":false,"sent":1,"error":"turn_limit"}';assert.equal(failureHistoryPlan(partial,{keep:0}).removeSeqs.length,0);
});

test('repeated read-tool errors also retain only their latest two real call/result pairs',()=>{const rows=Array.from({length:10},(_,i)=>pair(i,true,'mcp__snowluma__qq_get_unread_messages')).flat();const plan=failureHistoryPlan(rows);assert.equal(plan.retainedFailures,2);assert.equal(plan.removeSeqs.length,16);});

test('request projection merges summaries and preserves original error events and newest pairs',async()=>{
 const {compactFailedToolHistory}=await import('../plugins/qq-components/obs-context-assembly/failure-history.mjs');const {replaceSurface}=await import('../plugins/qq-components/obs-context-assembly/history.mjs');
 let seq=100;const source=Array.from({length:10},(_,i)=>pair(i)).flat();const events=new Map(source.map(r=>[r.seq,{seq:r.seq,type:r.message.role==='assistant'?'assistant/message':'tool/result',data:{message:r.message}}]));const original=JSON.stringify([...events.values()]);const nodes=source.map(r=>r.seq);const boundary={type:'step/start',data:{turn:1,step:1}};
 const session={surface:{nodes},eventAt:n=>events.get(n),snapshotEvents:()=>[...events.values(),boundary],append(type,data,intent){const event={seq:++seq,type,data};events.set(seq,event);const i=nodes.indexOf(intent.surfaceOp.startSeq);nodes.splice(i,1,seq);return event;}};
 compactFailedToolHistory(session,{turn:1,step:1},replaceSurface);const summary=()=>nodes.map(n=>events.get(n)).filter(e=>e.data.source?.kind==='qq-context-tool-history');assert.equal(summary().length,1);assert.equal(summary()[0].data.source.count,8);assert.equal(JSON.stringify([...events.values()].slice(0,source.length)),original);
 for(const row of pair(40)){events.set(row.seq,{seq:row.seq,type:row.message.role==='assistant'?'assistant/message':'tool/result',data:{message:row.message}});nodes.push(row.seq);}compactFailedToolHistory(session,{turn:1,step:1},replaceSurface);assert.equal(summary().length,1);assert.equal(summary()[0].data.source.count,9);
});
