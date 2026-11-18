import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {priceUsage,resolvePriceTable,totalTokensOf} from '../src/model-prices.js';
import {createTokenLedger} from '../src/token-ledger.js';
const at=Date.parse('2026-11-12T13:00:00+08:00');
const buckets={cacheMiss:1e6,cacheHit:0,cacheWrite:0,output:1e6};

test('only the two explicitly priced official provider/model pairs contribute money',()=>{
 for(const [provider,model,want] of [
  ['deepseek-official','deepseek-flash',5],['deepseek-official','deepseek-v4-pro',18],
  ['ustc','deepseek-flash',0],['ustc','qwen3.8-flash-next',0],
  ['deepseek-account','deepseek-flash',0],['codex','deepseek-flash',0],
  ['deepseek-official','unknown-model',0],['deepseek-official','deepseek-pro',0],
  [undefined,'deepseek-flash',0],['deepseek-official',undefined,0]
 ])assert.equal(priceUsage(buckets,{provider,model,at}).cost.total,want,`${provider}/${model}`);
});

test('custom price entries require an explicit provider and do not borrow default prices',()=>{
 const table=resolvePriceTable({models:{'relay-model':{provider:'my-relay',off:{cacheHit:.5,cacheMiss:3,output:9}}}});
 assert.equal(priceUsage(buckets,{provider:'my-relay',model:'relay-model',at,table}).cost.total,12);
 assert.equal(priceUsage(buckets,{provider:'ustc',model:'relay-model',at,table}).cost.total,0);
});

function fixture(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'strict-price-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'usage.jsonl');return {file,ledger:createTokenLedger({file,resolveKey:()=> 'group:1',...options})};
}
function event(seq,provider,model='deepseek-flash',turn=seq){return {seq,time:at+seq,type:'assistant/message',data:{provider,model,turn,step:1,usage:{inputTokens:1e6,outputTokens:1e6}}};}

test('summary, history, chart and budget keep all tokens but exclude unpriced money',t=>{
 const {ledger}=fixture(t);
 ledger.ingestEvent({sessionId:'s',event:event(1,'deepseek-official')});
 ledger.ingestEvent({sessionId:'s',event:event(2,'ustc')});
 ledger.ingestEvent({sessionId:'s',event:event(3,'ustc','qwen3.8-flash-next')});
 assert.equal(ledger.summary().totals.totalTokens,6e6);
 assert.equal(ledger.summary().totals.cost,5);
 assert.deepEqual(ledger.recent().map(x=>x.cost),[0,0,5]);
 assert.equal(ledger.series({hours:1,at:at+1000}).totals.cost,5);
 const period=ledger.periodUsage({since:at,until:at+1000});
 assert.equal(period.tokens,6e6);assert.equal(period.cost,5);
});

test('cumulative baseline cannot reprice all history using the currently selected model',t=>{
 const {ledger}=fixture(t);
 ledger.ingestEvent({sessionId:'s',event:event(1,'deepseek-official')});
 ledger.ingestEvent({sessionId:'s',event:event(2,'ustc')});
 ledger.ingestBaseline({sessionId:'s',projection:{asOfSeq:2,values:{tokenUsage:{inputTokens:2e6,outputTokens:2e6}}},at:at+100,provider:'ustc',model:'deepseek-flash'});
 assert.equal(ledger.summary().totals.totalTokens,4e6);
 assert.equal(ledger.summary().totals.cost,5);
 assert.equal(ledger.series({hours:1,at:at+1000}).offChartCost,0);
});

test('snapshot selection changes supply per-call identities without pricing an unidentified prefix',t=>{
 const {ledger}=fixture(t);
 ledger.ingestSnapshotRecords({sessionId:'s',records:[
  event(1,undefined,undefined),
  {seq:2,time:at,type:'model/selection',data:{provider:'deepseek-official',model:'deepseek-flash'}},
  {...event(3),data:{turn:3,step:1,usage:{inputTokens:1e6,outputTokens:1e6}}},
  {seq:4,time:at,type:'model/selection',data:{provider:'ustc',model:'deepseek-flash'}},
  {...event(5),data:{turn:5,step:1,usage:{inputTokens:1e6,outputTokens:1e6}}}
 ]});
 assert.equal(ledger.summary().totals.totalTokens,6e6);
 assert.equal(ledger.summary().totals.cost,5);
});

test('compaction and reload preserve price identities for mixed-provider evictions',t=>{
 const {file,ledger}=fixture(t,{maxLines:2});
 for(let i=1;i<=8;i++)ledger.ingestEvent({sessionId:'s',event:event(i,i%2?'deepseek-official':'ustc')});
 assert.equal(ledger.summary().totals.totalTokens,16e6);
 assert.equal(ledger.summary().totals.cost,20);
 const reloaded=createTokenLedger({file,resolveKey:()=> 'group:1',maxLines:2});
 assert.equal(reloaded.summary().totals.totalTokens,16e6);
 assert.equal(reloaded.summary().totals.cost,20);
 reloaded.ingestBaseline({sessionId:'s',projection:{asOfSeq:8,values:{tokenUsage:{inputTokens:8e6,outputTokens:8e6}}},at:at+100,provider:'ustc',model:'deepseek-flash'});
 assert.equal(reloaded.summary().totals.totalTokens,16e6);
 assert.equal(reloaded.summary().totals.cost,20,'a cumulative token baseline cannot erase identified paid calls');
 for(let i=1;i<=8;i++)reloaded.ingestEvent({sessionId:'s',event:event(i,i%2?'deepseek-official':'ustc'),origin:'snapshot'});
 assert.equal(reloaded.summary().totals.cost,20,'replaying already evicted history cannot charge it twice');
});

test('legacy compressed money without price identity is excluded while its tokens survive',t=>{
 const {file}=fixture(t);
 fs.writeFileSync(file,JSON.stringify({k:'evict',sid:'s',key:'group:1',t:at,b:buckets,cost:99,peak:0,off:99,dropped:1,maxSeq:1})+'\n');
 const ledger=createTokenLedger({file});
 assert.equal(ledger.summary().totals.totalTokens,2e6);
 assert.equal(ledger.summary().totals.cost,0);
 assert.equal(ledger.series({hours:1,at:at+1000}).offChartCost,0);
});
