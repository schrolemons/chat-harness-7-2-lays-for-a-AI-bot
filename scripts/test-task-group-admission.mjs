import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
const key='private:123',now=1_000_000;
function fixture(config={},seed={}){
 let state=structuredClone(seed);
 const svc=createPlugin({config:{maxMessagesNormal:3,maxMessagesCasual:3,maxMessagesSerious:3,maxSendPerMinute:1,maxSendPerHour:10,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0,...config},state:{get:()=>structuredClone(state),set:p=>state={...state,...structuredClone(p)}},callService:()=>null,isPluginEnabled:()=>false}).services.replyPlan;
 const plan=svc.resolve({key,turnId:'task-wake',taskExempt:true,now});
 return {svc,plan,state:()=>state};
}
test('a task group spends one real rate point once while physical task reports spend none',()=>{
 const f=fixture();assert.equal(typeof f.svc.claimTaskGroup,'function');
 const claim=f.svc.claimTaskGroup({key,groupId:'task-one',plan:f.plan,now});assert.equal(claim.ok,true);assert.equal(claim.reused,false);
 assert.equal(f.svc.preview({key,now}).minute,1);assert.equal(f.svc.preview({key,now}).successful,0);
 const plan={...f.plan,taskGroupId:'task-one'};
 for(let n=0;n<7;n++){
  const operationId='task-part'+n;assert.equal(f.svc.reserve({key,plan,operationId,kind:'text',text:operationId,now}).ok,true);
  assert.equal(f.svc.commit({key,operationId,sentAt:now,deliveryId:operationId}).ok,true);
 }
 assert.equal(f.svc.preview({key,now}).minute,1);assert.equal(f.svc.preview({key,now}).successful,7);
 const g=fixture({},f.state()),repeat=g.svc.claimTaskGroup({key,groupId:'task-one',plan:g.plan,now:now+1});assert.equal(repeat.ok,true);assert.equal(repeat.reused,true);assert.deepEqual(repeat.admission,claim.admission);
 assert.equal(g.state().sendLedger.conversations[key].taskCredits.length,1);
 const blocked=g.svc.claimTaskGroup({key,groupId:'task-two',plan:g.plan,now});assert.equal(blocked.ok,false);assert.equal(blocked.reason,'minute_limit');assert.equal(blocked.nextAt,now+60001);
 assert.equal(g.svc.claimTaskGroup({key,groupId:'task-two',plan:g.plan,now:blocked.nextAt}).ok,true);
});
test('declared task content stays pending and cannot send until its group admission is stored',()=>{
 const f=fixture(),messages=[{seq:1,messageId:'m1',text:'执行任务',bodyComplete:true,isSelf:false}],plan=f.svc.resolve({key,turnId:'source-task',messages,now});
 const declared=f.svc.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'task'}],taskEligible:{1:true}});assert.equal(declared.ok,true);
 const id=declared.contents[0].id;assert.equal(declared.contents[0].taskPending,true);assert.equal(declared.contents[0].taskExempt,false);
 assert.equal(f.svc.reserve({key,plan:{...plan,contentId:id,taskExempt:true},operationId:'unpaid',now}).reason,'task_group_pending');
 assert.equal(f.svc.bindContent({key,plan,contentId:id}).reason,'task_group_pending');
 const admitted=f.svc.claimTaskGroup({key,groupId:id,plan,now});assert.equal(admitted.ok,true);
 const content=f.svc.getContent({key,contentId:id});assert.equal(content.taskPending,false);assert.equal(content.taskExempt,true);assert.equal(content.taskGroupAdmission.groupId,id);
 const bound=f.svc.bindContent({key,plan,contentId:id});assert.equal(bound.ok,true);assert.equal(bound.plan.taskGroupId,id);
 assert.equal(f.svc.reserve({key,plan:bound.plan,operationId:'paid',now}).ok,true);
});
test('unadmitted direct task flags cannot bypass rates or parts and failed admission remains pending',()=>{
 const f=fixture();assert.equal(f.svc.reserve({key,plan:f.plan,operationId:'no-credit',now}).reason,'task_group_pending');
 assert.equal(f.svc.claimTaskGroup({key,groupId:'first',plan:f.plan,now}).ok,true);
 const blocked=f.svc.claimTaskGroup({key,groupId:'second',plan:f.plan,now});assert.equal(blocked.ok,false);
 assert.equal(f.svc.reserve({key,plan:{...f.plan,taskGroupId:'second'},operationId:'pending',now}).reason,'task_group_pending');
 assert.equal(f.state().sendLedger.conversations[key].taskCredits.length,1);
});
test('scaled hour limits and unlimited configured rates apply to separate task credits',()=>{
 const f=fixture({maxSendPerMinute:0,maxSendPerHour:100}),plan=f.svc.resolve({key,turnId:'scaled',taskExempt:true,mood:{score:0},willingness:0,now});
 assert.equal(plan.maxSendPerHour,4);
 for(let n=0;n<4;n++)assert.equal(f.svc.claimTaskGroup({key,groupId:'task'+n,plan,now}).ok,true);
 const blocked=f.svc.claimTaskGroup({key,groupId:'fifth',plan,now});assert.equal(blocked.reason,'hour_limit');assert.equal(blocked.nextAt,now+3600001);
 const g=fixture({maxSendPerMinute:0,maxSendPerHour:0});for(let n=0;n<5;n++)assert.equal(g.svc.claimTaskGroup({key,groupId:'free'+n,plan:g.plan,now}).ok,true);
 assert.equal(g.svc.preview({key,now}).minute,5);assert.equal(g.svc.preview({key,now}).allowed,true);assert.equal(g.svc.preview({key,now}).successful,0);
});
test('single admitted task source prepares a pending unit without charging or waking and can bind after one credit',()=>{
 const f=fixture(),messages=[{seq:9,messageId:'m9',text:'请执行任务',bodyComplete:true,isSelf:false}],taskSources={9:{eligible:true,kind:'execution'}};
 const pending=f.svc.resolve({key,turnId:'actual-wake',messages,taskSources,now});
 assert.ok(pending.contentId);assert.equal(pending.taskGroupId,pending.contentId);assert.equal(pending.taskPending,true);assert.equal(pending.taskExempt,false);
 assert.equal(f.svc.preview({key,now}).minute,0);assert.equal(f.svc.progress({plan:pending}).taskPending,true);
 assert.equal(f.svc.claimTaskGroup({key,groupId:pending.taskGroupId,plan:pending,now}).ok,true);
 assert.equal(f.svc.bindContent({key,plan:pending}).plan.taskExempt,true);assert.equal(f.svc.bindContent({key,plan:pending}).plan.taskPending,false);
 const continuation=f.svc.resolve({key,turnId:'report-turn',taskExempt:true,taskGroupId:pending.taskGroupId,now});assert.equal(continuation.taskGroupId,pending.contentId);
 assert.equal(f.svc.bindContent({key,plan:continuation}).ok,true);
 const multiple=f.svc.resolve({key,turnId:'mixed',messages:[...messages,{seq:10,messageId:'m10',text:'闲聊',bodyComplete:true,isSelf:false}],taskSources,now});assert.equal(multiple.contentId,undefined);
});
test('one paid task delivery never authorizes replied receipts for another unpaid task or a future reused seq',()=>{
 const f=fixture(),messages=[1,2].map(seq=>({seq,messageId:'task-source-'+seq,text:'执行任务'+seq,bodyComplete:true,isSelf:false})),plan=f.svc.resolve({key,turnId:'mixed',messages,now});
 const declared=f.svc.declareContents({key,plan,messages,taskEligible:{1:true,2:true},groups:[{seqs:[1],kind:'task'},{seqs:[2],kind:'task'}]});assert.equal(declared.ok,true);
 assert.equal(f.svc.claimTaskGroup({key,plan,groupId:declared.contents[0].id,now}).ok,true);
 assert.equal(f.svc.claimTaskGroup({key,plan,groupId:declared.contents[1].id,now}).ok,false);
 assert.equal(typeof f.svc.validateReceipts,'function');
 const denied=f.svc.validateReceipts({key,messages,receipts:[{seq:1,status:'replied'},{seq:2,status:'replied'}]});assert.equal(denied.ok,false);assert.equal(denied.reason,'task_group_pending');assert.deepEqual(denied.seqs,[2]);
 assert.equal(f.svc.validateReceipts({key,messages,receipts:[{seq:1,status:'replied'},{seq:2,status:'seen'}]}).ok,true);
 const reset=[{seq:2,messageId:'new-after-reset',text:'ordinary current message',bodyComplete:true,isSelf:false}];
 assert.equal(f.svc.validateReceipts({key,messages:reset,receipts:[{seq:2,status:'replied'}]}).ok,true);
});
test('server verified undeclared mixed task sources cannot borrow another group delivery receipt',()=>{
 const f=fixture(),messages=[1,2].map(seq=>({seq,messageId:'mixed-undeclared-'+seq,text:'执行'+seq,bodyComplete:true,isSelf:false})),taskSources={1:{eligible:true},2:{eligible:true}},plan=f.svc.resolve({key,turnId:'mixed-unpaid',messages,taskSources,now});
 const declared=f.svc.declareContents({key,plan,messages,taskEligible:taskSources,groups:[{seqs:[1],kind:'task'}]});assert.equal(declared.ok,true);assert.equal(f.svc.claimTaskGroup({key,plan,groupId:declared.contents[0].id,now}).ok,true);
 const denied=f.svc.validateReceipts({key,messages,taskSources,receipts:[{seq:1,status:'replied'},{seq:2,status:'replied'}]});assert.equal(denied.ok,false);assert.equal(denied.reason,'task_group_pending');assert.deepEqual(denied.seqs,[2]);
 assert.equal(f.svc.validateReceipts({key,messages,taskSources,receipts:[{seq:1,status:'replied'},{seq:2,status:'seen'}]}).ok,true);
 assert.equal(f.svc.validateReceipts({key,messages,taskSources,receipts:[{seq:2,status:'ignored'}]}).ok,true);
});
