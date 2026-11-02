import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
const key='private:123',now=1_000_000;
function fixture(){
 let state={};
 const svc=createPlugin({config:{maxMessagesNormal:3,maxMessagesCasual:3,maxMessagesSerious:3,maxSendPerMinute:100,maxSendPerHour:1000,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},state:{get:()=>structuredClone(state),set:p=>state={...state,...structuredClone(p)}},callService:()=>null,isPluginEnabled:()=>false}).services.replyPlan;
 return {svc,plan:svc.resolve({key,turnId:'task',taskExempt:true,now})};
}
function deliver(f,plan,operationId,inputSeq){
 const result=f.svc.reserve({key,plan,operationId,inputSeq,text:'好',kind:'text',now});
 if(result.ok)assert.equal(f.svc.commit({key,operationId,sentAt:now,deliveryId:operationId}).ok,true);
 return result;
}
test('task delivery dedupe follows its paid stable group across new highest input seqs',()=>{
 const f=fixture();for(const groupId of ['task-a','task-b'])assert.equal(f.svc.claimTaskGroup({key,groupId,plan:f.plan,now}).ok,true);
 const a={...f.plan,taskGroupId:'task-a'},b={...f.plan,taskGroupId:'task-b'};
 assert.equal(deliver(f,a,'first',5).ok,true);
 assert.equal(deliver(f,b,'independent-task',5).ok,true);
 assert.equal(deliver(f,a,'reread',6).reason,'duplicate_delivery');
 assert.equal(deliver(f,a,'continuation-without-seq').reason,'duplicate_delivery');
});
test('content-bound execution and source-less report for one task share delivery dedupe',()=>{
 const f=fixture(),messages=[{seq:1,messageId:'m1',text:'执行任务',bodyComplete:true,isSelf:false}],pending=f.svc.resolve({key,turnId:'source',messages,taskSources:{1:{eligible:true}},now});
 assert.equal(f.svc.claimTaskGroup({key,groupId:pending.contentId,plan:pending,now}).ok,true);
 const bound=f.svc.bindContent({key,plan:pending}).plan;assert.equal(deliver(f,bound,'execution',1).ok,true);
 const report={...f.plan,taskGroupId:pending.contentId};assert.equal(deliver(f,report,'report',9).reason,'duplicate_delivery');
});
