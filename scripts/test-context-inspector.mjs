import test from 'node:test';import assert from 'node:assert/strict';
import {requestEntries,filterEntries,componentAvailability,inspectorHtml} from '../console/layers/O/context-inspector.js';
test('latest dynamic and waiting-result descriptions follow current layout and paired tool evidence',()=>{
 const request={layoutVersion:3,messages:[{role:'assistant',toolCalls:[{id:'w',name:'qq_wait_for_messages'}]},{role:'tool',toolResults:[{toolCallId:'w'}],text:JSON.stringify({endRound:false,action:'followup',hint:'追问细节'})},{role:'user',source:'qq-context-latest',text:'心情80',contextUpdates:[{id:'ctx-context-dynamics',hash:'80'}]}]};
 const before=JSON.stringify(request),rows=requestEntries(request);assert.equal(rows[1].toolResults[0].name,'qq_wait_for_messages');assert.equal(JSON.stringify(request),before);
 const render={renderText:text=>text,renderComponent:()=>''};
 const current=inspectorHtml(request,[],{view:'messages',selected:'message:2'},render);assert(!current.includes('旧状态保留在历史原位置'));assert(current.includes('仅保存在运行日志'));
 const waiting=inspectorHtml(request,[],{view:'messages',selected:'message:1'},render);assert.match(waiting,/下一步行动建议/);assert.match(waiting,/完整请求原文/);
});
test('missing update provenance never marks a snapshot as superseded',()=>{const [row]=requestEntries({messages:[{role:'user',source:'qq-context-update',text:'旧采集'}]});assert.equal(row.superseded,false);assert.match(row.stateLabel,/无法判断/);});
test('empty processing view does not claim that a live queue has been cleared',()=>{
 const render={renderText:text=>text,renderComponent:()=>''},request={observerVersion:6,layoutVersion:3,messages:[{role:'tool',text:'处理中的工具结果',currentInput:false}]};
 const html=inspectorHtml(request,[],{view:'messages',region:'arrivals'},render);assert.match(html,/未找到待处理来信/);assert.match(html,/不推断实时队列已经清空/);
 const old=inspectorHtml({...request,observerVersion:1,messages:[{role:'user',text:'旧记录'}]},[],{view:'messages',region:'arrivals'},render);assert.match(old,/仅依据所选快照/);
});
test('latest-tail requests expose five business regions and preserve historical call/result order',()=>{
 const request={layoutVersion:3,messages:[{role:'system',text:'规则'},{role:'user',source:'qq-context-stable',text:'背景'},{role:'assistant',toolCalls:[{id:'t',name:'read'}]},{role:'tool',toolResults:[{toolCallId:'t'}]},{role:'user',source:'qq-context-dialogue',currentInput:true,text:'新增来信'},{role:'user',source:'qq-context-latest',text:'当前心情80',contextUpdates:[{id:'mood',hash:'80'}]}]};
 const rows=requestEntries(request);assert.deepEqual(rows.map(row=>row.region),['system','stable','history','history','arrivals','dynamic']);assert.equal(rows.at(-1).superseded,false);assert.match(rows.at(-1).name,/仅最新/);
});

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
 assert.equal(rows[2].superseded,true);assert.equal(rows[5].superseded,false);
 assert.deepEqual(rows[6].withdrawnComponents,['schedule']);assert.match(rows[2].stateLabel,/取代/);
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
