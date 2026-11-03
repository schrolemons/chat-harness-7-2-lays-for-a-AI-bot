import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/life-token-budget/index.js';
function fixture(config={},saved={}){let state=structuredClone(saved);const ctx={config,capabilities:{getOwnerQQ:()=>99,hasAdminEnvironment:key=>key==='private:99'},state:{get:()=>state,set:p=>state={...state,...p}}};return {api:createPlugin(ctx).services.tokenBudget,state:()=>state,ctx};}
test('weak private waits for five distinct arrivals, persists across reload and resets only after dispatch',()=>{
 const f=fixture();let api=f.api;assert.equal(typeof api.observeIncoming,'function');
 for(let n=1;n<5;n++){api.observeIncoming({key:'private:1',messageId:String(n),stage:'weak',periodStart:100,at:1000+n});assert.equal(api.canDispatch({key:'private:1',stage:'weak'}),false);}
 api.observeIncoming({key:'private:1',messageId:'4',stage:'weak',periodStart:100});assert.equal(api.canDispatch({key:'private:1',stage:'weak'}),false);
 api=fixture({},f.state()).api;api.observeIncoming({key:'private:1',messageId:'5',stage:'weak',periodStart:100});assert.equal(api.canDispatch({key:'private:1',stage:'weak'}),true);api.noteDispatch({key:'private:1',stage:'weak',throughSeq:5});assert.equal(api.canDispatch({key:'private:1',stage:'weak'}),false);
 api.observeIncoming({key:'private:1',messageId:'6',stage:'weak',periodStart:100});assert.equal(api.canDispatch({key:'private:1',stage:'weak'}),false);
});
test('weak group uses its configured half-hour interval, not private count; normal and exempt bypass both',()=>{
 const f=fixture({sessions:{'group:2':{weakMinIntervalMin:30}},ownerBudgetEnabled:false}),now=1_000_000;
 assert.equal(f.api.canDispatch({key:'group:2',stage:'weak',now}),true);f.api.noteDispatch({key:'group:2',stage:'weak',now});assert.equal(f.api.canDispatch({key:'group:2',stage:'weak',now:now+1799999}),false);assert.equal(f.api.canDispatch({key:'group:2',stage:'weak',now:now+1800000}),true);assert.equal(f.api.canDispatch({key:'private:1',stage:'normal'}),true);assert.equal(f.api.canDispatch({key:'private:99',stage:'silent'}),true);
});
test('weak dispatch consumes five arrivals and preserves arrivals during prompt acceptance',()=>{
 const f=fixture(),key='private:1';for(let n=1;n<=6;n++)f.api.observeIncoming({key,messageId:String(n),stage:'weak',periodStart:1});
 f.api.noteDispatch({key,stage:'weak',throughSeq:5});assert.equal(f.state().weakIncoming[key].count,1);
 for(let n=7;n<=10;n++)f.api.observeIncoming({key,messageId:String(n),stage:'weak',periodStart:1});
 assert.equal(f.api.canDispatch({key,stage:'weak'}),true);
});
test('hard cap silently records private and group arrivals without consuming a mechanical send quota',()=>{
 const f=fixture({mechanicalPrivateReplies:['private'],mechanicalGroupReplies:['group'],mechanicalLimits:{minIntervalMs:1000,maxPerMinute:60,maxPerHour:300}});
 for(const kind of ['private','group'])for(let n=1;n<=3;n++){const r=f.api.onSilentIncoming({key:kind+':1',kind,messageId:String(n),atSelf:kind==='group',stage:'silent',periodStart:1,at:10000+n*1001});assert.equal(r.text,null);assert.equal(r.handled,true);assert.equal(r.suppressed,true);assert.equal(f.api.recoveryPending({key:kind+':1'}),n);}
 const r=f.api.onSilentIncoming({key:'group:2',kind:'group',messageId:'ordinary',stage:'silent',periodStart:1,at:20000});assert.equal(r.text,null);assert.equal(r.reason,'not_directed');assert.equal(f.state().mechanicalSends,undefined);assert.equal(f.state().mechanicalPhysicalSends,undefined);
});

test('ordinary group traffic and verified mentions/quotes stay silent and preserve recovery evidence',()=>{
 const f=fixture({mechanicalGroupReplies:['机械回复']}),send=(id,at,extra={})=>f.api.onSilentIncoming({key:'group:2',kind:'group',messageId:id,stage:'silent',periodStart:1,at,...extra});
 for(const [i,extra]of [{text:'普通消息'},{text:'@AI助手',atSelf:false},{text:'[引用 AI助手：你好]',quoteTargetIsSelf:false},{atSelf:'true'},{quoteTargetIsSelf:'true'}].entries())assert.equal(send('ordinary'+i,1000+i,extra).text,null);
 assert.equal(f.api.recoveryPending({key:'group:2'}),5);assert.equal(f.state().mechanicalSends?.['group:2'],undefined);
 assert.equal(send('quote',2000,{quoteTargetIsSelf:true}).text,null);assert.equal(send('at-soon',11999,{atSelf:true}).text,null);assert.equal(send('at',12000,{atSelf:true}).text,null);
 assert.equal(f.state().recovery['group:2'].messages.find(x=>x.id==='quote').quoteTargetIsSelf,true);assert.equal(f.state().mechanicalSends,undefined);
});

test('explicit internal mechanical delivery retains its independent ten-second, minute and hour limits',()=>{
 const f=fixture(),start=1_000_000,send=delta=>f.api.authorizeMechanicalSend({key:'group:2',now:start+delta});
 assert.equal(send(0).ok,true);assert.equal(send(9999).reason,'interval');
 for(const delta of [10000,20000,30000])assert.equal(send(delta).ok,true);
 assert.equal(send(40000).reason,'minute_limit');assert.equal(send(60000).ok,true);
 const hour=fixture();for(let i=0;i<30;i++)assert.equal(hour.api.authorizeMechanicalSend({key:'group:2',now:start+i*20000}).ok,true);
 assert.equal(hour.api.authorizeMechanicalSend({key:'group:2',now:start+600000}).reason,'hour_limit');assert.equal(hour.api.authorizeMechanicalSend({key:'group:2',now:start+3600000}).ok,true);
});

test('verified bot quotes use the directed recovery window without treating quotes of others as bot mentions',()=>{
 const f=fixture({recoveryWindows:{privateMessages:5,groupMessages:1,groupAtMessages:1}}),messages=[{seq:1,quoteTargetIsSelf:true},{seq:2,quoteTargetIsSelf:false},{seq:3,text:'普通'}];
 assert.deepEqual(f.api.selectWindow({key:'group:2',messages}).map(x=>x.seq),[1,3]);
});
test('explicit physical mechanical-send limits survive reload while silent arrival deduplication remains independent',()=>{
 const cfg={mechanicalLimits:{minIntervalMs:1000,maxPerMinute:2,maxPerHour:3}},f=fixture(cfg),send=(api,at)=>api.authorizeMechanicalSend({key:'private:1',now:at});
 assert.equal(send(f.api,10000).ok,true);assert.equal(send(f.api,10500).ok,false);assert.equal(send(f.api,11000).ok,true);assert.equal(send(f.api,12000).reason,'minute_limit');
 const api=fixture(cfg,f.state()).api;assert.equal(send(api,71001).ok,true);assert.equal(send(api,140000).reason,'hour_limit');
 const arrival={key:'private:1',kind:'private',messageId:'same',stage:'silent',periodStart:1,at:4000000};assert.equal(api.onSilentIncoming(arrival).text,null);assert.equal(api.onSilentIncoming(arrival).duplicate,true);assert.equal(api.recoveryPending({key:'private:1'}),1);
});

test('weak pending window stays bounded independently for ordinary group context and bot mentions',()=>{
 const f=fixture({recoveryWindows:{privateMessages:2,groupMessages:2,groupAtMessages:1}});const messages=Array.from({length:12},(_,i)=>({seq:i+1,atSelf:(i+1)%3===0}));assert.deepEqual(f.api.selectWindow({key:'group:1',messages}).map(m=>m.seq),[10,11,12]);assert.deepEqual(f.api.selectWindow({key:'private:1',messages}).map(m=>m.seq),[11,12]);
});
test('mechanical delivery rechecks an independent physical gap after incoming admission',()=>{
 const f=fixture({mechanicalLimits:{minIntervalMs:1000,maxPerMinute:2,maxPerHour:3}}),key='private:1';
 assert.equal(f.api.authorizeMechanicalSend({key,now:10000}).ok,true);
 assert.equal(f.api.authorizeMechanicalSend({key,now:10500}).ok,false);
 assert.equal(f.api.authorizeMechanicalSend({key,now:11000}).ok,true);
 assert.equal(f.api.authorizeMechanicalSend({key,now:12000}).ok,false);
});
test('configured private wake count controls admission and consumes that count, independently of context window',()=>{
 for(const count of [1,3,8]){const f=fixture({privateWakeEveryMessages:count,recoveryWindows:{privateMessages:2}}),key='private:1';
 for(let n=1;n<=count;n++){f.api.observeIncoming({key,messageId:String(n),stage:'weak',periodStart:1});assert.equal(f.api.canDispatch({key,stage:'weak'}),n===count);}
 f.api.observeIncoming({key,messageId:'late',stage:'weak',periodStart:1});f.api.noteDispatch({key,stage:'weak'});assert.equal(f.state().weakIncoming[key].count,1);
 assert.match(createPlugin(f.ctx).hooks.beforePrompt({key,budgetStage:'weak'}),new RegExp('累计'+count+'条'));
 }
});
test('private wake count rejects zero, fractional, excessive or nonnumeric saved values',()=>{
 for(const value of [0,-1,1.5,101,'3',null])assert.equal(createPlugin(fixture().ctx).validateConfig({privateWakeEveryMessages:value}).ok,false);
 for(const value of [1,5,100])assert.equal(createPlugin(fixture().ctx).validateConfig({privateWakeEveryMessages:value}).ok,true);
});
test('changing the rule during an accepted batch preserves its original consumption size',()=>{
 const f=fixture({privateWakeEveryMessages:3}),key='private:1';for(let n=1;n<=4;n++)f.api.observeIncoming({key,messageId:String(n),stage:'weak',periodStart:1});
 f.api.claimWeakBatch({key});f.ctx.config.privateWakeEveryMessages=8;f.api.noteDispatch({key,stage:'weak'});assert.equal(f.state().weakIncoming[key].count,1);
});

test('owner fee exemption requires the verified administrator environment as well as the configured owner identity',()=>{const f=fixture({ownerBudgetEnabled:false});assert.equal(f.api.assess({key:'private:99',globalCost:100}).exempt,true);f.ctx.capabilities.hasAdminEnvironment=()=>false;assert.equal(f.api.assess({key:'private:99',globalCost:100}).exempt,false);assert.equal(f.api.canDispatch({key:'private:99',stage:'silent'}),false);});


test('weak group timer checks a nonempty optional window even when there are no required replies',async()=>{
 const f=fixture(),jobs=new Map();let wakes=0;
 f.ctx.scheduler={schedule:job=>jobs.set(job.id,job),cancel:id=>jobs.delete(id)};
 f.ctx.capabilities.budgetWeakStatus=()=>({stage:'weak',allowed:true,busy:false,pendingCount:0,candidateCount:2});f.ctx.capabilities.requestBudgetWake=()=>{wakes++;return {ok:true};};
 const api=createPlugin(f.ctx).services.tokenBudget;api.observeIncoming({key:'group:2',messageId:'a',stage:'weak',at:1000});const job=jobs.get('budget-weak:group:2');await job.run({now:job.at});assert.equal(wakes,1);
});

test('cold group selection stays recent while private selection preserves pending reply order',()=>{
 const f=fixture({recoveryWindows:{privateMessages:2,groupMessages:2,groupAtMessages:2}});
 const rows=Array.from({length:12},(_,i)=>({seq:i+1,atSelf:i%2===0,replyRequirement:i<4?'required':'optional',...(i>=4?{replyDisposition:'history'}:{})}));
 assert.deepEqual(f.api.selectWindow({key:'group:1',messages:rows}).map(m=>m.seq),[9,10,11,12]);assert.deepEqual(f.api.selectWindow({key:'private:1',messages:rows}).map(m=>m.seq),[1,2]);
});

test('cold group guidance separates optional context from required replies and permits a silent batch',()=>{
 const p=createPlugin(fixture().ctx),text=p.hooks.beforePrompt({key:'group:1',budgetStage:'weak'});assert.match(text,/自主选择|自行选择/);assert.match(text,/不回复|不发言/);assert.match(text,/必答|必须回应/);assert.doesNotMatch(text,/结清本批/);
});
