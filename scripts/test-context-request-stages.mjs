import test from 'node:test';import assert from 'node:assert/strict';
import {requestStageOptions,requestStageSummary} from '../console/layers/O/context-request-stages.js';
const row=(id,n,extras={})=>({requestId:id,nonce:'batch',requestInRound:n,turn:129,step:n,at:1793353913000+n*1000,messages:[{role:'user',text:id}],tools:[],...extras});
const stages=(first,previous,current)=>[{kind:'initial',request:first},{kind:'previous',request:previous},{kind:'current',request:current}];
test('screenshot case: first and previous are one record, not two model calls',()=>{
 const first=row('one',1),current=row('two',2),input=stages(first,{...first},current),before=JSON.stringify(input);
 const options=requestStageOptions(input);assert.equal(options.length,2);
 assert.deepEqual(options[0].aliases,['initial','previous']);assert.equal(options[0].kind,'initial');
 assert.match(options[0].label,/首次.*也是上一次/);assert.match(options[1].label,/第 2 次模型调用/);
 assert(!options[1].label.includes('129'));assert.equal(JSON.stringify(input),before);
});
test('one recorded call appears once; later requests keep all three distinct records',()=>{
 const first=row('one',1);const one=requestStageOptions(stages(first,null,{...first}));assert.equal(one.length,1);assert.equal(one[0].kind,'current');assert.match(one[0].label,/最新.*首次/);
 assert.equal(requestStageOptions(stages(first,row('three',3),row('four',4))).length,3);
});
test('missing and legacy observations stay honest; equal timestamps do not merge different requests',()=>{
 assert.deepEqual(requestStageOptions(stages(null,null,null)),[]);
 const late=requestStageOptions(stages(null,null,row('late',null)));assert.match(late[0].label,/序号未记录/);
 const before=row('a',1),after=row('b',2,{at:before.at});assert.equal(requestStageOptions(stages(before,null,after)).length,2);
 const legacy={at:10,nonce:'old',messages:[{role:'user',text:'old'}],tools:[]};assert.equal(requestStageOptions(stages(legacy,structuredClone(legacy),null)).length,1);
 assert.match(requestStageSummary(row('two',2,{messages:Array.from({length:147},()=>({})),toolCount:91})),/147 条消息记录/);
});
