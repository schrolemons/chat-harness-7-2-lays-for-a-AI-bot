import test from'node:test';import assert from'node:assert/strict';
import{createPlugin}from'../plugins/qq-components/ctx-chat-reply-shape/index.js';
test('a new wake cannot reuse a completed chat source while current multipart delivery and fresh requests work',()=>{
 let state={};const key='group:123',svc=createPlugin({config:{maxMessagesNormal:4,maxMessagesCasual:4,maxMessagesSerious:4,maxSendPerMinute:100,maxSendPerHour:1000,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},state:{get:()=>structuredClone(state),set:p=>state={...state,...structuredClone(p)}},callService:()=>null}).services.replyPlan;
 const message={seq:1,messageId:'m1',text:'这只猫眼睛圆圆的',bodyComplete:true,isSelf:false},first=svc.resolve({key,turnId:'wake-a',messages:[message]});
 const reservation=svc.reserve({key,plan:first,operationId:'a',kind:'text',text:'眼睛真圆',now:100});assert.equal(reservation.ok,true);svc.commit({key,operationId:'a',sentAt:101});
 assert.equal(svc.bindContent({key,plan:first,messages:[message]}).ok,true,'multipart delivery remains possible before completion is reported');
 message.repliedAt=102;
 assert.equal(svc.bindContent({key,plan:first,messages:[message]}).reason,'source_already_replied','a completed source cannot be rephrased and resent inside the same long turn');
 const next=svc.resolve({key,turnId:'wake-b',messages:[message]});assert.equal(svc.bindContent({key,plan:next,messages:[message]}).reason,'source_already_replied');
 const fresh={...message,seq:2,messageId:'m2',text:'再说一遍刚才那句',repliedAt:undefined};
 const freshPlan=svc.resolve({key,turnId:'wake-c',messages:[fresh]});assert.equal(svc.bindContent({key,plan:freshPlan,messages:[fresh]}).ok,true,'explicit new request owns a fresh source');
});

test('explicitly resolved sources close in the current turn and remain closed after reload',()=>{
 let state={};const key='group:123',make=()=>createPlugin({config:{},state:{get:()=>structuredClone(state),set:p=>state={...state,...structuredClone(p)}},callService:()=>null}).services.replyPlan;
 let svc=make();const message={seq:1,messageId:'poke-1',text:'戳了戳你',bodyComplete:true,isSelf:false};const plan=svc.resolve({key,turnId:'long-turn',messages:[message]});
 message.resolvedAt=100;assert.equal(svc.bindContent({key,plan,messages:[message]}).reason,'source_already_replied');
 svc=make();assert.equal(svc.bindContent({key,plan,messages:[message]}).reason,'source_already_replied');
});
