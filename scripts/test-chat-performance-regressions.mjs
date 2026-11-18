import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createProactive} from '../plugins/qq-components/life-wake-reasons/proactive.mjs';
import {createPlugin as createReplies} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
import {createTopicActions} from '../plugins/qq-components/ctx-chat-topic-drive/topic-actions.mjs';
import {createPlugin as createMemory} from '../plugins/qq-components/ctx-memory-store/index.js';
import {createOutboundTransport} from '../src/outbound-context.js';
const memory=initial=>{let data=initial||{};return {get:()=>data,set:patch=>data={...data,...patch}};};
const now=Date.parse('2026-11-12T13:00:00+08:00'),day=86400000;
function availability(key,age,{quiet=false,assessment}={}){
 const at=now-age,state=memory({proactiveByKey:{[key]:{availabilityVersion:1,willingness:15,source:'ai',stage:2,lastAI:{value:15,at,reason:'群友先去开会了',...(assessment?{assessment}:{})}}}});
 const service=createProactive({config:{curfewEnabled:false},state,callService:(s,m)=>s==='availability'&&m==='getPlan'?{quietNow:quiet}:null});
 return {service,state};
}
test('old meeting and group-night assessments return to unknown neutral, without rewriting evidence',()=>{
 for(const key of ['private:123','group:456']){const f=availability(key,12*day),before=structuredClone(f.state.get());const a=f.service.availability({key,now});
  assert.equal(a.willingness,60);assert.equal(a.source,'evidence-expired');assert.equal(a.review.required,true);assert.equal(a.lastAI.value,15);assert.deepEqual(f.state.get(),before);
 }
});
test('fresh low assessments and current quiet plans remain binding',()=>{
 for(const [age,quiet] of [[day-1,false],[12*day,true]]){const f=availability('private:123',age,{quiet});assert.equal(f.service.availability({key:'private:123',now}).willingness,15);}
});
test('unconfirmed private sleep is reviewed rather than inferred awake from age',()=>{
 const f=availability('private:123',12*day,{assessment:{kind:'sleep'}}),a=f.service.availability({key:'private:123',now});assert.equal(a.willingness,15);assert.equal(a.review.required,true);
});
test('hourly maintenance waits for a quiet gap instead of starting between live replies',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chat-memory-idle-')),key='group:456',wakes=[],state=memory({lastIncomingAt:{[key]:now-60000},lastWriteAt:{[key]:now-2*3600000}});
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const plugin=createMemory({root,config:{dailyDiary:{enabled:false}},state,log(){},warn(){},registerTool(){},capabilities:{listConversationKeys:()=>[key],requestMemoryWrite:(...args)=>{wakes.push(args);return true;}}});
 await plugin.hooks.onTick({now});assert.equal(wakes.length,0);
 await plugin.hooks.onTick({now:now+5*60000});assert.equal(wakes.length,1);
});
test('authorized post-wait topic reaches transport with its own content budget and original reply receipts intact',async()=>{
 for(const key of ['private:123','group:456']){
 const replyState=memory(),topicState=memory(),services={};const call=(s,m,p)=>services[s]?.[m]?.(p);
 services.replyPlan=createReplies({config:{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},state:replyState,callService:call,capabilities:{}}).services.replyPlan;
 services.conversationDrive=createTopicActions({state:topicState});
 const messages=[{seq:1,messageId:'one',text:'聊聊旅行',bodyComplete:true}],plan=services.replyPlan.resolve({key,turnId:'sid:1',agent:true,messages,mood:{enabled:false}}),original=plan.contentId;
 const choice=services.conversationDrive.afterWait({key,scope:'sid:1',seq:1,emptyWaits:1,endRound:false,random:()=>.6,now});assert.equal(choice.action,'newTopic');
 const context={key,sourceKey:key,actionId:'wave',agent:true,origin:'conversation',reason:'message',plan,contentId:original,envelope:{sessionId:'sid',turn:1},conversationIntent:'newTopic',topicId:'walk'};
 const transport=createOutboundTransport({callService:call,clock:()=>now,sleep:async()=>{},contentFacts:()=>({messages})});let sends=0;
 await transport.perform({key,context,text:'AI助手刚想到一个散步的话题。',send:async()=>{sends++;return {data:{message_id:'test'}};}});
 const ledger=replyState.get().sendLedger;
 assert.equal(sends,1);assert.equal(ledger.contentCounts?.[original]||0,0,'new topic does not consume an old inbound reply');
 const active=Object.values(ledger.contents).find(c=>c.id!==original);assert.ok(active);assert.deepEqual(active.seqs,[]);assert.equal(ledger.contentCounts[active.id],1);
 }
});
