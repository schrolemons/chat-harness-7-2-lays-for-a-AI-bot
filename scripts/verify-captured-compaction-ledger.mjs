import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createTokenLedger} from '../src/token-ledger.js';
import {resolvePriceTable} from '../src/model-prices.js';
const root=JSON.parse(fs.readFileSync('workspace.local.json')).runtimeRoot,dir=path.join(root,'state/audits/global-model-inheritance-20261113');
const captured=JSON.parse(fs.readFileSync(path.join(dir,'actual-compaction-calls.json'))),file=path.join(dir,'isolated-current-price-compaction-ledger.jsonl');
assert(!fs.existsSync(file),'Keep the previous verification artifact; do not replace it');
const pricing=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')).pricing;
const keys=new Map(captured.map(c=>[c.sessionId,c.key])),ledger=createTokenLedger({file,priceTable:resolvePriceTable(pricing),resolveKey:sid=>keys.get(sid)});let expectedTokens=0,calls=0;
for(const c of captured)for(const event of c.summaries||[]){calls++;expectedTokens+=event.usage?.totalTokens||0;assert(ledger.ingestEvent({sessionId:c.sessionId,event:{...event,type:'compaction/summary',data:event}}));}
assert.equal(ledger.summary().totals.totalTokens,expectedTokens);
for(const c of captured)for(const event of c.summaries||[])assert(!ledger.ingestEvent({sessionId:c.sessionId,event:{...event,type:'compaction/summary',data:event},origin:'snapshot'}));
const report={at:Date.now(),source:'Captured native compaction events replayed into an isolated audit ledger; production ledger unchanged',calls,tokens:expectedTokens,costAtLocalPriceTable:ledger.summary().totals.cost,pricedProvider:'deepseek-official',replayIdempotent:true};
fs.writeFileSync(path.join(dir,'actual-compaction-ledger-current-price-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
