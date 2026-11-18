import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin as replyShape} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
import {createPlugin as relay} from '../plugins/qq-components/life-relay-message/index.js';
import {declareReplyContents} from '../src/console/reply-contents.mjs';
const key='private:10001',target='private:10001',message={seq:688,messageId:'original-command',userId:'123456',text:'你聊过很多次了，去电一下654321',plain:'你聊过很多次了，去电一下654321',bodyComplete:true};
function fixture(){let data={};const plugin=replyShape({config:{maxSendPerMinute:100,maxSendPerHour:1000,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0},state:{get:()=>structuredClone(data),set:p=>data={...data,...structuredClone(p)}},callService:()=>null});return {svc:plugin.services.replyPlan,data:()=>data};}
test('an acknowledged admin command can become the same admitted task without resetting its identity or spending',async()=>{
 const f=fixture(),plan=f.svc.resolve({key,turnId:'turn',messages:[message]});
 assert(f.svc.reserve({key,plan,operationId:'ack',kind:'text',text:'这就去',now:1000000}).ok);
 assert(f.svc.commit({key,operationId:'ack',sentAt:1000000,deliveryId:'ack-delivery'}).ok);
 const spent=f.svc.progress({plan}).successful,envelope={key,replyPlan:plan,taskSources:{}};
 const declared=await declareReplyContents({key,sourceKey:key,envelope,groups:[{seqs:[688],kind:'task'}],messages:[{...message,repliedAt:1000001}],allowed:true,adminAuthorized:true,
  callService:(service,method,args)=>service==='replyPlan'?f.svc[method](args):{eligible:false},
  admitTaskContents:async({contents})=>{for(const content of contents)assert(f.svc.claimTaskGroup({key,groupId:content.id,plan,now:1000002}).ok);return {ok:true};}});
 assert.equal(declared.status,200);assert.equal(declared.body.contents[0].id,plan.contentId);assert.equal(declared.body.contents[0].taskExempt,true);
 assert.equal(f.svc.progress({plan}).successful,spent);
 const bound=f.svc.bindContent({key:target,sourceKey:key,plan,contentId:plan.contentId,messages:[{...message,repliedAt:1000001}]});assert.equal(bound.ok,true);assert.equal(bound.plan.taskExempt,true);
 const again=await declareReplyContents({key,sourceKey:key,envelope,groups:[{seqs:[688],kind:'task'}],messages:[message],allowed:true,adminAuthorized:true,callService:(s,m,a)=>s==='replyPlan'?f.svc[m](a):null,admitTaskContents:async()=>({ok:true})});assert.equal(again.body.contents[0].id,plan.contentId);
});
test('ordinary task flags and partial regrouping cannot promote already-started chat',()=>{
 const f=fixture(),plan=f.svc.resolve({key,turnId:'turn',messages:[message]});f.svc.reserve({key,plan,operationId:'ack',now:1000000});
 assert.equal(f.svc.declareContents({key,plan,messages:[message],groups:[{seqs:[688],kind:'task'}],taskEligible:{688:true}}).reason,'content_already_started');
 assert.equal(f.svc.declareContents({key,plan,messages:[{...message,text:'changed'}],groups:[{seqs:[688],kind:'task'}],taskEligible:{688:{eligible:true,kind:'admin'}}}).reason,'source_changed');
});
function relayFixture(){
 let allowed=false,reads=0;const plugin=relay({config:{},state:{get:()=>({}),set(){}},capabilities:{getOwnerQQ:()=>123456,hasAdminEnvironment:()=>true,resolveRelayTarget:q=>allowed&&q===target?target:null,listConversationKeys:()=>allowed?[target]:[],getProactiveFacts:()=>({lastIncomingAt:100,lastOutboundAt:200}),readLocalConversationHistory:()=>{reads++;return {ok:true,messages:[{message_type:'private',user_id:654321,self_id:99,message_id:'p1'}]};}}});
 return {plugin,setAllowed:v=>allowed=v,reads:()=>reads};
}
test('owner target facts refresh current whitelist and verify prior private interaction',()=>{
 const f=relayFixture(),payload={key,selfId:'99',st:{unread:[message]}};
 assert.equal(typeof f.plugin.hooks.beforePrompt,'function');
 let text=f.plugin.hooks.beforePrompt(payload);assert.match(text,/"whitelisted":false/);assert.equal(f.reads(),0);
 f.setAllowed(true);text=f.plugin.hooks.beforePrompt(payload);assert.match(text,/"whitelisted":true/);assert.match(text,/"priorPrivateInteraction":true/);assert.equal(f.reads(),1);
 assert.doesNotMatch(f.plugin.hooks.beforePrompt({...payload,key:'private:10001',isOwnerKey:true}),/本轮传话目标状态|"whitelisted"|"priorPrivateInteraction"/);
});
test('flexible semantic relays use actual target and content, not a required command template',()=>{
 const f=relayFixture(),text=f.plugin.hooks.beforePrompt({key,st:{unread:[{...message,text:'AI助手，柳言还不知道这事呢，跟他说声今晚不用等我啦',plain:undefined}]}});
 for(const term of ['自行理解','昵称','绰号','qq_alias_query','qq_reply_contents','contentId'])assert(text.includes(term));
 assert.match(text,/不要求固定句式/);assert.match(text,/最新白名单/);assert.match(text,/真实发送/);
});
