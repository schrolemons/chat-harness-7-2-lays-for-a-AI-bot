import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';

const key='private:123',now=1_000_000;
const message=(seq,text='问题'+seq,extra={})=>({seq,messageId:'m'+seq,text,plain:text,isSelf:false,bodyComplete:true,...extra});
function fixture(config={},seed={}){
 let state=structuredClone(seed);
 const plugin=createPlugin({config:{maxMessagesNormal:3,maxMessagesCasual:3,maxMessagesSerious:3,maxSendPerMinute:100,maxSendPerHour:1000,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0,...config},state:{get:()=>structuredClone(state),set:p=>state={...state,...structuredClone(p)}},callService:()=>null,isPluginEnabled:()=>false});
 const svc=plugin.services.replyPlan;
 return {svc,plugin,state:()=>state,resolve:extra=>svc.resolve({key,turnId:'wake',incomingText:'问题',now,...extra})};
}
function send(f,plan,id,extra={}){
 const r=f.svc.reserve({key,plan,operationId:id,kind:'text',text:id,now,...extra});
 if(r.ok)assert.equal(f.svc.commit({key,operationId:r.operationId,sentAt:now,deliveryId:id}).ok,true);
 return r;
}

test('three grounded semantic contents each send three physical parts in one wake',()=>{
 const f=fixture(),messages=[message(1),message(2),message(3)],plan=f.resolve({messages});
 assert.equal(typeof f.svc.declareContents,'function');
 const declared=f.svc.declareContents({key,plan,messages,groups:messages.map(m=>({seqs:[m.seq],kind:'chat'}))});
 assert.equal(declared.ok,true);assert.equal(declared.contents.length,3);
 for(const content of declared.contents){
  const bound=f.svc.bindContent({key,sourceKey:key,plan,contentId:content.id});assert.equal(bound.ok,true);
  for(let n=1;n<=3;n++)assert.equal(send(f,bound.plan,content.id+':'+n).ok,true);
  assert.equal(send(f,bound.plan,content.id+':4').reason,'content_limit');
 }
 assert.equal(f.svc.preview({key,now}).successful,9);
});

test('mood and availability scale rolling rates while reference and mood ceilings preserve part caps',()=>{
 const f=fixture({maxSendPerMinute:10,maxSendPerHour:100}),factors={referenceMode:'knowledge',mood:{enabled:true,score:0,replyCeiling:1},willingness:0};
 const plan=f.resolve({...factors,messages:[message(1)]});
 assert.equal(plan.maxMessages,3);assert.equal(plan.maxParts,3);
 assert.equal(plan.maxSendPerMinute,1);assert.equal(plan.maxSendPerHour,4);
 assert.equal(send(f,plan,'first').ok,true);assert.equal(send(f,plan,'second part').ok,true);
 assert.equal(send(f,f.resolve({...factors,messages:[message(2)]}),'new content').reason,'minute_limit');
});

test('rereads and declarations in later model calls never renew one content, including after reload',()=>{
 const f=fixture(),messages=[message(7)],plan=f.resolve({messages});
 for(let n=0;n<3;n++)assert.equal(send(f,plan,'part'+n).ok,true);
 const restarted=fixture({},f.state()),next=restarted.resolve({turnId:'another-model-call',messages});
 assert.equal(next.contentId,plan.contentId);assert.equal(send(restarted,next,'fourth').reason,'content_limit');
 const declaration=restarted.svc.declareContents({key,plan:next,messages,groups:[{seqs:[7],kind:'chat'}]});
 assert.equal(declaration.ok,true);assert.equal(declaration.contents[0].id,plan.contentId);
 assert.equal(restarted.svc.progress({plan:next}).successful,3);
});

test('unsent fragments merge once; subsets keep the merged identity and cannot split or change sent grouping',()=>{
 const f=fixture(),messages=[message(1,'你知道'),message(2,'这道题怎么做吗')],plan=f.resolve({messages});
 const declared=f.svc.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'chat'},{seqs:[2],kind:'chat'}]});
 const merged=f.svc.declareContents({key,plan,messages,groups:[{seqs:[1,2],kind:'chat'}]});assert.equal(merged.ok,true);
 const oldBound=f.svc.bindContent({key,plan,contentId:declared.contents[0].id});assert.equal(oldBound.ok,true);assert.equal(oldBound.content.id,merged.contents[0].id);
 const subset=f.svc.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'chat'}]});assert.equal(subset.ok,true);assert.equal(subset.contents[0].id,merged.contents[0].id);
 assert.equal(f.svc.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'chat'},{seqs:[2],kind:'chat'}]}).reason,'grouping_conflict');
 assert.equal(send(f,oldBound.plan,'answer').ok,true);
 assert.equal(f.svc.declareContents({key,plan,messages:[...messages,message(3)],groups:[{seqs:[1,2,3],kind:'chat'}]}).reason,'content_already_started');
});

test('declarations reject overlap, self, clipped, missing and changed source identities atomically',()=>{
 const f=fixture(),messages=[message(1),message(2)],plan=f.resolve({messages});
 assert.equal(f.svc.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'chat'},{seqs:[1],kind:'chat'}]}).reason,'source_overlap');
 for(const msg of [message(1,'x',{isSelf:true}),message(1,'x',{truncated:true}),message(1,'x',{bodyComplete:false})]){
  assert.equal(f.svc.declareContents({key,plan,messages:[msg],groups:[{seqs:[1],kind:'chat'}]}).reason,'source_not_admitted');
 }
 assert.equal(f.svc.declareContents({key,plan,messages,groups:[{seqs:[99],kind:'chat'}]}).reason,'source_not_admitted');
 assert.equal(f.svc.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'chat'}]}).ok,true);
 assert.equal(f.svc.declareContents({key,plan,messages:[message(1,'changed')],groups:[{seqs:[1],kind:'chat'}]}).reason,'source_changed');
 assert.equal(f.svc.bindContent({key:'private:456',sourceKey:'private:456',plan,contentId:'bad'}).ok,false);
});

test('uncertain reservations consume only their content and known failure frees it persistently',()=>{
 const f=fixture(),messages=[message(1),message(2)],plan=f.resolve({messages}),declared=f.svc.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'chat'},{seqs:[2],kind:'chat'}]});
 const a=f.svc.bindContent({key,plan,contentId:declared.contents[0].id}).plan,b=f.svc.bindContent({key,plan,contentId:declared.contents[1].id}).plan;
 for(let n=0;n<3;n++)assert.equal(f.svc.reserve({key,plan:a,operationId:'unknown'+n,now}).ok,true);
 assert.equal(f.svc.release({key,operationId:'unknown0',knownFailed:false}).reason,'uncertain_delivery');
 const g=fixture({},f.state());assert.equal(send(g,a,'over').reason,'content_limit');assert.equal(send(g,b,'other').ok,true);
 assert.equal(g.svc.release({key,operationId:'unknown0',knownFailed:true}).ok,true);assert.equal(send(g,a,'retry').ok,true);
 assert.equal(g.svc.declareContents({key,plan,messages,groups:[{seqs:[1,2],kind:'chat'}]}).reason,'content_already_started');
});

test('admitted tasks spend one group credit then bypass physical rate and part charges without disabling dedupe',()=>{
 const f=fixture({maxSendPerMinute:2,maxSendPerHour:2}),messages=[message(1),message(2,'请执行并汇报')],plan=f.resolve({messages});
 assert.equal(f.svc.declareContents({key,plan,messages,groups:[{seqs:[2],kind:'task'}]}).reason,'task_not_eligible');
 const declared=f.svc.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'chat'},{seqs:[2],kind:'task'}],taskEligible:{2:true}});assert.equal(declared.ok,true);
 assert.equal(f.svc.claimTaskGroup({key,groupId:declared.contents[1].id,plan,now}).ok,true);
 const chat=f.svc.bindContent({key,plan,contentId:declared.contents[0].id}).plan,task=f.svc.bindContent({key,plan,contentId:declared.contents[1].id}).plan;
 assert.equal(send(f,chat,'chat').ok,true);
 for(let n=0;n<7;n++)assert.equal(send(f,task,'task'+n,{inputSeq:2}).ok,true);
 assert.equal(send(f,task,'task0',{inputSeq:2}).reason,'duplicate_delivery');
 assert.equal(f.svc.preview({key,now}).minute,2);assert.equal(f.svc.preview({key,plan:task,now}).allowed,true);
 assert.equal(send(f,chat,'chat2').ok,true);assert.equal(f.svc.remaining({plan:chat}),1);
 assert.equal(send(f,f.resolve({messages:[message(3)]}),'new chat').reason,'minute_limit');
 assert.equal(f.svc.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'task'}],taskEligible:{1:true}}).reason,'content_already_started');
 const direct={...f.resolve({turnId:'trusted-task',taskExempt:true}),taskGroupId:declared.contents[1].id};assert.equal(send(f,direct,'direct').ok,true);
});

test('ordinary agents need a valid grounded content; operator sends keep rate tracking without part quotas',()=>{
 const f=fixture(),plan=f.resolve({messages:[message(1),message(2)]});
 assert.equal(f.svc.remaining({plan}),Number.MAX_SAFE_INTEGER,'preflight has no batch ceiling; physical reserve validates selection');
 assert.equal(f.svc.bindContent({key,plan}).reason,'content_required');
 assert.equal(send(f,plan,'ungrouped').reason,'content_required');
 assert.equal(send(f,{...plan,contentId:'invented'},'invented').reason,'content_not_found');
 const operator=f.resolve({agent:false});for(let n=0;n<5;n++)assert.equal(send(f,operator,'operator'+n).ok,true);
 assert.equal(f.svc.preview({key,now}).minute,5);
});

test('content binding revalidates admitted complete source bodies and requires a valid frozen source plan',()=>{
 const f=fixture(),plan=f.resolve({messages:[message(1)]});
 assert.equal(f.svc.bindContent({key,plan,messages:[message(1)]}).ok,true);
 assert.equal(f.svc.bindContent({key,plan,messages:[]}).reason,'source_not_admitted');
 assert.equal(f.svc.bindContent({key,plan,messages:[message(1,'edited')]}).reason,'source_not_admitted');
 assert.equal(f.svc.bindContent({key,taskExempt:true}).reason,'invalid_plan');
});

test('identical words to different semantic contents remain independent while one content deduplicates across rereads',()=>{
 const f=fixture(),messages=[message(1),message(2)],plan=f.resolve({messages}),declared=f.svc.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'chat'},{seqs:[2],kind:'chat'}]});
 const a=f.svc.bindContent({key,plan,contentId:declared.contents[0].id}).plan,b=f.svc.bindContent({key,plan,contentId:declared.contents[1].id}).plan;
 assert.equal(send(f,a,'same words',{inputSeq:2}).ok,true);
 assert.equal(send(f,b,'same words',{inputSeq:2,operationId:'other-content'}).ok,true);
 assert.equal(send(f,a,'same words',{inputSeq:3,operationId:'reread'}).reason,'duplicate_delivery');
});

test('task binding bypasses an ordinary pacing backlog and later reads do not leak its exemption',()=>{
 const f=fixture({intervalMinMs:5000,intervalMaxMs:5000}),chat=f.resolve({messages:[message(1)]});assert.equal(send(f,chat,'chat').ok,true);
 const task={...f.resolve({turnId:'task',taskExempt:true}),taskGroupId:'pacing-task'};
 assert.equal(f.svc.claimTaskGroup({key,groupId:'pacing-task',plan:task,now}).ok,true);
 const bound=f.svc.bindContent({key,sourceKey:key,plan:task,taskExempt:true});assert.equal(bound.ok,true);
 assert.equal(f.svc.reserve({key,plan:bound.plan,operationId:'task',now}).waitMs,0);
 const read=f.svc.forMessages({key,actionId:'task',currentPlan:task,baselineSeq:1,messages:[message(2)]});assert.equal(read.plan.taskExempt,false);
});

test('task exemption cannot leak from another selected scope onto an ordinary content',()=>{
 const f=fixture({maxSendPerMinute:1}),messages=[message(1)],plan=f.resolve({messages});
 const bound=f.svc.bindContent({key,plan:{...plan,taskExempt:true},contentId:plan.contentId,taskExempt:true});assert.equal(bound.ok,true);assert.equal(bound.plan.taskExempt,false);
 assert.equal(send(f,bound.plan,'first').ok,true);
 const separate=f.resolve({messages:[message(2)]});
 assert.equal(send(f,{...separate,taskExempt:true},'should-not-bypass').reason,'minute_limit');
});

test('new reads retain the scope identity and part policy rather than creating a batch ceiling',()=>{
 const f=fixture(),plan=f.resolve({messages:[message(1)]});assert.equal(send(f,plan,'old').ok,true);
 const read=f.svc.forMessages({key,actionId:'wake',baselineSeq:1,currentPlan:plan,messages:[message(1),message(2)]});
 assert.equal(read.changed,true);assert.equal(read.plan.turnId,plan.turnId);assert.equal(read.plan.maxMessages,3);assert.equal(read.plan.contentId,undefined);
 const repeated=f.svc.forMessages({key,actionId:'wake',baselineSeq:1,currentPlan:read.plan,messages:[message(1),message(2)]});assert.equal(repeated.changed,false);
 const old=f.svc.bindContent({key,plan:read.plan,contentId:plan.contentId});assert.equal(old.ok,true);assert.equal(f.svc.remaining({plan:old.plan}),2);
});

test('trusted autonomous admission has its own persistent content while a reason alone grants nothing',()=>{
 const f=fixture();assert.equal(send(f,f.resolve({reason:'proactiveCheck'}),'spoof').reason,'content_required');
 const autonomousSource={id:'actual-admission-123',kind:'proactiveCheck'},plan=f.resolve({reason:'proactiveCheck',autonomousSource});
 assert.ok(plan.contentId);for(let n=0;n<3;n++)assert.equal(send(f,plan,'auto'+n).ok,true);
 const g=fixture({},f.state()),repeat=g.resolve({turnId:'different-call',reason:'proactiveCheck',autonomousSource});
 assert.equal(repeat.contentId,plan.contentId);assert.equal(send(g,repeat,'fourth').reason,'content_limit');
 const next=g.resolve({reason:'proactiveCheck',autonomousSource:{id:'actual-admission-124',kind:'proactiveCheck'}});assert.equal(send(g,next,'next-event').ok,true);
});

test('a reply reference selects only the declared content of its actual admitted source',()=>{
 const f=fixture(),messages=[message(1),message(2)],plan=f.resolve({messages});
 const declared=f.svc.declareContents({key,plan,messages,groups:[{seqs:[1],kind:'chat'},{seqs:[2],kind:'chat'}]});assert.equal(declared.ok,true);
 const bound=f.svc.bindContent({key,plan,messages,replyToMessageId:'m2'});assert.equal(bound.ok,true);assert.equal(bound.content.id,declared.contents[1].id);
 assert.equal(send(f,bound.plan,'reference answer').ok,true);assert.equal(f.svc.remaining({plan:bound.plan}),2);
 assert.equal(f.svc.bindContent({key,plan,messages:[message(1)],replyToMessageId:'m2'}).reason,'source_not_admitted');
 assert.equal(f.svc.bindContent({key,plan,messages,replyToMessageId:'unknown-unread'}).reason,'source_not_admitted');
 const unread=[...messages,message(3)];assert.equal(f.svc.bindContent({key,plan,messages:unread,replyToMessageId:'m3'}).reason,'content_required');
});

test('replying to either admitted fragment selects one canonical merged content',()=>{
 const f=fixture(),messages=[message(1,'第一部分'),message(2,'接着说')],plan=f.resolve({messages});
 const merged=f.svc.declareContents({key,plan,messages,groups:[{seqs:[1,2],kind:'chat'}]});assert.equal(merged.ok,true);
 for(const replyToMessageId of ['m1','m2']){
  const bound=f.svc.bindContent({key,plan,messages,replyToMessageId});assert.equal(bound.ok,true);assert.equal(bound.content.id,merged.contents[0].id);
 }
});

test('new message identities after seq reset receive new scopes while the original message never renews',()=>{
 const f=fixture(),first=message(1,'first',{messageId:'before-reset'}),plan=f.resolve({messages:[first]});
 for(let n=0;n<3;n++)assert.equal(send(f,plan,'old'+n).ok,true);
 const reset=message(1,'new after reset',{messageId:'after-reset'}),next=f.resolve({turnId:'after-reset',messages:[reset]});
 assert.ok(next.contentId);assert.notEqual(next.contentId,plan.contentId);assert.equal(send(f,next,'new').ok,true);
 const old=f.resolve({turnId:'reread-old',messages:[{...first,seq:9}]});assert.equal(old.contentId,plan.contentId);assert.equal(send(f,old,'no-renewal').reason,'content_limit');
 const bound=f.svc.bindContent({key,plan:next,messages:[reset],contentId:next.contentId});assert.equal(bound.ok,true);
 assert.equal(f.svc.bindContent({key,plan:{...next,contentId:undefined},messages:[reset],replyToMessageId:'after-reset'}).content.id,next.contentId);
});

test('a server admitted direct prompt gets one persistent content across model steps',()=>{
 const f=fixture(),source={id:'direct-admission-1',kind:'directMessage'},plan=f.resolve({autonomousSource:source});assert.ok(plan.contentId);
 for(let n=0;n<3;n++)assert.equal(send(f,plan,'direct'+n).ok,true);
 const next=f.resolve({turnId:'another-step',autonomousSource:source});assert.equal(next.contentId,plan.contentId);assert.equal(send(f,next,'direct4').reason,'content_limit');
});

test('semantic declarations cannot label a server verified task source as chat to skip its admission credit',()=>{
 const f=fixture(),messages=[message(1),message(2)],plan=f.resolve({messages});
 assert.equal(f.svc.declareContents({key,plan,messages,taskEligible:{2:{eligible:true}},groups:[{seqs:[1],kind:'chat'},{seqs:[2],kind:'chat'}]}).reason,'task_kind_required');
 assert.equal(f.svc.declareContents({key,plan,messages,taskEligible:{2:{eligible:true}},groups:[{seqs:[1,2],kind:'chat'}]}).reason,'task_kind_required');
 assert.equal(f.svc.declareContents({key,plan,messages,taskEligible:{2:{eligible:true}},groups:[{seqs:[1,2],kind:'task'}]}).reason,'task_not_eligible');
});

test('same seq full detail promotion binds once without requiring a newer highest seq',()=>{
 const f=fixture(),clipped=message(1,'x'.repeat(200),{bodyComplete:false}),full=message(1,'full recovered body'),plan=f.resolve({messages:[clipped]});assert.equal(plan.contentId,undefined);
 const promoted=f.svc.forMessages({key,actionId:'detail',baselineSeq:1,currentPlan:plan,messages:[full]});assert.equal(promoted.changed,true);assert.ok(promoted.plan.contentId);
 for(let n=0;n<3;n++)assert.equal(send(f,promoted.plan,'detail'+n).ok,true);
 const reread=f.svc.forMessages({key,actionId:'detail',baselineSeq:1,currentPlan:promoted.plan,messages:[full]});assert.equal(reread.changed,false);assert.equal(send(f,reread.plan,'over').reason,'content_limit');
});
