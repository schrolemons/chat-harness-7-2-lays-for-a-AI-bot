import test from 'node:test';import assert from 'node:assert/strict';
import {requestEntries,filterEntries,componentAvailability} from '../console/layers/O/context-inspector.js';

test('refill view distinguishes stable prefix, current updates, historical updates and explicit withdrawals',()=>{
 const rows=requestEntries({layoutVersion:2,messages:[
  {role:'system',text:'硬规则'},
  {role:'user',source:'qq-context-stable',text:'稳定背景'},
  {role:'user',source:'qq-context-update',text:'心情60与日程',contextUpdates:[{id:'mood',hash:'a'},{id:'schedule',hash:'b'}]},
  {role:'assistant',toolCalls:[{id:'c',name:'set_mood'}]},
  {role:'tool',toolResults:[{toolCallId:'c'}]},
  {role:'user',source:'qq-context-update',text:'心情80',contextUpdates:[{id:'mood',hash:'c'}]},
  {role:'user',source:'qq-context-update',text:'日程已撤回',contextUpdates:[{id:'schedule',hash:null}]},
 ]});
 assert.equal(rows[1].region,'stable');assert.equal(rows[2].region,'dynamic');
 assert.deepEqual(rows[2].effectiveComponents,[]);assert.deepEqual(rows[5].effectiveComponents,['mood']);
 assert.deepEqual(rows[6].withdrawnComponents,['schedule']);assert.match(rows[2].stateLabel,/历史/);
 assert.deepEqual(filterEntries(rows,{region:'dynamic'}).map(r=>r.position),[3,6,7]);
});
test('DSH-style request sequence preserves every message and tool pairing in one continuous list',()=>{
 const request={nonce:'n',messages:[{id:'s',role:'system',text:'设定'},{id:'c',role:'user',source:'qq-context-current',contextNonce:'n',text:'背景'},{id:'a',role:'assistant',toolCalls:[{id:'c1',name:'calendar'}],text:'调用'},{id:'t',role:'tool',toolResults:[{toolCallId:'c1',name:'calendar'}],text:'日程'},{id:'u',role:'user',source:'user',text:'你好'}]};
 const frozen=JSON.stringify(request),rows=requestEntries(request);
 assert.deepEqual(rows.map(x=>x.position),[1,2,3,4,5]);
 assert.deepEqual(rows.map(x=>x.kind),['system','context','call','result','user']);
 assert.equal(rows[1].name,'本轮背景快照');assert.equal(JSON.stringify(request),frozen);
});
test('filtered reading numbers stay continuous while the original request positions stay separate',()=>{
 const rows=requestEntries({messages:[{role:'system',text:'A'},{role:'tool',text:'B'},{role:'assistant',text:'C'},{role:'tool',text:'D'}]});
 const filtered=filterEntries(rows,{kind:'result'});
 assert.deepEqual(filtered.map(x=>x.listNumber),[1,2]);assert.deepEqual(filtered.map(x=>x.position),[2,4]);
 assert.equal(filterEntries(rows,{query:'missing'}).length,0);
});
test('components can be found by fixed code, ordinary number and owner name; absence remains explicit',()=>{
 const rows=[{name:'心情与表情策略',kind:'component',componentNumber:5,text:'心情60',included:true,inRequest:true},{name:'日程',kind:'component',componentNumber:25,text:'',notCaptured:true}];
 for(const query of ['05','C05','心情'])assert.equal(filterEntries(rows,{query})[0].componentNumber,5);
 assert.match(componentAvailability(rows[0]),/已携带/);assert.match(componentAvailability(rows[1]),/未采集/);
 assert.match(componentAvailability({text:'',included:false,reason:'本轮未产出'}),/未提供/);
});
