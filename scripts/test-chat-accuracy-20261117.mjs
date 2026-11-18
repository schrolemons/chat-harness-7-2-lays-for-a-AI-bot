import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin as dynamics} from '../plugins/qq-components/ctx-context-dynamics/index.js';
import {createPlugin as session} from '../plugins/qq-components/ctx-context-session/index.js';
import {createPlugin as style} from '../plugins/qq-components/ctx-chat-style/index.js';
const person={seq:1,messageId:'10',userId:'7',sender:'私聊',text:'在吗',time:Date.now()};
const payload=()=>({key:'private:7',selfId:'99',roleName:'AI助手',st:{unread:[{...person}],recentMessages:[{...person}]},moodState:{enabled:true,score:90,mode:'normal',modeName:'普通',styleInstruction:'温和自然'},stickerConfig:{enabled:false}});
const raw={message_type:'private',self_id:99,user_id:7,message_id:10,sender:{nickname:'示例昵称甲'}};
function build(factory,p,read=()=>({ok:true,messages:[raw]})){
 const blocks=[];const plugin=factory({config:{},capabilities:{getOwnerQQ:()=>42,readLocalConversationHistory:read},addPromptBlock:t=>blocks.push(t)});
 plugin.hooks.beforePrompt(p);return {plugin,text:blocks.join('\n')};
}
test('private addressing recovers the transport nickname instead of turning a channel label into a name',()=>{
 const {text}=build(dynamics,payload());assert.match(text,/示例昵称甲/);assert.doesNotMatch(text,/私聊用户/);
 const other=build(dynamics,payload(),()=>({ok:true,messages:[{...raw,user_id:8,sender:{nickname:'别人'}}]}));
 assert.doesNotMatch(other.text,/别人用户|私聊用户/);
});
test('new private input during generation blocks stale sending until the refreshed prompt includes it',()=>{
 const p=payload(),{plugin}=build(dynamics,p),validate=plugin.services.chatExpression.validate;
 assert.equal(validate({key:p.key,kind:'text',text:'用户喜欢喝什么？'}).ok,true);
 p.st.unread.push({...person,seq:2,messageId:'11',text:'爱喝酸奶'});
 assert.equal(validate({key:p.key,kind:'text',text:'用户平时爱喝API预算还是泡泡水？'}).reason,'new_private_input');
 plugin.hooks.beforePrompt(p);
 assert.equal(validate({key:p.key,kind:'text',text:'酸奶呀，AI助手听到啦～'}).ok,true);
});
test('banned expression and channel-label addressing are rejected before physical sending',()=>{
 const {plugin}=build(dynamics,payload()),validate=plugin.services.chatExpression.validate;
 assert.equal(validate({key:'private:7',kind:'text',text:'摸摸示例禁词～'}).ok,false);
 assert.equal(validate({key:'private:7',kind:'text',text:'私聊用户，来啦～'}).ok,false);
 assert.equal(validate({key:'private:7',kind:'text',text:'示例昵称甲用户，来啦～'}).ok,true);
});
const card={app:'com.tencent.miniapp_01',meta:{detail_1:{title:'哔哩哔哩',desc:'graphwar教程',qqdocurl:'https://b23.tv/example',token:'never-inject'}}};
test('share card exposes only verified title and video link from the same cached message',()=>{
 const p={key:'group:8',selfId:'99',st:{recentMessages:[{seq:3,messageId:'20',userId:'7',text:'[卡片消息]'}]}};
 const event={message_type:'group',group_id:8,self_id:99,user_id:7,message_id:20,message:[{type:'json',data:{data:JSON.stringify(card)}}]};
 const {text}=build(session,p,()=>({ok:true,messages:[event]}));
 assert.match(text,/graphwar教程/);assert.match(text,/https:\/\/b23.tv\/example/);assert.doesNotMatch(text,/never-inject/);
 for(const changed of [{group_id:9},{self_id:100},{message_id:21}])assert.doesNotMatch(build(session,p,()=>({ok:true,messages:[{...event,...changed}]})).text,/graphwar教程/);
});
test('factual chat guidance requires discovery and retrieval for unfamiliar terms and video evidence',()=>{
 const {text}=build(style,{roleName:'AI助手',isPrivate:false});
 assert.match(text,/专有名词/);assert.match(text,/qq_select_tools/);assert.match(text,/web_search/);assert.match(text,/bili_analyze_video/);
 assert.match(text,/已经回答/);
});
test('private ingress is checked against raw local cache even when the model-facing snapshot is frozen',()=>{
 let events=[raw];const p=payload(),{plugin}=build(dynamics,p,()=>({ok:true,messages:events}));
 events.push({...raw,message_id:11,message:[{type:'text',data:{text:'爱喝酸奶'}}]});
 assert.equal(plugin.services.chatExpression.validate({key:p.key,kind:'text',text:'用户喜欢API预算还是泡泡水？'}).reason,'new_private_input');
});
test('optional questions cannot repeat across new opening scopes without any human input',async()=>{
 const {createTopicActions}=await import('../plugins/qq-components/ctx-chat-topic-drive/topic-actions.mjs');
 let data={driveByKey:{'private:7':{episodes:{old:{questionSent:true,questionGeneration:0}}}}};
 const actions=createTopicActions({state:{get:()=>data,set:p=>Object.assign(data,p)}},{followUpCooldownMinutes:0,newTopicCooldownMinutes:0});
 assert.equal(actions.reserve({key:'private:7',operationId:'new',episodeId:'different',kind:'newTopic',text:'喜欢什么饮料？'}).reason,'unanswered_question');
 assert.equal(actions.reserve({key:'private:7',operationId:'statement',episodeId:'different',kind:'newTopic',text:'刚想到海里的鲸歌。'}).ok,true);
 actions.incoming({key:'private:7'});
 assert.equal(actions.reserve({key:'private:7',operationId:'after-input',kind:'followup',text:'原来如此，是哪种口味？'}).ok,true);
});
test('casual guidance uses configured form and limits routine chat length',()=>{
 const {text}=build(style,{roleName:'AI助手'});
 assert.match(text,/【自然交流】/);assert.match(text,/不连续另问/);
 assert.match(text,/20[—–-]60/);assert.match(text,/不催/);
});
test('stale private draft is refused by the real transport before QQ or quota reservation',async()=>{
 const {createOutboundTransport}=await import('../src/outbound-context.js');let events=[raw],sends=0,reservations=0;
 const p=payload(),{plugin}=build(dynamics,p,()=>({ok:true,messages:events}));
 const transport=createOutboundTransport({callService:(service,method,args)=>{
  if(service==='chatExpression')return plugin.services.chatExpression[method](args);
  if(service==='replyPlan'&&method==='reserve'){reservations++;return {ok:true};}
  return {ok:true,ordinary:true};
 }});
 const context=transport.capture({key:p.key,agent:true,envelope:{key:p.key,actionId:'fixture',reason:'private',replyPlan:{maxMessages:2,maxMessageChars:600}}});
 events.push({...raw,message_id:11});
 await assert.rejects(transport.perform({key:p.key,context,text:'用户喜欢API预算还是泡泡水？',send:async()=>{sends++;return {message_id:1};}}),/new_private_input/);
 assert.equal(sends,0);assert.equal(reservations,0);
});
