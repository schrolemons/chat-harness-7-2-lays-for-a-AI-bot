import test from 'node:test';
import assert from 'node:assert/strict';
let model={};try{model=await import('../plugins/qq-components/life-wake-reasons/group-wake.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const policy={groupAtBonus:.5,groupNameBonus:.3,groupQuestionBonus:.2,groupPokeBonus:.6,groupNames:'小鲸鱼, DS'};
test('group arrival takes the largest matched q and rolls exactly once',()=>{
 assert.equal(typeof model.evaluateGroupIncoming,'function');let calls=0;
 const result=model.evaluateGroupIncoming({key:'group:1',p:.2,policy,event:{atMention:true,text:'小鲸鱼'},random:()=>{calls++;return .69;}});
 assert.equal(result.accepted,true);assert.equal(result.probability,.7);assert.equal(result.extraProbability,.5);assert.equal(calls,1);assert.deepEqual(result.matched,['atMention','nameMention']);
});
test('private arrivals bypass the lottery; limits stay with the bridge admission gates',()=>{
 assert.equal(typeof model.evaluateGroupIncoming,'function');const result=model.evaluateGroupIncoming({key:'private:1',p:0,policy,random:()=>{throw Error('private must not roll');}});assert.equal(result.accepted,true);assert.equal(result.reason,'private');
});
test('names come only from administrator fields, with short Latin word boundaries',()=>{
 assert.equal(typeof model.evaluateGroupIncoming,'function');for(const [text,q] of [['DS 在吗',.3],['ADSL 网络',0],['小鲸鱼你好',.3],['机器人自己的其他昵称',0]]){const result=model.evaluateGroupIncoming({key:'group:1',p:.1,policy,event:{text},random:()=>.99});assert.equal(result.extraProbability,q,text);}
});
test('bonus applies to directed questions and pokes targeting the bot; q=0 adds nothing',()=>{
 assert.equal(typeof model.evaluateGroupIncoming,'function');const decide=event=>model.evaluateGroupIncoming({key:'group:1',p:.2,policy,event,random:()=>.99});assert.equal(decide({question:true}).extraProbability,.2);assert.equal(decide({poke:true,targetIsSelf:true}).extraProbability,.6);assert.equal(decide({poke:true,targetIsSelf:false}).extraProbability,0);assert.equal(model.evaluateGroupIncoming({key:'group:1',p:.2,policy:{...policy,groupAtBonus:0},event:{atMention:true},random:()=>.3}).accepted,false);
});
test('probability is capped at one and a zero total never accepts',()=>{
 assert.equal(typeof model.evaluateGroupIncoming,'function');assert.equal(model.evaluateGroupIncoming({key:'group:1',p:.8,policy,event:{atMention:true},random:()=>.999}).probability,1);assert.equal(model.evaluateGroupIncoming({key:'group:1',p:0,policy:{...policy,groupAtBonus:0},event:{},random:()=>0}).accepted,false);
});

const {createProactive}=await import('../plugins/qq-components/life-wake-reasons/proactive.mjs');
test('service captures stage before activity reset and caches the one lottery across reset and reload',()=>{
 let state={proactiveByKey:{'group:1':{stage:3,willingness:100}}},calls=0;
 const ctx={config:{...policy,initialProbability:.2,probabilityStep:.1,probabilityMax:.9},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{getProactiveFacts:()=>({mood:{frequencyFactor:1}})}};
 const service=createProactive(ctx);const args={key:'group:1',eventId:'one',event:{atMention:true},random:()=>{calls++;return .8;}};
 const before=service.incoming(args);assert.equal(before.baseProbability,.5);assert.equal(before.probability,1);
 service.observe({key:'group:1',kind:'incoming',hasText:true,eventId:'one',at:Date.now()});
 assert.equal(service.preview({key:'group:1'}).stage,0);assert.equal(service.incoming(args).baseProbability,.5);assert.equal(createProactive(ctx).incoming(args).duplicate,true);assert.equal(calls,0,'probability one needs no RNG');
 const next={...args,eventId:'two',event:{},random:()=>{calls++;return .99;}};service.incoming(next);service.incoming(next);assert.equal(calls,1);
 assert.equal(service.incoming({key:'private:1',random:()=>{throw Error('private random');}}).accepted,true);
});

test('directed question matching uses configured names, @ facts and directed phrasing, not a hardcoded old persona',()=>{
 const decide=text=>model.evaluateGroupIncoming({key:'group:1',p:0,policy:{...policy,groupNameBonus:0,groupQuestionBonus:.8},event:{text},random:()=>.1});
 assert.equal(decide('小鲸鱼午饭吃了吗？').extraProbability,.8);assert.equal(decide('你能解释一下吗').extraProbability,.8);assert.equal(decide('小明午饭吃了吗？').extraProbability,0);assert.equal(decide('大肥鱼吃了吗？').extraProbability,0);
});

test('bounded incoming audit retains most recent events even when numeric message IDs are out of order',()=>{
 let state={};const ctx={config:{initialProbability:0,probabilityStep:0},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{getProactiveFacts:()=>({})}};const service=createProactive(ctx);
 for(let i=0;i<130;i++)service.incoming({key:'group:1',eventId:String(1000-i),at:i,event:{}});
 assert.equal(Object.keys(state.proactiveByKey['group:1'].incomingDecisions).length,128);assert.equal(service.incoming({key:'group:1',eventId:'871'}).duplicate,true);assert.equal(Object.hasOwn(state.proactiveByKey['group:1'].incomingDecisions,'1000'),false);
});
