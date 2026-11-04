import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
import {createOutboundTransport} from '../src/outbound-context.js';
function fixture(config={},readBudget){
 const key='private:123';let state={};const svc=createPlugin({config:{maxMessagesNormal:3,maxMessagesCasual:3,maxMessagesSerious:3,maxSendPerMinute:0,maxSendPerHour:0,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0,...config},state:{get:()=>state,set:p=>state={...state,...structuredClone(p)}},capabilities:{},callService:()=>null,isPluginEnabled:()=>false}).services.replyPlan;
 const messages=[1,2,3].map(seq=>({seq,messageId:String(seq),text:'完整意思'+seq,bodyComplete:true,isSelf:false}));
 const plan=svc.resolve({key,turnId:'wake',messages});const contents=svc.declareContents({key,plan,messages,groups:messages.map(m=>({seqs:[m.seq],kind:'chat'}))}).contents;
 const transport=createOutboundTransport({callService:(s,m,p)=>s==='replyPlan'?svc[m]?.(p):null,contentFacts:()=>({messages}),sleep:async()=>{},guard:(key,context)=>()=>{
  const budget=readBudget?.();
  if(budget?.stage==='silent'&&!svc.canContinueReply?.({key,plan:context.plan,budget}))throw Error('hard budget limit');
  return budget;
 }});
 const envelope={key,actionId:'wake',reason:'private',replyPlan:plan};return {key,svc,messages,contents,transport,envelope};
}
test('physical transport binds each semantic id and can deliver three by three in one wake',async()=>{
 const f=fixture();let sent=0;
 for(const c of f.contents){const context=f.transport.capture({key:f.key,envelope:f.envelope,agent:true,contentId:c.id});
  for(let n=0;n<3;n++)await f.transport.perform({key:f.key,context,text:'内容'+c.id+'第'+n,send:async()=>{sent++;}});
  await assert.rejects(f.transport.perform({key:f.key,context,text:'超出的第四条',send:async()=>{sent++;}}),/content_limit/);
 }
 assert.equal(sent,9);
});

for (const [config, reason] of [
 [{maxSendPerMinute:1}, 'minute_limit'],
 [{maxSendPerHour:1}, 'hour_limit']
]) test('split transport uses one group credit at '+reason,async()=>{
 const f=fixture(config),sent=[];
 const context=contentId=>f.transport.capture({key:f.key,envelope:f.envelope,agent:true,origin:'conversation',contentId});
 const send=(index,text)=>f.transport.perform({key:f.key,context:context(f.contents[index].id),text,send:async()=>{sent.push(text);}});
 await send(0,'first bubble');
 await send(0,'second bubble');
 await assert.rejects(send(0,'second bubble'),/duplicate_delivery/);
 await assert.rejects(send(1,'different content'),new RegExp(reason));
 assert.deepEqual(sent,['first bubble','second bubble']);
 assert.equal(f.svc.preview({key:f.key}).minute,1);
 assert.equal(f.svc.preview({key:f.key}).successful,2);
});

test('a confirmed chat group continues within its turn when local spending reaches the cap',async()=>{
 const budget={stage:'normal',periodStart:1,hardLimitYuan:1,globalHardLimitYuan:10,cost:0.9,globalCost:2};
 const f=fixture({},()=>budget),sent=[];
 const send=(contentId,text,envelope=f.envelope)=>f.transport.perform({key:f.key,
  context:f.transport.capture({key:f.key,envelope,agent:true,origin:'conversation',contentId}),text,send:async()=>{sent.push(text);}});
 await send(f.contents[0].id,'start');
 Object.assign(budget,{stage:'silent',cost:1.01,globalCost:2.11});
 await send(f.contents[0].id,'finish');
 await assert.rejects(send(f.contents[1].id,'new group'),/hard budget limit/);
 const next={...f.envelope,replyPlan:{...f.envelope.replyPlan,turnId:'new-turn'}};
 await assert.rejects(send(f.contents[0].id,'new turn',next),/hard budget limit/);
 budget.hardLimitYuan=0.8;
 await assert.rejects(send(f.contents[0].id,'changed policy'),/hard budget limit/);
 assert.deepEqual(sent,['start','finish']);
});

test('external spending that exhausts global budget blocks continued delivery',async()=>{
 const budget={stage:'normal',periodStart:1,hardLimitYuan:5,globalHardLimitYuan:3,cost:0.9,globalCost:2};
 const f=fixture({},()=>budget);
 const context=f.transport.capture({key:f.key,envelope:f.envelope,agent:true,contentId:f.contents[0].id});
 await f.transport.perform({key:f.key,context,text:'start',send:async()=>{}});
 Object.assign(budget,{stage:'silent',globalCost:3.1});
 await assert.rejects(f.transport.perform({key:f.key,context,text:'finish',send:async()=>assert.fail('unexpected delivery')}),/hard budget limit/);
});
test('unselected or foreign semantic content fails before physical network writes',async()=>{
 const f=fixture();let sent=0;
 for(const contentId of [undefined,'content:foreign']){const context=f.transport.capture({key:f.key,envelope:f.envelope,agent:true,contentId});
  await assert.rejects(f.transport.perform({key:f.key,context,text:'不可发',send:async()=>{sent++;}}),/content_required|content_not_found/);
 }
 assert.equal(sent,0);
});
