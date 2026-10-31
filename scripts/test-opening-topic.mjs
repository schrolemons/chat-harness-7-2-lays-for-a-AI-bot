import test from 'node:test';
import assert from 'node:assert/strict';
import {createTopicActions} from '../plugins/qq-components/ctx-chat-topic-drive/topic-actions.mjs';
import {createPlugin} from '../plugins/qq-components/ctx-chat-topic-drive/index.js';
import {createPlugin as lifecycle} from '../plugins/qq-components/ctx-context-lifecycle/index.js';
import {createPlugin as wakes} from '../plugins/qq-components/life-wake-reasons/index.js';
import {hasReplyContent} from '../plugins/qq-components/ctx-chat-topic-drive/opening-topic.mjs';
import {createPlugin as chatStyle} from '../plugins/qq-components/ctx-chat-style/index.js';

const now=Date.now();
function fixture(config={}) {
 let data={}; const ctx={config,state:{get:()=>data,set:p=>Object.assign(data,p)},registerTool(){},capabilities:{},warn(){}};
 return {ctx,actions:createTopicActions(ctx,config),data:()=>data};
}
const args={key:'group:2',scope:'wake:1',now,hasContext:true};

test('opening uses normalized a:b, has no wait/end outcome and does not spend delivery counters',()=>{
 for(const [roll,expected] of [[0,'followup'],[.71,'followup'],[.72,'newTopic'],[.999,'newTopic']]){
  const f=fixture(),choice=f.actions.opening({...args,random:()=>roll});
  assert.equal(choice.action,expected);assert.ok(Math.abs(choice.followupProbability-5/7)<1e-10);
  assert.ok(Math.abs(choice.newTopicProbability-2/7)<1e-10);assert.equal(choice.endRound,undefined);
  assert.equal(f.data().driveByKey,undefined);assert.match(choice.guidance,/conversationIntent/);
 }
});
test('one opening roll per key and wake; repeated prompt reads and successful sends do not reroll',()=>{
 const f=fixture();let draws=0;const random=()=>{draws++;return .99;};
 assert.equal(f.actions.opening({...args,random}).action,'newTopic');
 f.ctx.state.set({driveByKey:{[args.key]:{driveNewTopicAt:now}}});
 assert.equal(f.actions.opening({...args,random}).action,'newTopic');assert.equal(draws,1);
 assert.equal(f.actions.opening({...args,key:'private:1',random}).action,'newTopic');assert.equal(draws,2);
 f.actions.incoming({key:args.key});
 assert.equal(f.actions.opening({...args,random:()=>{throw Error('same wake after new input must not reroll');}}).reason,'incoming_superseded');
 assert.equal(f.actions.opening({...args,scope:'wake:2',now:now+3600000,random}).action,'newTopic');assert.equal(draws,3);
});
test('opening choice survives scoped plugin reload without a new roll',()=>{
 const f=fixture(),first=f.actions.opening({...args,random:()=>.99});
 const reloaded=createTopicActions(f.ctx,{});
 assert.deepEqual(reloaded.opening({...args,random:()=>{throw Error('reload must not reroll');}}),first);
});
test('one reply wave cannot start two distinct new topics; multipart continuation of its chosen topic remains allowed',()=>{
 const f=fixture(),drive=createPlugin(f.ctx).services.conversationDrive,key='private:1';
 const args={key,scope:'turn:1',episodeId:'wave:1',kind:'newTopic',now};
 const first=drive.reserve({...args,operationId:'one',topicId:'loop-song-favorite'});assert.equal(first.ok,true);
 drive.sent({key,success:true,topicLease:first,eventId:'sent-one',at:now,text:'哪首歌你会循环听？'});
 const duplicate=drive.reserve({...args,operationId:'two',topicId:'free-day-wish'});
 assert.equal(duplicate.ok,false);assert.equal(duplicate.reason,'new_topic_already_chosen');
 assert.equal(drive.reserve({...args,operationId:'same-topic',topicId:'loop-song-favorite'}).ok,true);
 assert.equal(f.data().driveByKey[key].driveNewTopicTimes.length,1);
});
test('parallel new-topic reservations cannot claim different subjects; failed sends release their claim',()=>{
 const f=fixture(),drive=createPlugin(f.ctx).services.conversationDrive,args={key:'private:1',scope:'turn:1',episodeId:'wave:1',kind:'newTopic',now};
 const first=drive.reserve({...args,operationId:'one',topicId:'music'});assert.equal(first.ok,true);
 assert.equal(drive.reserve({...args,operationId:'two',topicId:'day-off'}).ok,false);
 drive.release({lease:first});assert.equal(drive.reserve({...args,operationId:'retry',topicId:'day-off'}).ok,true);
 assert.equal(f.data().driveByKey,undefined);
});
test('no old context selects new; unavailable/cooling branches are excluded; no available branch stays silent without ending the round',()=>{
 const f=fixture();
 assert.equal(f.actions.opening({...args,hasContext:false,random:()=>0}).action,'newTopic');
 const cooling=fixture();cooling.ctx.state.set({driveByKey:{[args.key]:{driveNewTopicAt:now-1000}}});
 assert.equal(cooling.actions.opening({...args,random:()=>.99}).action,'followup');
 const blocked=fixture({newTopicMaxPerHour:0});blocked.ctx.state.set({driveByKey:{[args.key]:{driveFollowUpAt:now-1000}}});
 const choice=blocked.actions.opening({...args,random:()=>{throw Error('no available branches');}});
 assert.equal(choice.action,'none');assert.equal(choice.endRound,undefined);
 const zero=fixture({followupWeight:0,newTopicWeight:0});assert.equal(zero.actions.opening(args).action,'none');
});
test('opening guidance lets AI assess closed topics, never invent replies or repeat unanswered questions',()=>{
 const choice=fixture().actions.opening({...args,random:()=>0});
 for(const phrase of ['今天','上一条','已经收束','未回答','忙碌','不是刚刚'])assert.ok(choice.guidance.includes(phrase),phrase);
});
test('actual proactive prompt uses the opening selector, skips scheduled notifications, preserves S-mode suppression',()=>{
 const f=fixture(),plugin=createPlugin(f.ctx),st={wakeConfig:{lastWakeAt:now},recentMessages:[{text:'报告还没写完',time:now-60000,isSelf:false}]};
 const payload={key:'private:1',reason:'proactiveCheck',st};
 const line=plugin.hooks.beforePrompt(payload);assert.match(line,/主动开聊.*话题抽签/);assert.match(line,/71\.4%/);
 assert.equal(plugin.hooks.beforePrompt(payload),line);
 assert.equal(f.data().openingChoices[payload.key].scope,'wake:'+now);
 plugin.hooks.beforePrompt({...payload,st:{...st,wakeConfig:{lastWakeAt:now+1}}});
 assert.equal(f.data().openingChoices[payload.key].scope,'wake:'+(now+1));
 for(const reason of ['reminder','timeBubble','startupGreeting','newsShare'])assert.equal(plugin.hooks.beforePrompt({...payload,reason}),'');
 const s=createPlugin({...f.ctx,callService:()=>({mode:'care'})});assert.equal(s.hooks.beforePrompt(payload),'');
});
test('new unread messages take reply precedence over proactive topic rolls',()=>{
 const f=fixture(),plugin=createPlugin(f.ctx);
 const text=plugin.hooks.beforePrompt({key:'group:2',reason:'proactiveCheck',hasUnreadNow:true,st:{unread:[{text:'我的报告要怎么改？',time:now}]}});
 assert.doesNotMatch(text,/话题抽签/);assert.match(text,/先正常回应/);assert.equal(f.data().openingChoices,undefined);
});
test('bare group attention draws a topic, but meaningful text or media must be answered first',()=>{
 const base={key:'group:2',reason:'atMention@seq2',selfName:'AI助手',selfId:'999',hasUnreadNow:true};
 for(const text of ['@AI助手','AI助手！','[CQ:at,qq=999]','[拍一拍] 甲 戳了戳 你']){
  const f=fixture(),plugin=createPlugin(f.ctx),st={wakeConfig:{lastWakeAt:now},unread:[{plain:text,time:now}],recentMessages:[]};
  assert.equal(hasReplyContent({...base,st}),false,text);
  assert.match(plugin.hooks.beforePrompt({...base,reason:text.startsWith('[拍')?'poke':base.reason,st}),/话题抽签/);
  assert.equal(f.data().openingChoices[base.key].action,'newTopic','bare attention is not an old topic');
 }
 for(const text of ['@AI助手 我的报告怎么写？','[图片]','@其他人','你觉得呢？']){
  const f=fixture(),st={wakeConfig:{lastWakeAt:now},unread:[{plain:text,time:now}]};
  assert.equal(hasReplyContent({...base,st}),true,text);
  assert.doesNotMatch(createPlugin(f.ctx).hooks.beforePrompt({...base,st}),/话题抽签/);
 }
 const f=fixture(),st={wakeConfig:{lastWakeAt:now},unread:[{plain:'解释一下栈和队列',time:now-1000},{plain:'@AI助手',time:now}]};
 assert.doesNotMatch(createPlugin(f.ctx).hooks.beforePrompt({...base,st}),/话题抽签/,'earlier pending questions beat a bare new mention');
 for(const m of [{plain:'',media:[{kind:'image'}]},{plain:'@AI助手',text:'[引用 AI助手：为什么？]@AI助手',quoteTargetIsSelf:true}])assert.equal(hasReplyContent({...base,st:{unread:[m]}}),true);
});

test('actual atSelf evidence recognizes a rendered nickname that differs from the bot configured name',()=>{
 const f=fixture(),plugin=createPlugin(f.ctx),base={key:'group:2',reason:'atMention@seq981',selfName:'AI助手',selfId:'999',hasUnreadNow:true};
 const st={lastWakeAt:now,unread:[{seq:981,plain:'@DeepSeekAI助手',atSelf:true,time:now}]};
 assert.equal(hasReplyContent({...base,st}),false,'a verified self mention alone has no question body');
 const prompt=plugin.hooks.beforePrompt({...base,st});assert.match(prompt,/空\s*@.*招呼/);assert.match(prompt,/话题抽签/);assert.equal(f.data().openingChoices[base.key].action,'newTopic');
 for(const message of [{plain:'@DeepSeekAI助手 报告怎么改',atSelf:true},{plain:'@DeepSeekAI助手报告怎么改',atSelf:true},{plain:'@别人',atSelf:false},{plain:'@DeepSeekAI助手 @别人',atSelf:true},{plain:'',text:'[引用 甲：怎么做？]@DeepSeekAI助手',atSelf:true},{plain:'@DeepSeekAI助手',atSelf:true,media:[{kind:'image'}]}])assert.equal(hasReplyContent({...base,st:{unread:[message]}}),true,JSON.stringify(message));
});

test('empty self mentions still select a grounded topic on a generic or low-budget message batch',()=>{
 for(const reason of ['message','budgetWeak']){
  const f=fixture(),st={lastWakeAt:now,unread:[{text:'@DeepSeekAI助手',atSelf:true}],activeTopics:[{text:'刚才的游戏进度'}]};
  const text=createPlugin(f.ctx).hooks.beforePrompt({key:'group:2',reason,st,selfName:'AI助手',hasUnreadNow:true});assert.match(text,/话题抽签/);assert.match(text,/不.*(?:责问|催促)/);
 }
});

test('empty attention gives conversation guidance even when a real pending question takes precedence',()=>{
 const f=fixture(),st={lastWakeAt:now,unread:[{seq:980,text:'上一条代码为何报错？'},{seq:981,text:'@DeepSeekAI助手',atSelf:true}]};
 const text=createPlugin(f.ctx).hooks.beforePrompt({key:'group:2',reason:'atMention@seq981',st,selfName:'AI助手',hasUnreadNow:true});assert.match(text,/空\s*@.*招呼/);assert.doesNotMatch(text,/话题抽签/);assert.match(text,/先正常回应/);
 const skipped=createPlugin(f.ctx).hooks.beforePrompt({key:'group:2',reason:'atMention@seq981',st,hasUnreadNow:false});assert.doesNotMatch(skipped,/本次.*空\s*@|话题抽签/);
});

test('group rules do not force an empty acknowledgement or a missing-text interrogation',()=>{
 const blocks=[];chatStyle({config:{},addPromptBlock:t=>blocks.push(t)}).hooks.beforePrompt({key:'group:2',isPrivate:false});
 const text=blocks.join('\n');assert.doesNotMatch(text,/哪怕只回一句/);assert.match(text,/空\s*@.*(?:话题|招呼)/);
});
test('old bare mention snapshots do not create a fresh opening when no current unread was admitted',()=>{
 const f=fixture(),text=createPlugin(f.ctx).hooks.beforePrompt({key:'group:2',reason:'atMention@seq981',selfName:'AI助手',hasUnreadNow:false,st:{unread:[{text:'@DeepSeekAI助手',atSelf:true}]}});
 assert.doesNotMatch(text,/本次.*空\s*@|话题抽签/);assert.equal(f.data().openingChoices,undefined);
});
test('previous exchanges remain eligible across midnight; empty/future history cannot invent an old topic',()=>{
 for(const [st,expected] of [
  [{lastWakeAt:now,recentMessages:[{text:'昨天没聊完的事',time:now-86400000}]},'followup'],
  [{lastWakeAt:now,recentMessages:[]},'none'],
  [{lastWakeAt:now,recentMessages:[{text:'时间不成立',time:now+86400000}]},'none'],
  [{lastWakeAt:now,activeTopics:[{text:'今天项目进度'}]},'followup']
 ]){
  const f=fixture({followupWeight:1,newTopicWeight:0});
  // Without old context and a zero new-topic weight, preserve the explicit disabled branch.
  const line=createPlugin(f.ctx).hooks.beforePrompt({key:'private:1',reason:'proactiveCheck',st});
  if(expected==='none')assert.doesNotMatch(line,/优先沿着今天/);else assert.match(line,/优先沿着今天/);
 }
});
test('group @/name/question/poke wake prioritizes recent related messages; closed topic can change without a termination roll',()=>{
 const f=fixture(),plugin=wakes(f.ctx);
 for(const reason of ['atMention@seq3','nameMention@seq4','question@seq5','poke']){
  const text=plugin.hooks.wakeTail({key:'group:2',reason,doubleStampEnabled:false});
  assert.match(text,/最近.*(?:相关|消息)/);assert.match(text,/先.*(?:回复|回应)/);assert.match(text,/收束/);
 }
});
test('lifecycle permits grounded continuity during proactive opening and retains endRound waiting controls',()=>{
 const blocks=[];lifecycle({config:{},addPromptBlock:x=>blocks.push(x)}).hooks.beforePrompt({reason:'proactiveCheck',autonomousNow:true,hasUnreadNow:false});
 const line=blocks.join('\n');assert.doesNotMatch(line,/也不要复述旧话题/);assert.match(line,/延续.*(?:今天|旧话题)/);assert.match(line,/endRound/);
});
