import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
import {createOutboundTransport} from '../src/outbound-context.js';
function fixture(){
 const key='private:123';let state={};const svc=createPlugin({config:{maxMessagesNormal:3,maxMessagesCasual:3,maxMessagesSerious:3,maxSendPerMinute:0,maxSendPerHour:0,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},state:{get:()=>state,set:p=>state={...state,...structuredClone(p)}},capabilities:{},callService:()=>null,isPluginEnabled:()=>false}).services.replyPlan;
 const messages=[1,2,3].map(seq=>({seq,messageId:String(seq),text:'完整意思'+seq,bodyComplete:true,isSelf:false}));
 const plan=svc.resolve({key,turnId:'wake',messages});const contents=svc.declareContents({key,plan,messages,groups:messages.map(m=>({seqs:[m.seq],kind:'chat'}))}).contents;
 const transport=createOutboundTransport({callService:(s,m,p)=>s==='replyPlan'?svc[m]?.(p):null,contentFacts:()=>({messages}),sleep:async()=>{}});
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
test('unselected or foreign semantic content fails before physical network writes',async()=>{
 const f=fixture();let sent=0;
 for(const contentId of [undefined,'content:foreign']){const context=f.transport.capture({key:f.key,envelope:f.envelope,agent:true,contentId});
  await assert.rejects(f.transport.perform({key:f.key,context,text:'不可发',send:async()=>{sent++;}}),/content_required|content_not_found/);
 }
 assert.equal(sent,0);
});
