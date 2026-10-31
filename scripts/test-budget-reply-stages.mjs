import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/life-token-budget/index.js';
function fixture(config={},saved={}){let state=structuredClone(saved);const ctx={config,capabilities:{getOwnerQQ:()=>99},state:{get:()=>state,set:p=>state={...state,...p}}};return {api:createPlugin(ctx).services.tokenBudget,state:()=>state,ctx};}
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
test('hard cap evaluates private arrivals and only directed group arrivals',()=>{
 const f=fixture({mechanicalPrivateReplies:['private'],mechanicalGroupReplies:['group'],mechanicalLimits:{minIntervalMs:1000,maxPerMinute:60,maxPerHour:300}});
 for(const kind of ['private','group'])for(let n=1;n<=3;n++){const r=f.api.onSilentIncoming({key:kind+':1',kind,messageId:String(n),atSelf:kind==='group',stage:'silent',periodStart:1,at:10000+n*1001});assert.equal(r.text,kind);}
 const r=f.api.onSilentIncoming({key:'group:2',kind:'group',messageId:'ordinary',stage:'silent',periodStart:1,at:20000});assert.equal(r.text,null);assert.equal(r.reason,'not_directed');
});

test('ordinary group traffic neither triggers nor consumes the shared mention/quote mechanical throttle',()=>{
 const f=fixture({mechanicalGroupReplies:['机械回复']}),send=(id,at,extra={})=>f.api.onSilentIncoming({key:'group:2',kind:'group',messageId:id,stage:'silent',periodStart:1,at,...extra});
 for(const [i,extra]of [{text:'普通消息'},{text:'@AI助手',atSelf:false},{text:'[引用 AI助手：你好]',quoteTargetIsSelf:false},{atSelf:'true'},{quoteTargetIsSelf:'true'}].entries())assert.equal(send('ordinary'+i,1000+i,extra).text,null);
 assert.equal(f.api.recoveryPending({key:'group:2'}),5);assert.equal(f.state().mechanicalSends?.['group:2'],undefined);
 assert.equal(send('quote',2000,{quoteTargetIsSelf:true}).text,'机械回复');assert.equal(send('at-too-soon',11999,{atSelf:true}).text,null);assert.equal(send('at',12000,{atSelf:true}).text,'机械回复');
 assert.equal(f.state().recovery['group:2'].messages.find(x=>x.id==='quote').quoteTargetIsSelf,true);
});

test('default mechanical limits combine a ten-second gap with rolling minute and hour caps',()=>{
 const f=fixture({mechanicalGroupReplies:['机械回复']}),start=1_000_000,send=(id,delta)=>f.api.onSilentIncoming({key:'group:2',kind:'group',messageId:id,stage:'silent',atSelf:true,at:start+delta});
 assert.equal(send('a',0).text,'机械回复');assert.equal(send('too-soon',9999).reason,'interval');
 for(const [id,delta]of [['b',10000],['c',20000],['d',30000]])assert.equal(send(id,delta).text,'机械回复');
 assert.equal(send('fifth',40000).reason,'minute_limit');assert.equal(send('roll',60000).text,'机械回复');
 const hour=fixture({mechanicalGroupReplies:['机械回复']});for(let i=0;i<30;i++)assert.equal(hour.api.onSilentIncoming({key:'group:2',kind:'group',messageId:String(i),stage:'silent',atSelf:true,at:start+i*20000}).text,'机械回复');
 assert.equal(hour.api.onSilentIncoming({key:'group:2',kind:'group',messageId:'31',stage:'silent',atSelf:true,at:start+600000}).reason,'hour_limit');
 assert.equal(hour.api.onSilentIncoming({key:'group:2',kind:'group',messageId:'32',stage:'silent',atSelf:true,at:start+3600000}).text,'机械回复');
});

test('verified bot quotes use the directed recovery window without treating quotes of others as bot mentions',()=>{
 const f=fixture({recoveryWindows:{privateMessages:5,groupMessages:1,groupAtMessages:1}}),messages=[{seq:1,quoteTargetIsSelf:true},{seq:2,quoteTargetIsSelf:false},{seq:3,text:'普通'}];
 assert.deepEqual(f.api.selectWindow({key:'group:2',messages}).map(x=>x.seq),[1,3]);
});
test('hard mechanical gap/minute/hour reservations survive reload and blocked arrivals do not queue a send',()=>{
 const cfg={mechanicalPrivateReplies:['hard'],mechanicalLimits:{minIntervalMs:1000,maxPerMinute:2,maxPerHour:3}},f=fixture(cfg);
 const send=(api,id,at)=>api.onSilentIncoming({key:'private:1',kind:'private',messageId:id,stage:'silent',periodStart:1,at});
 assert.equal(send(f.api,'a',10000).text,'hard');assert.equal(send(f.api,'b',10500).text,null);assert.equal(send(f.api,'c',11000).text,'hard');assert.equal(send(f.api,'d',12000).text,null);
 const api=fixture(cfg,f.state()).api;assert.equal(send(api,'e',71001).text,'hard');assert.equal(send(api,'f',140000).text,null);assert.equal(send(api,'e',4000000).duplicate,true);
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
