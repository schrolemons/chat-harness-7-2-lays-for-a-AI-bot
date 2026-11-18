import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createTokenLedger} from '../src/token-ledger.js';
const at=Date.parse('2026-11-13T11:00:00+08:00');
const summary=(seq,provider)=>({seq,time:at+seq,type:'compaction/summary',data:{compactionId:'compact-'+seq,llmStreamCall:true,provider,model:'deepseek-flash',usage:{inputTokens:10000,outputTokens:1000}}});
function fixture(t,options={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'summary-usage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'ledger.jsonl');return {file,ledger:createTokenLedger({file,resolveKey:()=> 'group:1',...options})};}
test('auxiliary compaction uses its actual provider, remains separate from chat, and survives replay',t=>{
 const {file,ledger}=fixture(t),paid=summary(10,'deepseek-official'),free=summary(20,'ustc');
 ledger.ingestEvent({sessionId:'s',event:{seq:1,type:'model/selection',data:{provider:'ustc',model:'other'}}});
 assert(ledger.ingestEvent({sessionId:'s',event:paid}));assert(ledger.ingestEvent({sessionId:'s',event:free}));assert(!ledger.ingestEvent({sessionId:'s',event:paid}));
 assert.equal(ledger.summary().totals.totalTokens,22000);assert(ledger.summary().totals.cost>0);
 assert.equal(ledger.summary().totals.turns,0,'auxiliary calls are not QQ reply turns');assert.equal(ledger.periodUsage({since:at,until:at+1000}).turns,0);
 const rows=ledger.recent();assert.equal(rows.length,2);assert(rows.every(r=>r.kind==='compaction'));assert.equal(rows.find(r=>r.provider==='ustc').cost,0);
 const cost=ledger.summary().totals.cost,reloaded=createTokenLedger({file,resolveKey:()=> 'group:1'});assert.equal(reloaded.summary().totals.cost,cost);assert(reloaded.recent().every(r=>r.kind==='compaction'));
 assert.equal(reloaded.ingestSnapshotRecords({sessionId:'s',records:[paid,free]}),0);assert.equal(reloaded.summary().totals.totalTokens,22000);
 // Native tokenUsage contains ordinary assistant requests, not compaction.
 ledger.ingestBaseline({sessionId:'s',projection:{asOfSeq:20,values:{tokenUsage:{inputTokens:1000,outputTokens:0}}},at:at+30});assert.equal(ledger.summary().totals.totalTokens,23000);assert.equal(ledger.summary().totals.cost,cost);
 assert.equal(ledger.series({hours:1,at:at+1000}).totals.tokens+ledger.series({hours:1,at:at+1000}).offChartTokens,23000);
});
test('evicted auxiliary tokens stay outside native baselines and do not charge again on replay',t=>{
 const {file,ledger}=fixture(t,{maxLines:2}),events=[];
 for(const seq of[1,2,3,4,5]){
  const event=seq===2||seq===3?summary(seq,seq===2?'deepseek-official':'ustc'):{seq,time:at+seq,type:'assistant/message',data:{turn:seq,step:1,provider:'ustc',model:'deepseek-flash',usage:{inputTokens:seq*100,outputTokens:0}}};events.push(event);ledger.ingestEvent({sessionId:'s',event});
 }
 const cost=ledger.summary().totals.cost;assert.equal(ledger.summary().totals.totalTokens,23000);
 ledger.ingestBaseline({sessionId:'s',projection:{asOfSeq:5,values:{tokenUsage:{inputTokens:1000,outputTokens:0}}},at:at+30});assert.equal(ledger.summary().totals.totalTokens,23000);
 const reloaded=createTokenLedger({file,resolveKey:()=> 'group:1',maxLines:2});assert.equal(reloaded.summary().totals.totalTokens,23000);assert.equal(reloaded.summary().totals.cost,cost);
 assert.equal(reloaded.ingestSnapshotRecords({sessionId:'s',records:events}),0);assert.equal(reloaded.summary().totals.totalTokens,23000);
 const chart=reloaded.series({hours:1,at:at+1000});assert.equal(chart.totals.tokens+chart.offChartTokens,23000);assert.equal(chart.totals.cost+chart.offChartCost,cost);
});
test('template summaries and unknown provider identities never inherit the selected paid model',t=>{
 const {ledger}=fixture(t);ledger.ingestEvent({sessionId:'s',event:{seq:1,type:'model/selection',data:{provider:'deepseek-official',model:'deepseek-flash'}}});
 assert(!ledger.ingestEvent({sessionId:'s',event:{...summary(2,'deepseek-official'),data:{...summary(2,'deepseek-official').data,llmStreamCall:false}}}));
 assert(ledger.ingestEvent({sessionId:'s',event:summary(3,undefined)}));assert.equal(ledger.summary().totals.cost,0);assert.equal(ledger.summary().totals.totalTokens,11000);
});
